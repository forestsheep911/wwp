import fs from "node:fs";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@notionhq/client";

const DEFAULT_PART_MIB = 20;

function parseArgs() {
  const options = {
    pageId: "",
    title: "",
    chineseTitle: "",
    englishTitle: "",
    originalTitle: "",
    year: undefined,
    videos: [],
    sourceArchiveDir: "",
    sourceArchiveName: "",
    sourceSizeTitle: "",
    metaFile: "",
    metaTitle: "meta",
    partMiB: DEFAULT_PART_MIB,
    maxSourceFiles: Infinity,
    apply: false,
    create: false,
    uploadVideos: false,
    uploadSource: false,
    uploadMeta: false
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") options.pageId = args[++index];
    else if (arg === "--title") options.title = args[++index];
    else if (arg === "--chinese-title") options.chineseTitle = args[++index];
    else if (arg === "--english-title") options.englishTitle = args[++index];
    else if (arg === "--original-title") options.originalTitle = args[++index];
    else if (arg === "--year") options.year = Number(args[++index]);
    else if (arg === "--video") options.videos.push(path.resolve(args[++index]));
    else if (arg === "--source-archive-dir") options.sourceArchiveDir = path.resolve(args[++index]);
    else if (arg === "--source-archive-name") options.sourceArchiveName = args[++index];
    else if (arg === "--source-size-title") options.sourceSizeTitle = args[++index];
    else if (arg === "--meta-file") options.metaFile = path.resolve(args[++index]);
    else if (arg === "--meta-title") options.metaTitle = args[++index];
    else if (arg === "--part-mib") options.partMiB = Number(args[++index]);
    else if (arg === "--max-source-files") options.maxSourceFiles = Number(args[++index]);
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--create") options.create = true;
    else if (arg === "--upload-videos") options.uploadVideos = true;
    else if (arg === "--upload-source") options.uploadSource = true;
    else if (arg === "--upload-meta") options.uploadMeta = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.pageId && !options.create) throw new Error("--page-id or --create is required.");
  if (!options.title) throw new Error("--title is required.");
  if ((options.uploadVideos || options.uploadSource || options.uploadMeta) && !options.apply) {
    throw new Error("Upload flags require --apply.");
  }
  for (const video of options.videos) {
    if (!fs.existsSync(video)) throw new Error(`Video not found: ${video}`);
  }
  if (options.uploadSource && (!options.sourceArchiveDir || !options.sourceArchiveName)) {
    throw new Error("--upload-source requires --source-archive-dir and --source-archive-name.");
  }
  if (options.metaFile && !fs.existsSync(options.metaFile)) throw new Error(`Meta file not found: ${options.metaFile}`);
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-upload-movie-package.mjs --create --title "边缘日记 The Basketball Diaries (1995)" --apply

Useful flags:
  --video <mp4>                 repeatable
  --source-archive-dir <dir>    directory containing split .7z parts
  --source-archive-name <name>  base archive name, for example movie.7z
  --meta-file <7z>              small metadata archive
  --upload-videos --upload-meta --upload-source
`);
}

function dotenv(name) {
  if (fs.existsSync(".env")) {
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match?.[1] === name) return match[2].trim();
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
    if (property.type === "title") return plainText(property.title);
  }
  return "";
}

function titlePropertyName(pageOrDataSource) {
  for (const [name, property] of Object.entries(pageOrDataSource.properties ?? {})) {
    if (property.type === "title") return name;
  }
  return "Title";
}

function blockTitle(block) {
  const payload = block[block.type] ?? {};
  if (block.type === "child_page") return payload.title ?? "";
  if (block.type === "callout" || block.type === "toggle" || block.type === "paragraph") return plainText(payload.rich_text);
  if (block.type === "video") return payload.name ?? payload.file?.url ?? payload.external?.url ?? "";
  if (block.type === "file") return payload.name ?? payload.file?.url ?? "";
  return "";
}

function linkedPageId(block) {
  const payload = block.link_to_page;
  if (block.type !== "link_to_page" || !payload) return "";
  if (payload.type === "page_id") return payload.page_id;
  return "";
}

function humanGb(bytes) {
  return `${(bytes / 1e9).toFixed(bytes >= 10e9 ? 1 : 2).replace(/\.0$/, "")}GB`;
}

function specLabelFromFilename(filename) {
  const normalized = filename.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const capacity = normalized.includes("high") ? "高" : normalized.includes("mid") ? "中" : normalized.includes("low") ? "低" : "";
  let subtitle = "";
  if (normalized.includes("chschteng") || normalized.includes("chtchseng")) subtitle = "繁简英";
  else if (normalized.includes("chscht") || normalized.includes("chtchs")) subtitle = "繁简";
  else if (normalized.includes("chteng")) subtitle = "繁英";
  else if (normalized.includes("chseng")) subtitle = "简英";
  else if (normalized.includes("cht")) subtitle = "繁";
  else if (normalized.includes("chs")) subtitle = "简";
  return [subtitle, capacity].filter(Boolean).join(" ");
}

function comparableFilename(value) {
  return decodeURIComponent(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function archivePartPattern(archiveName) {
  const escaped = archiveName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}\\.\\d{3}$`, "i");
}

