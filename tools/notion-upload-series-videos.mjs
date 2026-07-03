import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@notionhq/client";

const DEFAULT_PAGE_ID = "39120ac12f0a80e69374d19602a6e59b";
const DEFAULT_SOURCE_DIR = "C:\\Users\\fores\\OneDrive\\13_新时期\\boccaro\\trans";
const DEFAULT_PART_MIB = 20;

function parseArgs() {
  const options = {
    pageId: DEFAULT_PAGE_ID,
    sourceDir: DEFAULT_SOURCE_DIR,
    filePattern: "Teach.You.a.Lesson.S01E*.mp4",
    targetSpecPageId: "",
    specTitle: "",
    partMiB: DEFAULT_PART_MIB,
    maxFiles: Infinity,
    apply: false
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") options.pageId = args[++index];
    else if (arg === "--source-dir") options.sourceDir = args[++index];
    else if (arg === "--file-pattern") options.filePattern = args[++index];
    else if (arg === "--target-spec-page-id") options.targetSpecPageId = args[++index];
    else if (arg === "--spec-title") options.specTitle = args[++index];
    else if (arg === "--part-mib") options.partMiB = Number(args[++index]);
    else if (arg === "--max-files") options.maxFiles = Number(args[++index]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.sourceDir = path.resolve(options.sourceDir);
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-upload-series-videos.mjs [--apply] [--max-files 1]

Examples:
  node tools/notion-upload-series-videos.mjs
  node tools/notion-upload-series-videos.mjs --apply --max-files 1
  node tools/notion-upload-series-videos.mjs --apply
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

function titlePropertyName(page) {
  for (const [name, property] of Object.entries(page.properties ?? {})) {
    if (property.type === "title") return name;
  }
  return "title";
}

function richText(content) {
  return [{ type: "text", text: { content } }];
}

function blockTitle(block) {
  const payload = block[block.type] ?? {};
  if (block.type === "child_page") return payload.title ?? "";
  if (block.type === "callout" || block.type === "toggle") return plainText(payload.rich_text);
  if (block.type === "video") return fileNameFromMedia(payload) || plainText(payload.caption);
  return "";
}

function fileNameFromMedia(payload) {
  const url = payload?.file?.url ?? payload?.external?.url ?? "";
  if (!url) return "";
  return decodeURIComponent(url.split("/").pop().split("?")[0]);
}

function comparableName(value) {
  return decodeURIComponent(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

function episodeNumber(fileName) {
  const match = fileName.match(/S\d+E(\d+)/i) ?? fileName.match(/E(?:pisode)?\s*(\d+)/i);
  return match ? Number(match[1]) : undefined;
}

function specLabelFromFiles(files) {
  const labels = new Set();
  for (const file of files) {
    const normalized = file.name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (normalized.includes("chschteng") || normalized.includes("chtchseng")) labels.add("繁简英");
    else if (normalized.includes("chscht") || normalized.includes("chtchs")) labels.add("繁简");
    else if (normalized.includes("chseng")) labels.add("简英");
    else if (normalized.includes("chteng")) labels.add("繁英");
    else if (normalized.includes("chs")) labels.add("简");
    else if (normalized.includes("cht")) labels.add("繁");
  }
  if (labels.size === 1) return [...labels][0];
  if (labels.size > 1) return [...labels].join("/");
  return "";
}

function collectSourceFiles(options) {
  if (!fs.existsSync(options.sourceDir)) throw new Error(`Source dir not found: ${options.sourceDir}`);
  const pattern = globToRegExp(options.filePattern);
  return fs.readdirSync(options.sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(options.sourceDir, entry.name);
      return {
        name: entry.name,
        path: fullPath,
        size: fs.statSync(fullPath).size,
        episode: episodeNumber(entry.name)
      };
    })
    .sort((left, right) => (left.episode ?? 9999) - (right.episode ?? 9999) || left.name.localeCompare(right.name, "en"));
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

async function findSpecPage(notion, pageId, options) {
  if (options.targetSpecPageId) {
    const page = await notion.pages.retrieve({ page_id: options.targetSpecPageId });
    return { id: page.id, title: pageTitle(page) };
  }

  const children = await listChildren(notion, pageId);
  for (const callout of children.filter((block) => block.type === "callout")) {
    const specPages = (await listChildren(notion, callout.id)).filter((block) => block.type === "child_page");
    if (specPages.length > 0) return { id: specPages[0].id, title: blockTitle(specPages[0]) };
  }
  throw new Error("No spec child page found under a callout block.");
}

async function collectEpisodePages(notion, specPageId) {
  const children = await listChildren(notion, specPageId);
  const pages = new Map();
  for (const child of children.filter((block) => block.type === "child_page")) {
    const number = episodeNumber(blockTitle(child));
    if (number !== undefined) pages.set(number, { id: child.id, title: blockTitle(child) });
  }
  return pages;
}

async function updatePageTitle(notion, pageId, title, apply) {
  const page = await notion.pages.retrieve({ page_id: pageId });
  const current = pageTitle(page);
  if (!title || current === title) return;
  console.log(`${apply ? "update" : "would update"} spec title: ${current} -> ${title}`);
  if (apply) {
    await notion.pages.update({
      page_id: page.id,
      properties: {
        [titlePropertyName(page)]: { title: richText(title) }
      }
    });
  }
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return { uploads: {} };
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function writeManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

function isExpired(record) {
  return record.expiryTime && Date.parse(record.expiryTime) <= Date.now() + 60_000;
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
  const contentType = "video/mp4";
  const partBytes = Math.max(1, Math.floor(options.partMiB)) * 1024 * 1024;
  const partCount = Math.ceil(file.size / partBytes);
  let record = manifest.uploads[file.name] ?? {
    filename: file.name,
    size: file.size,
    sentParts: 0
  };

  if (record.status === "uploaded" && record.fileUploadId) {
    console.log(`reuse uploaded ${file.name} ${record.fileUploadId}`);
    return record.fileUploadId;
  }

  if (record.fileUploadId && isExpired(record)) {
    console.log(`discard expired upload ${file.name} ${record.fileUploadId}`);
    record = { filename: file.name, size: file.size, sentParts: 0 };
    manifest.uploads[file.name] = record;
    writeManifest(manifestPath, manifest);
  }

  if (!record.fileUploadId) {
    const mode = partCount === 1 ? "single_part" : "multi_part";
    console.log(`create upload ${file.name}: ${mode}, ${partCount} part(s)`);
    const upload = await notion.fileUploads.create({
      mode,
      filename: file.name,
      content_type: contentType,
      ...(mode === "multi_part" ? { number_of_parts: partCount } : {})
    });
    record.fileUploadId = upload.id;
    record.mode = mode;
    record.partCount = partCount;
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

async function appendEpisodeVideo(notion, episodePage, file, fileUploadId, apply) {
  const existing = await listChildren(notion, episodePage.id);
  const comparable = comparableName(file.name);
  if (existing.some((block) => block.type === "video" && comparableName(blockTitle(block)).includes(comparable))) {
    console.log(`video block already exists: ${episodePage.title} ${file.name}`);
    return;
  }

  console.log(`${apply ? "append" : "would append"} ${file.name} to ${episodePage.title}`);
  if (!apply) return;
  await notion.blocks.children.append({
    block_id: episodePage.id,
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

  const files = collectSourceFiles(options);
  if (files.length === 0) throw new Error(`No matching files found: ${path.join(options.sourceDir, options.filePattern)}`);
  const selectedFiles = files.slice(0, options.maxFiles);
  const notion = new Client({ auth: token, timeoutMs: 600000 });
  const page = await notion.pages.retrieve({ page_id: options.pageId });
  const specPage = await findSpecPage(notion, page.id, options);
  const episodePages = await collectEpisodePages(notion, specPage.id);
  const specTitle = options.specTitle || specLabelFromFiles(files) || specPage.title;

  console.log(`page: ${pageTitle(page)} ${page.id}`);
  console.log(`spec page: ${specPage.title} ${specPage.id}`);
  console.log(`spec title: ${specTitle}`);
  console.log(`source files: ${files.length}; selected: ${selectedFiles.length}`);
  console.log(`mode: ${options.apply ? "apply" : "dry-run"}`);

  await updatePageTitle(notion, specPage.id, specTitle, options.apply);

  const missingEpisodes = selectedFiles.filter((file) => !episodePages.has(file.episode));
  if (missingEpisodes.length > 0) {
    throw new Error(`Missing episode pages for: ${missingEpisodes.map((file) => file.name).join(", ")}`);
  }

  if (!options.apply) {
    for (const file of selectedFiles) {
      console.log(`would upload ${file.name} -> Episode ${String(file.episode).padStart(2, "0")}`);
    }
    return;
  }

  const manifestPath = path.join(".local-data", `notion-series-video-upload-${options.pageId.replace(/-/g, "")}.json`);
  const manifest = readManifest(manifestPath);
  for (const file of selectedFiles) {
    const fileUploadId = await uploadVideo(notion, file, options, manifest, manifestPath);
    await appendEpisodeVideo(notion, episodePages.get(file.episode), file, fileUploadId, options.apply);
  }
  console.log(`manifest written: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
