import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import https from "node:https";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";
import { selectExplicitChildTarget } from "./lib/notion-movie-target.mjs";
import { assertEpisodeTargetIsEmpty } from "./lib/notion-series-target.mjs";
import { probePlayableUpload } from "./lib/playable-upload-qc.mjs";
import { withTransientNotionUploadRetry } from "./lib/notion-upload-retry.mjs";

const DEFAULT_PAGE_ID = "39120ac12f0a80e69374d19602a6e59b";
const DEFAULT_SOURCE_DIR = "C:\\Users\\fores\\OneDrive\\13_新时期\\boccaro\\trans";
const DEFAULT_PART_MIB = 20;

function parseArgs() {
  const options = {
    pageId: DEFAULT_PAGE_ID,
    title: "",
    chineseTitle: "",
    englishTitle: "",
    year: undefined,
    sourceDir: DEFAULT_SOURCE_DIR,
    filePattern: "Teach.You.a.Lesson.S01E*.mp4",
    targetSpecPageId: "",
    specTitle: "",
    partMiB: DEFAULT_PART_MIB,
    maxFiles: Infinity,
    episodeNumberOverride: undefined,
    episodeFrom: undefined,
    episodeTo: undefined,
    episodeOffset: 0,
    create: false,
    createSpec: false,
    createEpisodes: false,
    apply: false,
    prepareOnly: false,
    replaceExistingVideo: false,
    allowCollections: false,
    resolveIp: "",
    localAddress: "",
    noProxy: false
  };
  let pageIdProvided = false;
  let sourceDirProvided = false;

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") {
      options.pageId = args[++index];
      pageIdProvided = true;
    }
    else if (arg === "--title") options.title = args[++index];
    else if (arg === "--chinese-title") options.chineseTitle = args[++index];
    else if (arg === "--english-title") options.englishTitle = args[++index];
    else if (arg === "--year") options.year = Number(args[++index]);
    else if (arg === "--source-dir") {
      options.sourceDir = args[++index];
      sourceDirProvided = true;
    }
    else if (arg === "--file-pattern") options.filePattern = args[++index];
    else if (arg === "--target-spec-page-id") options.targetSpecPageId = args[++index];
    else if (arg === "--spec-title") options.specTitle = args[++index];
    else if (arg === "--part-mib") options.partMiB = Number(args[++index]);
    else if (arg === "--max-files") options.maxFiles = Number(args[++index]);
    else if (arg === "--episode-number") options.episodeNumberOverride = Number(args[++index]);
    else if (arg === "--episode-from") options.episodeFrom = Number(args[++index]);
    else if (arg === "--episode-to") options.episodeTo = Number(args[++index]);
    else if (arg === "--episode-offset") options.episodeOffset = Number(args[++index]);
    else if (arg === "--create") options.create = true;
    else if (arg === "--create-spec") options.createSpec = true;
    else if (arg === "--create-episodes") options.createEpisodes = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--prepare-only") options.prepareOnly = true;
    else if (arg === "--replace-existing-video") options.replaceExistingVideo = true;
    else if (arg === "--allow-collections") options.allowCollections = true;
    else if (arg === "--resolve-ip") options.resolveIp = args[++index];
    else if (arg === "--local-address") options.localAddress = args[++index];
    else if (arg === "--no-proxy") options.noProxy = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  options.sourceDir = path.resolve(options.sourceDir);
  options.sourceDirProvided = sourceDirProvided;
  if (options.create && !pageIdProvided) options.pageId = "";
  if (options.create && !pageIdProvided && !options.title) throw new Error("--create requires --title.");
  if (options.specTitle && !options.targetSpecPageId && !options.createSpec) {
    throw new Error("--spec-title requires --target-spec-page-id or --create-spec; refusing implicit spec-page selection.");
  }
  if (!options.pageId && !options.create) throw new Error("--page-id or --create is required.");
  if (options.episodeFrom != null && (!Number.isInteger(options.episodeFrom) || options.episodeFrom < 1)) {
    throw new Error("--episode-from must be a positive integer.");
  }
  if (options.episodeTo != null && (!Number.isInteger(options.episodeTo) || options.episodeTo < 1)) {
    throw new Error("--episode-to must be a positive integer.");
  }
  if (options.episodeNumberOverride != null && (!Number.isInteger(options.episodeNumberOverride) || options.episodeNumberOverride < 1)) {
    throw new Error("--episode-number must be a positive integer.");
  }
  if (options.episodeFrom != null && options.episodeTo != null && options.episodeTo < options.episodeFrom) {
    throw new Error("--episode-to must be greater than or equal to --episode-from.");
  }
  if (!Number.isInteger(options.episodeOffset)) throw new Error("--episode-offset must be an integer.");
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-upload-series-videos.mjs [--apply] [--max-files 1]
  node tools/notion-upload-series-videos.mjs --create --title "摩登情爱 第一季 Modern Love Season 1 (2019)" --create-episodes
  node tools/notion-upload-series-videos.mjs --page-id <series-page-id> --source-dir E:\\video_made --file-pattern "Fallout.S02E*.mp4" --spec-title "辐射 第二季 繁英 1.0-1.3GB/集" --create --create-episodes --prepare-only --apply