function uploadFilenameFor(fileName) {
  const match = fileName.match(/^(.*\.7z)\.(\d{3})$/i);
  if (match) return `${match[1]}.part-${match[2]}.7z`;
  return fileName;
}

function contentTypeFor(fileName) {
  if (/\.mp4$/i.test(fileName)) return "video/mp4";
  if (/\.7z(?:\.\d{3})?$/i.test(fileName)) return "application/x-7z-compressed";
  return "application/octet-stream";
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

async function findLibrary(notion) {
  const configuredDataSourceId = dotenv("NOTION_LIBRARY_DATA_SOURCE_ID");
  if (configuredDataSourceId) {
    const dataSource = await notion.dataSources.retrieve({ data_source_id: configuredDataSourceId });
    return { dataSourceId: configuredDataSourceId, dataSource };
  }

  const root = dotenv("NOTION_LIBRARY_ROOT_PAGE_ID") || dotenv("PAGE_ID");
  if (!root) throw new Error("NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_LIBRARY_ROOT_PAGE_ID is required.");
  const children = await listChildren(notion, root);
  const database = children.find((block) => block.type === "child_database");
  if (!database) throw new Error("No child database found under library root.");
  const db = await notion.databases.retrieve({ database_id: database.id });
  const dataSourceId = db.data_sources?.[0]?.id ?? database.id;
  const dataSource = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  return { dataSourceId, databaseId: database.id, dataSource };
}

async function findPageByTitle(notion, dataSourceId, title) {
  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    page_size: 5,
    filter: { property: "Title", title: { equals: title } }
  });
  return response.results[0];
}

async function createMoviePage(notion, library, options) {
  const existing = await findPageByTitle(notion, library.dataSourceId, options.title);
  if (existing) return existing;
  if (!options.create) throw new Error(`Page not found: ${options.title}`);

  const properties = {
    [titlePropertyName(library.dataSource)]: { title: richText(options.title) }
  };
  if (options.chineseTitle) properties["Chinese Title"] = { rich_text: richText(options.chineseTitle) };
  if (options.englishTitle) properties["English Title"] = { rich_text: richText(options.englishTitle) };
  if (options.originalTitle) properties["Original Title"] = { rich_text: richText(options.originalTitle) };
  if (Number.isFinite(options.year)) properties["Release Year"] = { number: options.year };
  if (library.dataSource.properties?.["影别"]?.type === "select") properties["影别"] = { select: { name: "Movie" } };

  console.log(`${options.apply ? "create" : "would create"} movie page: ${options.title}`);
  if (!options.apply) return { id: "(dry-run)", properties };

  try {
    return await notion.pages.create({
      parent: { data_source_id: library.dataSourceId },
      properties
    });
  } catch (error) {
    if (!library.databaseId) throw error;
    console.log(`data_source parent create failed; retry with database parent: ${error.message}`);
    return await notion.pages.create({
      parent: { database_id: library.databaseId },
      properties
    });
  }
}

