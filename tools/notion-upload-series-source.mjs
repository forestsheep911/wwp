import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@notionhq/client";

const DEFAULT_PART_MIB = 20;
const DEFAULT_VOLUME_SIZE = "700m";
const DEFAULT_PAGE_ID = "38f20ac12f0a80b4ae56ca6cb5f51383";
const DEFAULT_SOURCE_DIR =
  "I:\\MAKE\\Teach.You.a.Lesson.S01.2026.Complete.1080p.Netflix.WEB-DL.AVC.DDP.5.1.Atmos-DBTV";
const DEFAULT_ARCHIVE_NAME = "Teach.You.a.Lesson.S01.2026.1080p.Netflix.WEB-DL.AVC.DDP.5.1.Atmos-DBTV.7z";

function parseArgs() {
  const options = {
    pageId: DEFAULT_PAGE_ID,
    sourceDir: DEFAULT_SOURCE_DIR,
    archiveDir: "",
    archiveName: DEFAULT_ARCHIVE_NAME,
    volumeSize: DEFAULT_VOLUME_SIZE,
    partMiB: DEFAULT_PART_MIB,
    specTitle: "",
    sourceSizeTitle: "",
    mainTitle: "",
    package: false,
    apply: false,
    upload: false,
    forceTitle: false,
    maxUploadFiles: Infinity
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") options.pageId = args[++index];
    else if (arg === "--source-dir") options.sourceDir = args[++index];
    else if (arg === "--archive-dir") options.archiveDir = args[++index];
    else if (arg === "--archive-name") options.archiveName = args[++index];
    else if (arg === "--volume-size") options.volumeSize = args[++index];
    else if (arg === "--part-mib") options.partMiB = Number(args[++index]);
    else if (arg === "--spec-title") options.specTitle = args[++index];
    else if (arg === "--source-size-title") options.sourceSizeTitle = args[++index];
    else if (arg === "--main-title") options.mainTitle = args[++index];
    else if (arg === "--max-upload-files") options.maxUploadFiles = Number(args[++index]);
    else if (arg === "--package") options.package = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--upload") options.upload = true;
    else if (arg === "--force-title") options.forceTitle = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.upload && !options.apply) {
    throw new Error("--upload requires --apply so uploaded files can be attached to Notion.");
  }

  options.sourceDir = path.resolve(options.sourceDir);
  options.archiveDir = path.resolve(
    options.archiveDir || path.join(".local-data", "source-archives", safeSegment(options.archiveName.replace(/\.7z$/i, "")))
  );
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-upload-series-source.mjs [--apply] [--package] [--upload]

Default target:
  page: ${DEFAULT_PAGE_ID}
  source: ${DEFAULT_SOURCE_DIR}

Useful examples:
  node tools/notion-upload-series-source.mjs
  node tools/notion-upload-series-source.mjs --package
  node tools/notion-upload-series-source.mjs --apply --package --upload
  node tools/notion-upload-series-source.mjs --apply --upload --max-upload-files 1
`);
}

function dotenv(name) {
  if (fs.existsSync(".env")) {
    const raw = fs.readFileSync(".env", "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match?.[1] === name) {
        return match[2].trim();
      }
    }
  }
  return process.env[name];
}

function richText(content) {
  return [{ type: "text", text: { content } }];
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function pageTitle(page) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === "title") {
      return plainText(property.title);
    }
  }
  return "";
}

function publicTitle(title) {
  return title.replace(/^(?:【敬请期待】|【仅供下载】)\s*/, "").trim();
}

function productionTitle(title) {
  return title.replace(/^【敬请期待】\s*/, "").trim();
}

function titlePropertyName(page) {
  for (const [name, property] of Object.entries(page.properties ?? {})) {
    if (property.type === "title") {
      return name;
    }
  }
  return "title";
}

function blockTitle(block) {
  const payload = block[block.type] ?? {};
  if (block.type === "child_page") return payload.title ?? "";
  if (block.type === "toggle") return plainText(payload.rich_text);
  if (block.type === "callout") return plainText(payload.rich_text);
  if (block.type === "file") return payload.name ?? "";
  return "";
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

function safeSegment(value) {
  return value.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
}

function humanGb(bytes) {
  return `${(bytes / 1e9).toFixed(bytes >= 10e9 ? 1 : 2).replace(/\.0$/, "")}GB`;
}

function sumBytes(files) {
  return files.reduce((sum, file) => sum + file.size, 0);
}

function archivePartPattern(archiveName) {
  const escaped = archiveName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\.\\d{3}$`, "i");
}