Examples:
  node tools/notion-upload-series-videos.mjs
  node tools/notion-upload-series-videos.mjs --apply --max-files 1
  node tools/notion-upload-series-videos.mjs --apply
  node tools/notion-upload-series-videos.mjs --create --title "摩登情爱 第一季 Modern Love Season 1 (2019)" --source-dir E:\\video_made --file-pattern "Modern.Love.2019.S01E02*.mp4" --spec-title "摩登情爱 第一季 繁 0.44GB/集" --create-episodes --apply

Options:
  --prepare-only  Create/reuse the spec and Episode page structure before long encode or upload, then skip file uploads.
  --episode-offset <integer>  Adjust parsed episode numbers for source naming schemes such as OVA.03 -> Episode 01.
  --episode-number <integer>  Explicitly map one selected file to an episode when its output filename has no episode token.
  --replace-existing-video
                  Append the new uploaded video first, then delete existing episode video blocks only after the append succeeds.
  --create-spec   With --spec-title, create/reuse that exact spec page instead of renaming the first existing spec.
                  When uploading into an existing spec, prefer --target-spec-page-id for an exact destination.
  --allow-collections
                  Explicitly permit multi-episode files and /合集 spec titles. Single-episode delivery is the default.
  --episode-from <number>
  --episode-to <number>
                  Select an inclusive single-episode range, useful when resuming a partially uploaded season.
  --resolve-ip <ip>
                  Explicit api.notion.com DNS fallback; hostname routing is the default.
  --local-address <ip>
                  Bind direct traffic to a physical interface; pair with --resolve-ip.
  --no-proxy
                  Bypass NOTION_PROXY_URL/HTTPS_PROXY for this run; use with --resolve-ip when needed.
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

function installNotionDnsOverride(notionApiIp) {
  if (!notionApiIp) return;
  const originalLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") return options(null, notionApiIp, 4);
      if (options?.all) return callback(null, [{ address: notionApiIp, family: 4 }]);
      return callback(null, notionApiIp, 4);
    }
    return originalLookup(hostname, options, callback);
  };
  console.log(`dns override: api.notion.com -> ${notionApiIp}`);
}