async function ensureDividerAndBase(notion, pageId, apply) {
  const children = await listChildren(notion, pageId);
  let base = children.find((block) => block.type === "toggle" && /基地/.test(blockTitle(block)));
  if (base) return base.id;
  console.log(`${apply ? "create" : "would create"} divider and 基地 toggle`);
  if (!apply) return undefined;
  const response = await notion.blocks.children.append({
    block_id: pageId,
    children: [
      { type: "divider", divider: {} },
      { type: "toggle", toggle: { rich_text: richText("基地"), children: [] } }
    ]
  });
  base = response.results.find((block) => block.type === "toggle");
  return base?.id;
}

async function ensureChildPageBlock(notion, parentBlockId, title, apply) {
  return await ensureChildPageBlockWithFallback(notion, parentBlockId, title, apply);
}

async function findChildPageByTitle(notion, parentPageId, title) {
  const children = await listChildren(notion, parentPageId);
  return children.find((block) => block.type === "child_page" && blockTitle(block) === title);
}

async function ensureLinkToPage(notion, parentBlockId, pageId, apply) {
  const children = await listChildren(notion, parentBlockId);
  if (children.some((block) => linkedPageId(block) === pageId)) return;
  console.log(`${apply ? "append" : "would append"} link_to_page ${pageId} under ${parentBlockId}`);
  if (!apply) return;
  await notion.blocks.children.append({
    block_id: parentBlockId,
    children: [{ type: "link_to_page", link_to_page: { type: "page_id", page_id: pageId } }]
  });
}

async function ensureChildPageBlockWithFallback(notion, parentBlockId, title, apply, fallbackParentPageId) {
  const children = await listChildren(notion, parentBlockId);
  const existing = children.find((block) => block.type === "child_page" && blockTitle(block) === title);
  if (existing) return existing.id;
  if (fallbackParentPageId) {
    const linked = children.find((block) => block.type === "link_to_page" && linkedPageId(block));
    if (linked) {
      const linkedPage = await notion.pages.retrieve({ page_id: linkedPageId(linked) });
      if (pageTitle(linkedPage) === title) return linkedPage.id;
    }
  }
  console.log(`${apply ? "create" : "would create"} child page "${title}" under ${parentBlockId}`);
  if (!apply) return undefined;
  try {
    const response = await notion.blocks.children.append({
      block_id: parentBlockId,
      children: [{ type: "child_page", child_page: { title } }]
    });
    return response.results[0]?.id;
  } catch (error) {
    if (!fallbackParentPageId || error.code !== "validation_error") throw error;
    const existingRootPage = await findChildPageByTitle(notion, fallbackParentPageId, title);
    const pageId = existingRootPage?.id ?? (await notion.pages.create({
      parent: { page_id: fallbackParentPageId },
      properties: { title: { title: richText(title) } }
    })).id;
    console.log(`fallback page child created/used at page root: ${title} ${pageId}`);
    await ensureLinkToPage(notion, parentBlockId, pageId, apply);
    return pageId;
  }
}

async function ensurePageChild(notion, parentPageId, title, apply) {
  const children = await listChildren(notion, parentPageId);
  const existing = children.find((block) => block.type === "child_page" && blockTitle(block) === title);
  if (existing) return existing.id;
  console.log(`${apply ? "create" : "would create"} page "${title}" under ${parentPageId}`);
  if (!apply) return undefined;
  const page = await notion.pages.create({
    parent: { page_id: parentPageId },
    properties: { title: { title: richText(title) } }
  });
  return page.id;
}

