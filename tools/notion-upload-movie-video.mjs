import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@notionhq/client";

const DEFAULT_PAGE_ID = "19720ac12f0a8012ad6fedf37ce546a9";
const DEFAULT_PART_MIB = 20;

function parseArgs() {
  const options = {
    pageId: DEFAULT_PAGE_ID,
    file: "",
    targetPageId: "",
    targetTitle: "",
    partMiB: DEFAULT_PART_MIB,
    prepareOnly: false,
    apply: false
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") options.pageId = args[++index];
    else if (arg === "--file") options.file = args[++index];
    else if (arg === "--target-page-id") options.targetPageId = args[++index];
    else if (arg === "--target-title") options.targetTitle = args[++index];
    else if (arg === "--part-mib") options.partMiB = Number(args[++index]);
    else if (arg === "--prepare-only") options.prepareOnly = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.file && !options.prepareOnly) throw new Error("--file is required.");
  if (options.file) options.file = path.resolve(options.file);
  if (options.prepareOnly && !options.targetPageId && !options.targetTitle) {
    throw new Error("--prepare-only requires --target-title or --target-page-id.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-upload-movie-video.mjs --file <mp4> [--apply]
  node tools/notion-upload-movie-video.mjs --page-id <movie-page-id> --target-title "影片 繁英 1.6GB" --prepare-only --apply

Examples:
  node tools/notion-upload-movie-video.mjs --file E:\\video_made\\movie.mp4
  node tools/notion-upload-movie-video.mjs --file E:\\video_made\\movie.mp4 --target-page-id <id> --apply

Options:
  --prepare-only  Create/reuse the target spec child page, then skip upload. No --file is required when --target-title or --target-page-id is supplied.
`);
}

function dotenv(name) {
  if (fs.existsSync(".env")) {
    const raw = fs.readFileSync(".env", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match?.[1] === name) return match[2].trim();
    }
  }
  return process.env[name];
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function pageTitle(page) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === "title") return plainText(property.title);
  }
  return "";
}

function blockTitle(block) {
  const payload = block[block.type] ?? {};
  if (block.type === "child_page") return payload.title ?? "";
  if (block.type === "callout" || block.type === "toggle") return plainText(payload.rich_text);
  if (block.type === "video") return payload.name ?? payload.file?.url ?? payload.external?.url ?? "";
  return "";
}

function humanGb(bytes) {
  return `${(bytes / 1e9).toFixed(bytes >= 10e9 ? 1 : 2).replace(/\.0$/, "")}GB`;
}

function cleanMovieTitle(title) {
  return title
    .replace(/^(?:【敬请期待】|【仅供下载】)\s*/, "")
    .replace(/\s+[A-Za-z][A-Za-z0-9:.,'"!?&\- ]+(?:\(\d{4}\))?\s*$/, "")
    .replace(/\s*\(\d{4}\)\s*$/, "")
    .trim();
}

function specLabelFromFilename(filename) {
  const normalized = filename.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized.includes("chschteng") || normalized.includes("chtchseng")) return "繁简英";
  if (normalized.includes("chscht") || normalized.includes("chtchs")) return "繁简";
  if (normalized.includes("chseng")) return "简英";
  if (normalized.includes("chteng")) return "繁英";
  if (normalized.includes("chs")) return "简";
  if (normalized.includes("cht")) return "繁";
  return "";
}

function comparableFilename(value) {
  return decodeURIComponent(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function richText(content) {
  return [{ type: "text", text: { content } }];
}

function titlePropertyName(page) {
  for (const [name, property] of Object.entries(page.properties ?? {})) {
    if (property.type === "title") return name;
  }
  return "title";
}

async function updatePageTitle(notion, pageId, title, apply) {
  if (pageId === "(dry-run)") return;
  if (!title) return;
  const page = await notion.pages.retrieve({ page_id: pageId });
  const current = pageTitle(page);
  if (current === title) return;
  console.log(`${apply ? "update" : "would update"} target page title: ${current} -> ${title}`);
  if (apply) {
    await notion.pages.update({
      page_id: page.id,
      properties: {
        [titlePropertyName(page)]: { title: richText(title) }
      }
    });
  }
}

async function listChildren(notion, blockId) {
  const blocks = [];
  let startCursor;
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      start_cursor: startCursor,
      page_size: 100
    });
    blocks.push(...response.results);
    startCursor = response.has_more ? response.next_cursor : undefined;
  } while (startCursor);
  return blocks;
}

async function targetCandidate(notion, childPageBlock) {
  const grandChildren = await listChildren(notion, childPageBlock.id);
  const videoNames = grandChildren.filter((block) => block.type === "video").map(blockTitle);
  return { id: childPageBlock.id, title: blockTitle(childPageBlock), videoNames };
}

async function createTargetPage(notion, rootPageId, title, apply) {
  console.log(`${apply ? "create" : "would create"} target spec page "${title}" under ${rootPageId}`);
  if (!apply) return { id: "(dry-run)", title, created: false };
  const page = await notion.pages.create({
    parent: { page_id: rootPageId },
    properties: {
      title: { title: richText(title) }
    }
  });
  return { id: page.id, title, created: true };
}

async function findTargetPage(notion, rootPageId, options, filename, plannedTitle) {
  if (options.targetPageId) {
    const targetPage = await notion.pages.retrieve({ page_id: options.targetPageId });
    return { id: targetPage.id, title: pageTitle(targetPage) };
  }

  const mainChildren = await listChildren(notion, rootPageId);
  const nestedCandidates = [];
  const directCandidates = [];
  for (const child of mainChildren.filter((block) => block.type === "child_page")) {
    directCandidates.push(await targetCandidate(notion, child));
  }
  for (const callout of mainChildren.filter((block) => block.type === "callout" || block.type === "toggle")) {
    const children = await listChildren(notion, callout.id);
    for (const child of children.filter((block) => block.type === "child_page")) {
      nestedCandidates.push(await targetCandidate(notion, child));
    }
  }
  const candidates = [...nestedCandidates, ...directCandidates];

  if (plannedTitle && (options.targetTitle || options.prepareOnly)) {
    const exact = candidates.find((candidate) => candidate.title === plannedTitle);
    if (exact) return exact;
    if (options.prepareOnly) return createTargetPage(notion, rootPageId, plannedTitle, options.apply);
    throw new Error(`Target spec page not found: ${plannedTitle}. Run --prepare-only --apply first or pass --target-page-id.`);
  }

  if (filename) {
    const comparable = comparableFilename(filename);
    const already = candidates.find((candidate) =>
      candidate.videoNames.some((name) => comparableFilename(name).includes(comparable))
    );
    if (already) {
      return { id: already.id, alreadyExists: true, title: already.title };
    }
  }

  const empty = candidates.find((candidate) => candidate.videoNames.length === 0);
  if (empty) {
    return { id: empty.id, title: empty.title };
  }

  const last = candidates.at(-1);
  if (last) {
    return { id: last.id, title: last.title };
  }

  throw new Error("No callout child page found for movie video.");
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return { uploads: {} };
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function writeManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function readChunk(filePath, offset, length) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

async function uploadVideo(notion, file, options, manifest, manifestPath) {
  const partBytes = Math.max(1, Math.floor(options.partMiB)) * 1024 * 1024;
  const partCount = Math.ceil(file.size / partBytes);
  const mode = partCount === 1 ? "single_part" : "multi_part";
  const contentType = "video/mp4";
  const record = manifest.uploads[file.name] ?? {
    filename: file.name,
    size: file.size,
    mode,
    partCount,
    sentParts: 0
  };

  if (record.status === "uploaded" && record.fileUploadId) {
    console.log(`reuse uploaded ${file.name} ${record.fileUploadId}`);
    return record.fileUploadId;
  }

  if (!record.fileUploadId) {
    console.log(`create upload ${file.name}: ${mode}, ${partCount} part(s)`);
    const upload = await notion.fileUploads.create({
      mode,
      filename: file.name,
      content_type: contentType,
      ...(mode === "multi_part" ? { number_of_parts: partCount } : {})
    });
    record.fileUploadId = upload.id;
    record.expiryTime = upload.expiry_time;
    record.sentParts = 0;
    manifest.uploads[file.name] = record;
    writeManifest(manifestPath, manifest);
  }

  if (record.mode === "single_part") {
    const data = await readChunk(file.path, 0, file.size);
    await notion.fileUploads.send({
      file_upload_id: record.fileUploadId,
      file: { filename: file.name, data: new Blob([data], { type: contentType }) }
    });
    record.sentParts = 1;
  } else {
    for (let part = (record.sentParts ?? 0) + 1; part <= record.partCount; part += 1) {
      const offset = (part - 1) * partBytes;
      const length = Math.min(partBytes, file.size - offset);
      const data = await readChunk(file.path, offset, length);
      const startedAt = Date.now();
      console.log(`send ${file.name} part ${part}/${record.partCount}`);
      await notion.fileUploads.send({
        file_upload_id: record.fileUploadId,
        part_number: String(part),
        file: { filename: file.name, data: new Blob([data], { type: contentType }) }
      });
      record.sentParts = part;
      record.lastPartSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
      record.updatedAt = new Date().toISOString();
      writeManifest(manifestPath, manifest);
      await sleep(250);
    }
    console.log(`complete ${file.name}`);
    await notion.fileUploads.complete({ file_upload_id: record.fileUploadId });
  }

  record.status = "uploaded";
  record.completedAt = new Date().toISOString();
  writeManifest(manifestPath, manifest);
  return record.fileUploadId;
}

async function appendVideo(notion, targetPageId, fileName, fileUploadId, apply) {
  const existing = await listChildren(notion, targetPageId);
  const comparable = comparableFilename(fileName);
  if (existing.some((block) => block.type === "video" && comparableFilename(blockTitle(block)).includes(comparable))) {
    console.log(`video block already exists: ${fileName}`);
    return;
  }

  console.log(`${apply ? "append" : "would append"} video block to ${targetPageId}: ${fileName}`);
  if (!apply) return;
  await notion.blocks.children.append({
    block_id: targetPageId,
    children: [
      {
        type: "video",
        video: {
          type: "file_upload",
          file_upload: { id: fileUploadId },
          caption: []
        }
      }
    ]
  });
}

async function main() {
  const options = parseArgs();
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  if (!token) throw new Error("NOTION_WRITE_TOKEN or NOTION_TOKEN is required.");
  if (options.file && !fs.existsSync(options.file)) throw new Error(`File not found: ${options.file}`);

  const file = options.file
    ? {
        path: options.file,
        name: path.basename(options.file),
        size: fs.statSync(options.file).size
      }
    : null;
  const notion = new Client({ auth: token, timeoutMs: 600000 });
  const page = await notion.pages.retrieve({ page_id: options.pageId });
  const targetTitle = options.targetTitle || (file
    ? `${cleanMovieTitle(pageTitle(page))} ${[specLabelFromFilename(file.name), humanGb(file.size)].filter(Boolean).join(" ")}`
    : "");
  const target = await findTargetPage(notion, page.id, options, file?.name ?? "", targetTitle);

  console.log(`page: ${pageTitle(page)} ${page.id}`);
  console.log(file ? `file: ${file.name} ${file.size} bytes` : "file: (none; prepare-only)");
  console.log(`target page: ${target.title ?? ""} ${target.id}`);
  console.log(`target title: ${targetTitle}`);
  console.log(`mode: ${options.apply ? "apply" : "dry-run"}${options.prepareOnly ? " prepare-only" : ""}`);

  if (options.prepareOnly) {
    await updatePageTitle(notion, target.id, targetTitle, options.apply);
    console.log("prepare-only: upload skipped");
    return;
  }

  if (target.alreadyExists) {
    await updatePageTitle(notion, target.id, targetTitle, options.apply);
    console.log("upload skipped; video block already exists on target page.");
    return;
  }

  if (!options.apply) {
    await updatePageTitle(notion, target.id, targetTitle, options.apply);
    console.log("upload skipped; pass --apply to upload and append.");
    return;
  }

  await updatePageTitle(notion, target.id, targetTitle, options.apply);
  const manifestPath = path.join(".local-data", `notion-movie-video-upload-${options.pageId.replace(/-/g, "")}.json`);
  const manifest = readManifest(manifestPath);
  const fileUploadId = await uploadVideo(notion, file, options, manifest, manifestPath);
  await appendVideo(notion, target.id, file.name, fileUploadId, options.apply);
  console.log(`manifest written: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