function createNotionClient(token, localAddress = "", noProxy = false) {
  const proxyUrl = dotenv("NOTION_PROXY_URL") || dotenv("HTTPS_PROXY") || dotenv("HTTP_PROXY");
  // A stalled multipart request must return to the bounded retry loop instead
  // of keeping the workflow in an apparently active state for ten minutes.
  const timeoutMs = Number(dotenv("NOTION_UPLOAD_REQUEST_TIMEOUT_MS") || 90000);
  const options = { auth: token, timeoutMs };
  if (localAddress) {
    options.fetch = nodeFetch;
    options.agent = new https.Agent({ keepAlive: true, localAddress });
    console.log(`direct local address: ${localAddress}`);
  } else if (noProxy) {
    options.fetch = nodeFetch;
    options.agent = new https.Agent({ keepAlive: true });
    console.log("direct: proxy bypass");
  } else if (proxyUrl) {
    options.fetch = nodeFetch;
    options.agent = new HttpsProxyAgent(proxyUrl);
    console.log(`proxy: ${proxyUrl}`);
  }
  return new Client(options);
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

function dataSourceTitlePropertyName(dataSource) {
  for (const [name, property] of Object.entries(dataSource.properties ?? {})) {
    if (property.type === "title") return name;
  }
  return "Title";
}

function richText(content) {
  return [{ type: "text", text: { content } }];
}

function setIfProperty(properties, dataSource, name, value) {
  if (dataSource.properties?.[name]) properties[name] = value;
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

export function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function episodeNumber(fileName) {
  return episodeRange(fileName)?.start;
}

export function episodeRange(fileName) {
  const baseName = path.basename(fileName, path.extname(fileName));
  const compactSeasonRange = fileName.match(/S\d+E\d{1,3}(?:E\d{1,3}){1,}/i);
  if (compactSeasonRange) {
    const episodes = [...compactSeasonRange[0].matchAll(/E(\d{1,3})/gi)].map((match) => Number(match[1]));
    if (episodes.length >= 2 && episodes.every((episode) => Number.isInteger(episode) && episode > 0)) {
      return { start: episodes[0], end: episodes.at(-1) };
    }
  }
  const rangeMatch =
    fileName.match(/S\d+E(\d{1,3})\s*[-~–—至到]\s*(?:S\d+)?E?(\d{1,3})/i) ??
    fileName.match(/E(?:pisode)?\s*(\d{1,3})\s*[-~–—至到]\s*(\d{1,3})/i) ??
    fileName.match(/第\s*(\d{1,3})\s*[-~–—至到]\s*(\d{1,3})\s*[集话話]/u);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
      return { start, end };
    }
  }
  const match =
    fileName.match(/S\d+E(\d+)/i) ??
    // Some older complete-season releases use S0401 for S04E01.
    fileName.match(/S\d{2}(\d{2,3})(?=[._\s-]|$)/i) ??
    fileName.match(/EP(?:isode)?[.\s_-]*(\d+)/i) ??
    fileName.match(/E(?:pisode)?\s*(\d+)/i) ??
    fileName.match(/OVA[.\s_-]*(\d+)/i) ??
    fileName.match(/\[(\d{1,3})[)\]]/) ??
    baseName.match(/(?:^|[-_\s])(?:ep(?:isode)?[-_\s]*)?(\d{1,3})$/i) ??
    baseName.match(/^(\d{1,3})$/);
  const episode = match ? Number(match[1]) : undefined;
  return episode ? { start: episode, end: episode } : undefined;
}

export function validateSeriesSpecTitle(title) {
  const value = String(title ?? "").trim();
  const hasSize = /\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*GB\b/i.test(value);
  if (hasSize && !/(?:\/\s*(?:集|合集)|每\s*集|per\s*(?:episode|collection))/iu.test(value)) {
    throw new Error(`Series spec size must be marked as per-episode or per-collection (/集 or /合集): ${value}`);
  }
  return value;
}

export function validateCollectionOptIn(files, specTitle, allowCollections = false) {
  const collectionFiles = files.filter(file => Number(file.episodeEnd) > Number(file.episode));
  const collectionTitle = /\/\s*合集|per\s*collection/iu.test(String(specTitle ?? ""));
  if (!allowCollections && (collectionFiles.length > 0 || collectionTitle)) {
    const names = collectionFiles.map(file => file.name).join(", ");
    throw new Error(`Series collections require explicit --allow-collections${names ? `: ${names}` : ""}`);
  }
  return true;
}

export function filterEpisodeRange(files, episodeFrom, episodeTo) {
  return files.filter((file) => {
    const start = Number(file.episode);
    const end = Number(file.episodeEnd ?? file.episode);
    if (!Number.isInteger(start) || !Number.isInteger(end)) return false;
    if (episodeFrom != null && start < episodeFrom) return false;
    if (episodeTo != null && end > episodeTo) return false;
    return true;
  });
}