async function ensureVideoTarget(notion, pageId, title, apply) {
  const mainChildren = await listChildren(notion, pageId);
  for (const callout of mainChildren.filter((block) => block.type === "callout")) {
    const children = await listChildren(notion, callout.id);
    const existing = children.find((block) => block.type === "child_page" && blockTitle(block) === title);
    if (existing) return existing.id;
    for (const link of children.filter((block) => block.type === "link_to_page" && linkedPageId(block))) {
      const linkedPage = await notion.pages.retrieve({ page_id: linkedPageId(link) });
      if (pageTitle(linkedPage) === title) return linkedPage.id;
    }
  }
  const existingRootPage = await findChildPageByTitle(notion, pageId, title);
  if (existingRootPage) return existingRootPage.id;

  let emptyCallout;
  for (const callout of mainChildren.filter((block) => block.type === "callout")) {
    if ((await listChildren(notion, callout.id)).length === 0) {
      emptyCallout = callout;
      break;
    }
  }
  if (emptyCallout) {
    return await ensureChildPageBlockWithFallback(notion, emptyCallout.id, title, apply, pageId);
  }

  console.log(`${apply ? "create" : "would create"} callout spec page: ${title}`);
  if (!apply) return undefined;
  const calloutResponse = await notion.blocks.children.append({
    block_id: pageId,
    children: [
      {
        type: "callout",
        callout: {
          rich_text: richText("😃"),
          icon: { type: "emoji", emoji: "😃" },
          children: []
        }
      }
    ]
  });
  const callout = calloutResponse.results[0];
  return await ensureChildPageBlockWithFallback(notion, callout.id, title, apply, pageId);
}