function uploadFilenameFor(fileName) {
  const match = fileName.match(/^(.*\.7z)\.(\d{3})$/i);
  if (match) {
    return `${match[1]}.part-${match[2]}.7z`;
  }
  return fileName;
}

function readManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return { uploads: {} };
  }
  return JSON.parse(fs.readFileSync(manifestPath, "utf8"));
}

function writeManifest(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

async function updatePageTitle(notion, page, newTitle, apply) {
  const current = pageTitle(page);
  if (!newTitle || current === newTitle) {
    return current;
  }
  console.log(`${apply ? "update" : "would update"} page title: ${current} -> ${newTitle}`);
  if (apply) {
    await notion.pages.update({
      page_id: page.id,
      properties: {
        [titlePropertyName(page)]: { title: richText(newTitle) }
      }
    });
  }
  return newTitle;
}

async function updateMainPageProperties(notion, page, options) {
  const patch = {};
  const title = pageTitle(page);
  const cleanedTitle = productionTitle(title);
  const targetTitle = options.mainTitle || (options.forceTitle ? cleanedTitle : "");
  if (targetTitle && targetTitle !== title) {
    patch[titlePropertyName(page)] = { title: richText(targetTitle) };
  }
  if (page.properties?.["影别"]?.type === "select" && page.properties["影别"].select?.name !== "TV Series") {
    patch["影别"] = { select: { name: "TV Series" } };
  }

  if (Object.keys(patch).length === 0) {
    return;
  }

  console.log(`${options.apply ? "update" : "would update"} main page properties: ${Object.keys(patch).join(", ")}`);
  if (options.apply) {
    await notion.pages.update({ page_id: page.id, properties: patch });
  }
}

async function ensureChildPage(notion, parentBlockId, title, apply, options = {}) {
  const children = await listChildren(notion, parentBlockId);
  const existing = children.find((block) => block.type === "child_page" && blockTitle(block) === title);
  if (existing) {
    return existing.id;
  }

  const reusable = children.find((block) => block.type === "child_page");
  if (reusable) {
    const page = await notion.pages.retrieve({ page_id: reusable.id });
    await updatePageTitle(notion, page, title, apply);
    return reusable.id;
  }

  console.log(`${apply ? "create" : "would create"} child page "${title}" under ${parentBlockId}`);
  if (!apply) {
    return undefined;
  }
  if (options.createAsPage) {
    const page = await notion.pages.create({
      parent: { page_id: parentBlockId },
      properties: {
        title: { title: richText(title) }
      }
    });
    return page.id;
  }
  const response = await notion.blocks.children.append({
    block_id: parentBlockId,
    children: [{ type: "child_page", child_page: { title } }]
  });
  return response.results[0]?.id;
}

async function findFirstChildPage(notion, parentBlockId, titlePattern) {
  const children = await listChildren(notion, parentBlockId);
  return children.find((block) => block.type === "child_page" && titlePattern.test(blockTitle(block)));
}

async function ensureSeriesTree(notion, page, options, archiveBytes) {
  await updateMainPageProperties(notion, page, options);

  const mainChildren = await listChildren(notion, page.id);
  const callout = mainChildren.find((block) => block.type === "callout");
  const baseToggle = mainChildren.find((block) => block.type === "toggle" && /基地/.test(blockTitle(block)));
  if (!callout) throw new Error("No callout block found for playable/spec section.");
  if (!baseToggle) throw new Error("No 基地 toggle block found for source section.");

  const title = publicTitle(options.mainTitle || pageTitle(page));
  const specTitle = options.specTitle || `${title} 普通话 繁简英 ${humanGb(archiveBytes)}`;
  const sourceSizeTitle = options.sourceSizeTitle || humanGb(archiveBytes);

  const specPageId = await ensureChildPage(notion, callout.id, specTitle, options.apply);
  const sourcePageBlock = await findFirstChildPage(notion, baseToggle.id, /^(片源|资源)$/);
  if (!sourcePageBlock) {
    throw new Error("No 片源/资源 child page found under 基地.");
  }
  const sizePageId = await ensureChildPage(notion, sourcePageBlock.id, sourceSizeTitle, options.apply, {
    createAsPage: true
  });

  return { specPageId, sourcePageId: sourcePageBlock.id, sizePageId, specTitle, sourceSizeTitle };
}

function collectSourceFiles(sourceDir) {
  return fs.readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const fullPath = path.join(sourceDir, entry.name);
      return { name: entry.name, path: fullPath, size: fs.statSync(fullPath).size };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function collectArchiveParts(options) {
  if (!fs.existsSync(options.archiveDir)) {
    return [];
  }
  const pattern = archivePartPattern(options.archiveName);
  return fs.readdirSync(options.archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(options.archiveDir, entry.name);
      return { name: entry.name, path: fullPath, size: fs.statSync(fullPath).size };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

async function packageArchives(options, sourceFiles) {
  fs.mkdirSync(options.archiveDir, { recursive: true });
  const archivePath = path.join(options.archiveDir, options.archiveName);
  const args = ["a", "-t7z", "-mx=0", `-v${options.volumeSize}`, archivePath, ...sourceFiles.map((file) => file.name)];
  console.log(`run: 7z ${args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ")}`);
  await new Promise((resolve, reject) => {
    const child = spawn("7z", args, { cwd: options.sourceDir, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`7z exited with ${code}`));
    });
  });
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

async function uploadFile(notion, file, options, manifest, manifestPath) {
  const contentType = "application/x-7z-compressed";
  const uploadFilename = uploadFilenameFor(file.name);
  const partBytes = Math.max(1, Math.floor(options.partMiB)) * 1024 * 1024;
  const partCount = Math.ceil(file.size / partBytes);
  const record = manifest.uploads[file.name] ?? {
    filename: file.name,
    uploadFilename,
    size: file.size,
    sentParts: 0
  };

  if (record.status === "uploaded" && record.fileUploadId) {
    console.log(`reuse uploaded ${file.name} ${record.fileUploadId}`);
    return record.fileUploadId;
  }

  if (!record.fileUploadId) {
    const mode = partCount === 1 ? "single_part" : "multi_part";
    console.log(`create upload ${file.name}: ${mode}, ${partCount} part(s)`);
    const upload = await notion.fileUploads.create({
      mode,
      filename: uploadFilename,
      content_type: contentType,
      ...(mode === "multi_part" ? { number_of_parts: partCount } : {})
    });
    record.fileUploadId = upload.id;
    record.mode = mode;
    record.partCount = partCount;
    record.sentParts = 0;
    manifest.uploads[file.name] = record;
    writeManifest(manifestPath, manifest);
  }

  if (record.mode === "single_part") {
    const data = await readChunk(file.path, 0, file.size);
    await notion.fileUploads.send({
      file_upload_id: record.fileUploadId,
      file: { filename: uploadFilename, data: new Blob([data], { type: contentType }) }
    });
    record.sentParts = 1;
  } else {
    for (let part = (record.sentParts ?? 0) + 1; part <= partCount; part += 1) {
      const offset = (part - 1) * partBytes;
      const length = Math.min(partBytes, file.size - offset);
      const data = await readChunk(file.path, offset, length);
      console.log(`send ${file.name} part ${part}/${partCount}`);
      await notion.fileUploads.send({
        file_upload_id: record.fileUploadId,
        part_number: String(part),
        file: { filename: uploadFilename, data: new Blob([data], { type: contentType }) }
      });
      record.sentParts = part;
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

async function appendUploadedFiles(notion, sizePageId, files, uploadedIds, apply) {
  const existing = await listChildren(notion, sizePageId);
  const existingNames = new Set(existing.filter((block) => block.type === "file").map(blockTitle));
  const missing = files.filter((file) => !existingNames.has(file.name));
  if (missing.length === 0) {
    console.log("all archive file blocks already exist");
    return;
  }

  console.log(`${apply ? "append" : "would append"} ${missing.length} file block(s) to source size page`);
  if (!apply) {
    return;
  }
  await notion.blocks.children.append({
    block_id: sizePageId,
    children: missing.map((file) => ({
      type: "file",
      file: {
        type: "file_upload",
        file_upload: { id: uploadedIds.get(file.name) },
        name: file.name,
        caption: []
      }
    }))
  });
}

async function main() {
  const options = parseArgs();
  const token = dotenv("NOTION_TOKEN");
  if (!token) throw new Error("NOTION_TOKEN is required in .env or environment.");
  if (!fs.existsSync(options.sourceDir)) throw new Error(`Source dir not found: ${options.sourceDir}`);

  const sourceFiles = collectSourceFiles(options.sourceDir);
  if (sourceFiles.length === 0) throw new Error(`No source files found: ${options.sourceDir}`);
  const sourceBytes = sumBytes(sourceFiles);
  console.log(`source files: ${sourceFiles.length}, ${sourceBytes} bytes (${humanGb(sourceBytes)})`);
  console.log(`archive dir: ${options.archiveDir}`);
  console.log(`mode: ${options.apply ? "apply" : "dry-run"}${options.package ? ", package" : ""}${options.upload ? ", upload" : ""}`);

  let archiveParts = collectArchiveParts(options);
  if (archiveParts.length === 0 && options.package) {
    await packageArchives(options, sourceFiles);
    archiveParts = collectArchiveParts(options);
  } else if (archiveParts.length === 0) {
    console.log(`would package with 7z volume size ${options.volumeSize}`);
  }

  const archiveBytes = archiveParts.length > 0 ? sumBytes(archiveParts) : sourceBytes;
  if (archiveParts.length > 0) {
    console.log(`archive parts: ${archiveParts.length}, ${archiveBytes} bytes (${humanGb(archiveBytes)})`);
  }

  const notion = new Client({ auth: token, timeoutMs: 600000 });
  const page = await notion.pages.retrieve({ page_id: options.pageId });
  const tree = await ensureSeriesTree(notion, page, options, archiveBytes);
  console.log(`spec page: ${tree.specTitle} ${tree.specPageId ?? "(dry-run)"}`);
  console.log(`source size page: ${tree.sourceSizeTitle} ${tree.sizePageId ?? "(dry-run)"}`);

  if (!options.upload) {
    console.log("upload skipped; pass --apply --upload after archive parts exist.");
    return;
  }
  if (archiveParts.length === 0) {
    throw new Error("No archive parts found. Run with --package first or provide --archive-dir.");
  }
  if (!tree.sizePageId) {
    throw new Error("Source size page id is unavailable; run with --apply.");
  }

  const manifestPath = path.join(".local-data", `notion-source-upload-${options.pageId.replace(/-/g, "")}.json`);
  const manifest = readManifest(manifestPath);
  const uploadedIds = new Map();
  const uploadParts = archiveParts.slice(0, options.maxUploadFiles);
  if (uploadParts.length < archiveParts.length) {
    console.log(`upload limited: ${uploadParts.length}/${archiveParts.length} archive part(s)`);
  }
  for (const part of uploadParts) {
    const uploadId = await uploadFile(notion, part, options, manifest, manifestPath);
    uploadedIds.set(part.name, uploadId);
  }
  await appendUploadedFiles(notion, tree.sizePageId, uploadParts, uploadedIds, options.apply);
  console.log(`manifest written: ${manifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