export function collectSourceFiles(options) {
  if (!fs.existsSync(options.sourceDir)) throw new Error(`Source dir not found: ${options.sourceDir}`);
  const pattern = globToRegExp(options.filePattern);
  const entries = fs.readdirSync(options.sourceDir, { withFileTypes: true });
  const collected = entries
    .map((entry) => ({ entry, fullPath: path.join(options.sourceDir, entry.name) }))
    .filter(({ entry, fullPath }) => {
      // Dirent.isFile() can be false for Windows filesystem reparse entries
      // even when stat() resolves them to regular files (for example a
      // hard-linked staging file). Use the resolved file type for intake.
      return pattern.test(entry.name) && fs.statSync(fullPath).isFile();
    })
    .map(({ entry, fullPath }) => {
      const parsedEpisode = options.episodeNumberOverride ?? episodeNumber(entry.name);
      const parsedRange = options.episodeNumberOverride == null
        ? episodeRange(entry.name)
        : { start: parsedEpisode, end: parsedEpisode };
      return {
        name: entry.name,
        path: fullPath,
        size: fs.statSync(fullPath).size,
        episode: parsedEpisode == null ? undefined : parsedEpisode + options.episodeOffset,
        episodeEnd: parsedRange?.end == null ? undefined : parsedRange.end + options.episodeOffset
      };
    })
    .sort((left, right) => (left.episode ?? 9999) - (right.episode ?? 9999) || left.name.localeCompare(right.name, "en"));
  return collected;
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

async function createSeriesPage(notion, library, options) {
  const existing = await findPageByTitle(notion, library.dataSourceId, options.title);
  if (existing) return existing;
  if (!options.create) throw new Error(`Page not found: ${options.title}`);

  const properties = {
    [dataSourceTitlePropertyName(library.dataSource)]: { title: richText(options.title) }
  };
  const setRichTextProperty = (name, value) => {
    if (value && library.dataSource.properties?.[name]) {
      properties[name] = { rich_text: richText(value) };
    }
  };
  setRichTextProperty("Simplified Chinese Title", options.chineseTitle);
  setRichTextProperty("English Title", options.englishTitle);
  if (Number.isFinite(options.year)) properties["Release Year"] = { number: options.year };
  if (library.dataSource.properties?.["影别"]?.type === "select") properties["影别"] = { select: { name: "TV Series" } };
  setIfProperty(properties, library.dataSource, "Hide from Website", { checkbox: true });
  setIfProperty(properties, library.dataSource, "Needs Review", { checkbox: true });
  setIfProperty(properties, library.dataSource, "Media Availability", { select: { name: "needs_processing" } });
  setRichTextProperty("Developer Memo", "New series page created before playable upload, Media Assets readback, subtitles/QC, and playback verification are complete. Keep hidden and Needs Review until production evidence is verified.");

  console.log(`${options.apply ? "create" : "would create"} series page: ${options.title}`);
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

async function ensureChildPage(notion, parentPageId, title, apply) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const children = await listChildren(notion, parentPageId);
    const existing = children.find((block) => block.type === "child_page" && blockTitle(block) === title);
    if (existing) return { id: existing.id, title: blockTitle(existing) };
    if (attempt === 0 && apply) await sleep(750);
  }

  console.log(`${apply ? "create" : "would create"} child page "${title}" under ${parentPageId}`);
  if (!apply) return { id: "(dry-run)", title };
  const page = await notion.pages.create({
    parent: { page_id: parentPageId },
    properties: { title: { title: richText(title) } }
  });
  return { id: page.id, title };
}