async function uploadFile(notion, file, options, manifest, manifestPath) {
  const contentType = contentTypeFor(file.name);
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
    record.expiryTime = upload.expiry_time;
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
      const startedAt = Date.now();
      console.log(`send ${file.name} part ${part}/${partCount}`);
      await notion.fileUploads.send({
        file_upload_id: record.fileUploadId,
        part_number: String(part),
        file: { filename: uploadFilename, data: new Blob([data], { type: contentType }) }
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

async function appendVideoBlock(notion, targetPageId, file, fileUploadId, apply) {
  const existing = await listChildren(notion, targetPageId);
  const comparable = comparableFilename(file.name);
  if (existing.some((block) => block.type === "video" && comparableFilename(blockTitle(block)).includes(comparable))) {
    console.log(`video block already exists: ${file.name}`);
    return;
  }
  console.log(`${apply ? "append" : "would append"} video: ${file.name}`);
  if (!apply) return;
  await notion.blocks.children.append({
    block_id: targetPageId,
    children: [{ type: "video", video: { type: "file_upload", file_upload: { id: fileUploadId }, caption: [] } }]
  });
}

async function appendFileBlocks(notion, targetPageId, files, uploadedIds, apply) {
  const existing = await listChildren(notion, targetPageId);
  const existingNames = new Set(existing.filter((block) => block.type === "file").map(blockTitle));
  const missing = files.filter((file) => !existingNames.has(file.name));
  if (missing.length === 0) {
    console.log("all file blocks already exist");
    return;
  }
  console.log(`${apply ? "append" : "would append"} ${missing.length} file block(s)`);
  if (!apply) return;
  await notion.blocks.children.append({
    block_id: targetPageId,
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

function collectArchiveParts(options) {
  if (!options.sourceArchiveDir || !options.sourceArchiveName || !fs.existsSync(options.sourceArchiveDir)) return [];
  const pattern = archivePartPattern(options.sourceArchiveName);
  return fs.readdirSync(options.sourceArchiveDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(options.sourceArchiveDir, entry.name);
      return { name: entry.name, path: fullPath, size: fs.statSync(fullPath).size };
    })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function fileFromPath(filePath) {
  return { name: path.basename(filePath), path: filePath, size: fs.statSync(filePath).size };
}

async function main() {
  const options = parseArgs();
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  if (!token) throw new Error("NOTION_WRITE_TOKEN or NOTION_TOKEN is required.");

  const notion = new Client({ auth: token, timeoutMs: 600000 });
  const library = await findLibrary(notion);
  const page = options.pageId
    ? await notion.pages.retrieve({ page_id: options.pageId })
    : await createMoviePage(notion, library, options);
  const pageId = page.id;
  const title = pageTitle(page) || options.title;
  const localTitle = options.chineseTitle || title.replace(/\s+[A-Za-z].*$/, "").replace(/\s*\(\d{4}\)\s*$/, "").trim();

  console.log(`page: ${title} ${pageId}`);
  console.log(`mode: ${options.apply ? "apply" : "dry-run"}`);
  if (!options.apply && pageId === "(dry-run)") {
    for (const videoPath of options.videos) {
      const file = fileFromPath(videoPath);
      const specTitle = `${localTitle} ${[specLabelFromFilename(file.name), humanGb(file.size)].filter(Boolean).join(" ")}`;
      console.log(`would create callout spec page: ${specTitle}`);
    }
    if (options.metaFile) console.log(`would create 基地 -> 资料 -> ${options.metaTitle}`);
    if (options.sourceArchiveName) console.log("would create 基地 -> 片源 -> source size page");
    console.log("dry-run stopped before block inspection because the movie page does not exist yet.");
    return;
  }

  const videoManifestPath = path.join(".local-data", `notion-movie-package-videos-${pageId.replace(/-/g, "")}.json`);
  const fileManifestPath = path.join(".local-data", `notion-movie-package-files-${pageId.replace(/-/g, "")}.json`);
  const videoManifest = readManifest(videoManifestPath);
  const fileManifest = readManifest(fileManifestPath);

  for (const videoPath of options.videos) {
    const file = fileFromPath(videoPath);
    const specTitle = `${localTitle} ${[specLabelFromFilename(file.name), humanGb(file.size)].filter(Boolean).join(" ")}`;
    const targetPageId = await ensureVideoTarget(notion, pageId, specTitle, options.apply);
    console.log(`video target: ${specTitle} ${targetPageId ?? "(dry-run)"}`);
    if (options.uploadVideos) {
      if (!targetPageId) throw new Error("Video target page unavailable.");
      const uploadId = await uploadFile(notion, file, options, videoManifest, videoManifestPath);
      await appendVideoBlock(notion, targetPageId, file, uploadId, options.apply);
    }
  }

  const baseId = await ensureDividerAndBase(notion, pageId, options.apply);
  console.log(`base toggle: ${baseId ?? "(dry-run)"}`);

  if (options.metaFile) {
    const dataPageId = await ensureChildPageBlockWithFallback(notion, baseId, "资料", options.apply, pageId);
    const metaPageId = await ensurePageChild(notion, dataPageId, options.metaTitle, options.apply);
    console.log(`meta target: ${options.metaTitle} ${metaPageId ?? "(dry-run)"}`);
    if (options.uploadMeta) {
      if (!metaPageId) throw new Error("Meta target page unavailable.");
      const file = fileFromPath(options.metaFile);
      const uploadId = await uploadFile(notion, file, options, fileManifest, fileManifestPath);
      await appendFileBlocks(notion, metaPageId, [file], new Map([[file.name, uploadId]]), options.apply);
    }
  }

  const archiveParts = collectArchiveParts(options);
  if (archiveParts.length > 0 || options.sourceArchiveName) {
    const archiveBytes = archiveParts.reduce((sum, file) => sum + file.size, 0);
    const sourceTitle = options.sourceSizeTitle || humanGb(archiveBytes);
    const sourcePageId = await ensureChildPageBlockWithFallback(notion, baseId, "片源", options.apply, pageId);
    const sizePageId = await ensurePageChild(notion, sourcePageId, sourceTitle, options.apply);
    console.log(`source target: ${sourceTitle} ${sizePageId ?? "(dry-run)"}`);
    console.log(`archive parts: ${archiveParts.length}, ${archiveBytes} bytes (${humanGb(archiveBytes)})`);
    if (options.uploadSource) {
      if (!sizePageId) throw new Error("Source target page unavailable.");
      if (archiveParts.length === 0) throw new Error("No source archive parts found.");
      const uploadParts = archiveParts.slice(0, options.maxSourceFiles);
      if (uploadParts.length < archiveParts.length) {
        console.log(`upload limited: ${uploadParts.length}/${archiveParts.length} source part(s)`);
      }
      const uploadedIds = new Map();
      for (const part of uploadParts) {
        const uploadId = await uploadFile(notion, part, options, fileManifest, fileManifestPath);
        uploadedIds.set(part.name, uploadId);
      }
      await appendFileBlocks(notion, sizePageId, uploadParts, uploadedIds, options.apply);
    }
  }

  console.log(`video manifest: ${videoManifestPath}`);
  console.log(`file manifest: ${fileManifestPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