async function findSpecPage(notion, pageId, options) {
  if (pageId === "(dry-run)" && options.create) {
    return { id: "(dry-run)", title: options.specTitle || "待制作" };
  }

  const children = await listChildren(notion, pageId);
  const calloutSpecPages = [];
  for (const callout of children.filter((block) => block.type === "callout")) {
    const specPages = (await listChildren(notion, callout.id)).filter((block) => block.type === "child_page");
    calloutSpecPages.push(...specPages);
  }

  const rootSpecPages = children.filter((block) => block.type === "child_page");
  const allSpecPages = [...calloutSpecPages, ...rootSpecPages];
  if (options.targetSpecPageId) {
    return selectExplicitChildTarget(
      allSpecPages.map((block) => ({ id: block.id, title: blockTitle(block) })),
      options.targetSpecPageId,
      "requested series page"
    );
  }
  if (options.createSpec) {
    if (!options.specTitle) throw new Error("--create-spec requires --spec-title.");
    const exactSpec = allSpecPages.find((block) => blockTitle(block) === options.specTitle);
    if (exactSpec) return { id: exactSpec.id, title: blockTitle(exactSpec) };
    return await ensureChildPage(notion, pageId, options.specTitle, options.apply);
  }

  if (calloutSpecPages.length > 0) return { id: calloutSpecPages[0].id, title: blockTitle(calloutSpecPages[0]) };

  const rootSpec = rootSpecPages[0];
  if (rootSpec) return { id: rootSpec.id, title: blockTitle(rootSpec) };

  if (options.create) {
    const title = options.specTitle || "待制作";
    return await ensureChildPage(notion, pageId, title, options.apply);
  }
  throw new Error("No spec child page found.");
}

async function collectEpisodePages(notion, specPageId) {
  const children = await listChildren(notion, specPageId);
  const pages = new Map();
  for (const child of children.filter((block) => block.type === "child_page")) {
    const range = episodeRange(blockTitle(child));
    if (range !== undefined) pages.set(episodeRangeKey(range.start, range.end), {
      id: child.id,
      title: blockTitle(child),
      episode: range.start,
      episodeEnd: range.end
    });
  }
  return pages;
}

function episodeRangeKey(start, end = start) {
  return `${start}-${end}`;
}

function episodePageTitle(start, end = start) {
  const first = String(start).padStart(2, "0");
  const last = String(end).padStart(2, "0");
  return end > start ? `Episode ${first}-${last}` : `Episode ${first}`;
}

async function updatePageTitle(notion, pageId, title, apply) {
  if (pageId === "(dry-run)") return;
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

async function ensureEpisodePages(notion, specPageId, episodePages, selectedFiles, apply, enabled) {
  const missing = selectedFiles.filter((file) => !episodePages.has(episodeRangeKey(file.episode, file.episodeEnd)));
  if (missing.length === 0) return episodePages;
  if (!enabled) {
    throw new Error(`Missing episode-range pages for: ${missing.map((file) => file.name).join(", ")}`);
  }
  if (specPageId === "(dry-run)") {
    for (const file of missing) {
      const episodeTitle = episodePageTitle(file.episode, file.episodeEnd);
      console.log(`would create episode page ${episodeTitle}`);
      episodePages.set(episodeRangeKey(file.episode, file.episodeEnd), { id: "(dry-run)", title: episodeTitle });
    }
    return episodePages;
  }
  for (const file of missing) {
    const episodeTitle = episodePageTitle(file.episode, file.episodeEnd);
    const page = await ensureChildPage(notion, specPageId, episodeTitle, apply);
    episodePages.set(episodeRangeKey(file.episode, file.episodeEnd), page);
  }
  return episodePages;
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

  // An incomplete upload is only resumable when its chunk geometry matches the
  // current run. Reusing a record created with another part size would send
  // different byte ranges under the old part count and corrupt the upload.
  if (record.fileUploadId && record.status !== "uploaded"
    && (record.size !== file.size || record.partMiB !== options.partMiB || record.partCount !== partCount)) {
    console.warn(`discard incompatible incomplete upload ${file.name}: old=${record.partMiB ?? "unknown"}MiB/${record.partCount ?? "unknown"} parts new=${options.partMiB}MiB/${partCount} parts`);
    record = { filename: file.name, size: file.size, sentParts: 0 };
    manifest.uploads[file.name] = record;
    writeManifest(manifestPath, manifest);
  }

  if (record.fileUploadId && isExpired(record)) {
    console.log(`discard expired upload ${file.name} ${record.fileUploadId}`);
    record = { filename: file.name, size: file.size, sentParts: 0 };
    manifest.uploads[file.name] = record;
    writeManifest(manifestPath, manifest);
  }

  if (record.status === "uploaded" && record.fileUploadId) {
    console.log(`reuse uploaded ${file.name} ${record.fileUploadId}`);
    return record.fileUploadId;
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
    record.partMiB = options.partMiB;
    record.expiryTime = upload.expiry_time;
    record.sentParts = 0;
    manifest.uploads[file.name] = record;
    writeManifest(manifestPath, manifest);
  }

  if (record.mode === "single_part") {
    const data = await readChunk(file.path, 0, file.size);
    await withTransientNotionUploadRetry(() => notion.fileUploads.send({
        file_upload_id: record.fileUploadId,
        file: { filename: file.name, data: new Blob([data], { type: contentType }) }
      }), {
        onRetry: ({ nextAttempt, delayMs, error }) => console.warn(
          `retry ${file.name} single part attempt ${nextAttempt} after ${delayMs}ms: ${error.message}`
        )
      });
    record.sentParts = 1;
  } else {
    for (let part = (record.sentParts ?? 0) + 1; part <= record.partCount; part += 1) {
      const offset = (part - 1) * partBytes;
      const length = Math.min(partBytes, file.size - offset);
      const data = await readChunk(file.path, offset, length);
      const startedAt = Date.now();
      console.log(`send ${file.name} part ${part}/${record.partCount}`);
      await withTransientNotionUploadRetry(() => notion.fileUploads.send({
          file_upload_id: record.fileUploadId,
          part_number: String(part),
          file: { filename: file.name, data: new Blob([data], { type: contentType }) }
        }), {
          onRetry: ({ nextAttempt, delayMs, error }) => console.warn(
            `retry ${file.name} part ${part}/${record.partCount} attempt ${nextAttempt} after ${delayMs}ms: ${error.message}`
          )
        });
      record.sentParts = part;
      record.lastPartSeconds = Number(((Date.now() - startedAt) / 1000).toFixed(3));
      record.updatedAt = new Date().toISOString();
      writeManifest(manifestPath, manifest);
      // Keep one shared Notion upload lane below the repository's one-request-per-second default.
      await sleep(1000);
    }
    console.log(`complete ${file.name}`);
    await withTransientNotionUploadRetry(
      () => notion.fileUploads.complete({ file_upload_id: record.fileUploadId }),
      {
        onRetry: ({ nextAttempt, delayMs, error }) => console.warn(
          `retry complete ${file.name} attempt ${nextAttempt} after ${delayMs}ms: ${error.message}`
        )
      }
    );
  }

  record.status = "uploaded";
  record.completedAt = new Date().toISOString();
  writeManifest(manifestPath, manifest);
  return record.fileUploadId;
}

async function appendEpisodeVideo(notion, episodePage, file, fileUploadId, apply, replaceExistingVideo = false) {
  const existing = await listChildren(notion, episodePage.id);
  const comparable = comparableName(file.name);
  if (existing.some((block) => block.type === "video" && comparableName(blockTitle(block)).includes(comparable))) {
    console.log(`video block already exists: ${episodePage.title} ${file.name}`);
    return;
  }
  const existingVideos = existing.filter((block) => block.type === "video");
  if (!replaceExistingVideo) {
    assertEpisodeTargetIsEmpty({ id: episodePage.id, videoCount: existingVideos.length });
  }

  console.log(`${apply ? "append" : "would append"} ${file.name} to ${episodePage.title}${replaceExistingVideo ? `, then replace ${existingVideos.length} old video block(s)` : ""}`);
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
  if (replaceExistingVideo) {
    for (const block of existingVideos) {
      await notion.blocks.delete({ block_id: block.id });
      console.log(`deleted replaced video block ${block.id} from ${episodePage.title}`);
    }
  }
}

async function assertSelectedEpisodeTargetsAreEmpty(notion, episodePages, selectedFiles, replaceExistingVideo = false) {
  for (const file of selectedFiles) {
    const episodePage = episodePages.get(episodeRangeKey(file.episode, file.episodeEnd));
    if (!episodePage) throw new Error(`Missing episode target for ${file.name}`);
    const blocks = await listChildren(notion, episodePage.id);
    if (!replaceExistingVideo) {
      assertEpisodeTargetIsEmpty({
        id: episodePage.id,
        videoCount: blocks.filter((block) => block.type === "video").length
      });
    }
  }
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  if (!token) throw new Error("NOTION_WRITE_TOKEN or NOTION_TOKEN is required.");

  let files;
  if (options.prepareOnly && !options.sourceDirProvided) {
    if (!options.createEpisodes || options.episodeFrom == null || options.episodeTo == null) {
      throw new Error("prepare-only without --source-dir requires --create-episodes with --episode-from and --episode-to.");
    }
    files = Array.from({ length: options.episodeTo - options.episodeFrom + 1 }, (_, index) => {
      const episode = options.episodeFrom + index;
      return { name: episodePageTitle(episode), path: null, size: 0, episode, episodeEnd: episode };
    });
  } else {
    files = filterEpisodeRange(
      collectSourceFiles(options),
      options.episodeFrom,
      options.episodeTo
    );
  }
  if (files.length === 0) throw new Error(`No matching files found: ${path.join(options.sourceDir, options.filePattern)}`);
  const selectedFiles = files.slice(0, options.maxFiles);
  validateCollectionOptIn(selectedFiles, options.specTitle, options.allowCollections);
  if (!options.prepareOnly) {
    for (const file of selectedFiles) {
      const qc = probePlayableUpload(file.path);
      console.log(`upload probe: ${file.name} ${qc.videoCodec} ${qc.codecTag || "(no tag)"}`);
    }
  }
  const notion = createNotionClient(token, options.localAddress, options.noProxy);
  const library = options.create ? await findLibrary(notion) : undefined;
  const page = options.pageId
    ? await notion.pages.retrieve({ page_id: options.pageId })
    : await createSeriesPage(notion, library, options);
  const specPage = await findSpecPage(notion, page.id, options);
  let episodePages = specPage.id === "(dry-run)" ? new Map() : await collectEpisodePages(notion, specPage.id);
  // Filename tags are hints only. They must not rename a prepared spec because
  // burned-in subtitle language can differ from tags inherited from a source.
  const specTitle = options.specTitle || specPage.title;
  validateSeriesSpecTitle(specTitle);
  episodePages = await ensureEpisodePages(notion, specPage.id, episodePages, selectedFiles, options.apply, options.createEpisodes);

  console.log(`page: ${pageTitle(page)} ${page.id}`);
  console.log(`spec page: ${specPage.title} ${specPage.id}`);
  console.log(`spec title: ${specTitle}`);
  console.log(`source files: ${files.length}; selected: ${selectedFiles.length}`);
  console.log(`mode: ${options.apply ? "apply" : "dry-run"}${options.prepareOnly ? " prepare-only" : ""}`);

  await updatePageTitle(notion, specPage.id, specTitle, options.apply);

  if (options.prepareOnly) {
    for (const file of selectedFiles) {
      const episodePage = episodePages.get(episodeRangeKey(file.episode, file.episodeEnd));
      console.log(`${options.apply ? "prepared" : "would prepare"} ${file.name} -> ${episodePage?.title ?? episodePageTitle(file.episode, file.episodeEnd)} ${episodePage?.id ?? "(missing)"}`);
    }
    console.log("prepare-only: upload skipped");
    return;
  }

  if (!options.apply) {
    for (const file of selectedFiles) {
      console.log(`would upload ${file.name} -> ${episodePageTitle(file.episode, file.episodeEnd)}`);
    }
    return;
  }

  await assertSelectedEpisodeTargetsAreEmpty(notion, episodePages, selectedFiles, options.replaceExistingVideo);

  const manifestPath = path.join(".local-data", `notion-series-video-upload-${page.id.replace(/-/g, "")}.json`);
  const manifest = readManifest(manifestPath);
  for (const file of selectedFiles) {
    const fileUploadId = await uploadVideo(notion, file, options, manifest, manifestPath);
    await appendEpisodeVideo(
      notion,
      episodePages.get(episodeRangeKey(file.episode, file.episodeEnd)),
      file,
      fileUploadId,
      options.apply,
      options.replaceExistingVideo
    );
  }
  console.log(`manifest written: ${manifestPath}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
