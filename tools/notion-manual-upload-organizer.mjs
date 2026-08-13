import fs from "node:fs";
import https from "node:https";
import dns from "node:dns";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

export const DEFAULT_RECENT_PAGE_LIMIT = 3;

function parseArgs() {
  const options = {
    pageIds: [],
    query: "",
    recent: DEFAULT_RECENT_PAGE_LIMIT,
    all: false,
    rootOnly: false,
    reportPath: ".local-data/notion-manual-upload-organizer-report.json",
    statePath: ".local-data/notion-manual-upload-organizer-state.json",
    specTitle: "",
    apply: false,
    resolveIp: "",
    noProxy: false,
    delayMs: 0
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--page-id") options.pageIds.push(value());
    else if (name === "--query") options.query = value();
    else if (name === "--recent") options.recent = Number(value());
    else if (arg === "--all") options.all = true;
    else if (arg === "--root-only") options.rootOnly = true;
    else if (name === "--report") options.reportPath = value();
    else if (name === "--state") options.statePath = value();
    else if (name === "--spec-title") options.specTitle = value();
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (name === "--no-proxy") options.noProxy = true;
    else if (name === "--delay-ms") options.delayMs = Number(value());
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.recent) || options.recent < 1) {
    throw new Error("--recent must be a positive number.");
  }
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) {
    throw new Error("--delay-ms must be zero or positive.");
  }
  if (options.specTitle && options.pageIds.length !== 1) {
    throw new Error("--spec-title requires exactly one --page-id.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-manual-upload-organizer.mjs --recent 3
  node tools/notion-manual-upload-organizer.mjs --all
  node tools/notion-manual-upload-organizer.mjs --all --root-only
  node tools/notion-manual-upload-organizer.mjs --all --state .local-data/notion-upload-state.json
  node tools/notion-manual-upload-organizer.mjs --query "罪人"
  node tools/notion-manual-upload-organizer.mjs --page-id <work-page-id> --spec-title "罪人 繁英 4.8GB"
  node tools/notion-manual-upload-organizer.mjs --page-id <work-page-id> --spec-title "罪人 繁英 4.8GB" --apply
  node tools/notion-manual-upload-organizer.mjs --page-id <work-page-id> --spec-title "罪人 繁英 4.8GB" --no-proxy --resolve-ip <notion-ip> --apply

Default mode is read-only and bounded to three recent pages. It scans WWP library
pages for manual upload landing media, especially video/file blocks placed directly
under a work or season page. Use exact --page-id values for a known upload; do not
raise --recent for routine workflow cycles.
Root-level playable media is reported as structure_incomplete and should be
organized into a spec child page before final Media Assets writes.
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

function installNotionDnsOverride(resolveIp) {
  const notionApiIp = resolveIp || dotenv("NOTION_API_RESOLVE_IP");
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

function createNotionClient(token, noProxy = false) {
  const proxyUrl = dotenv("NOTION_PROXY_URL") || dotenv("HTTPS_PROXY") || dotenv("HTTP_PROXY");
  const options = { auth: token, timeoutMs: Number(dotenv("NOTION_REQUEST_TIMEOUT_MS") || 30000) };
  if (noProxy) {
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

function cleanText(value = "") {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function richText(value) {
  const content = cleanText(String(value ?? ""));
  return content ? [{ text: { content: content.slice(0, 2000) } }] : [];
}

function pageTitle(page) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === "title") return cleanText(plainText(property.title));
  }
  return "";
}

function titlePropertyName(dataSource) {
  return Object.entries(dataSource.properties ?? {}).find(([, property]) => property.type === "title")?.[0] ?? "Title";
}

function blockTitle(block) {
  const payload = block[block.type] ?? {};
  if (block.type === "child_page") return cleanText(payload.title ?? "");
  if (["callout", "toggle", "paragraph", "heading_1", "heading_2", "heading_3"].includes(block.type)) {
    return cleanText(plainText(payload.rich_text));
  }
  if (block.type === "video" || block.type === "file") {
    return cleanText(plainText(payload.caption) || payload.name || fileNameFromUrl(payload.file?.url ?? payload.external?.url ?? ""));
  }
  return "";
}

function fileNameFromUrl(url = "") {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
  } catch {
    return "";
  }
}

function mediaUrl(block) {
  const payload = block[block.type] ?? {};
  return payload.file?.url ?? payload.external?.url ?? "";
}

function mediaPayload(block) {
  const payload = block[block.type] ?? {};
  const typed = payload[payload.type] ?? {};
  return {
    name: blockTitle(block) || fileNameFromUrl(mediaUrl(block)),
    url: mediaUrl(block),
    notionFileType: payload.type ?? "",
    expiryTime: typed.expiry_time ?? payload.file?.expiry_time ?? null
  };
}

function isMediaBlock(block) {
  return block.type === "video" || block.type === "file";
}

function isPlayableMedia(block) {
  if (!isMediaBlock(block)) return false;
  const info = mediaPayload(block);
  const text = `${info.name} ${info.url}`;
  return (
    /\.(mp4|m4v|mov|webm|mkv)(?:[?#].*)?$/i.test(text) &&
    !/\.(7z|zip|rar|srt|ass|ssa|sup|pdf|txt|nfo)(?:\.\d+)?(?:[?#].*)?$/i.test(text)
  );
}

function isSourceLikeMedia(block) {
  if (!isMediaBlock(block)) return false;
  const info = mediaPayload(block);
  return /\.(7z|zip|rar|iso|m2ts|bdmv)(?:\.\d+)?(?:[?#].*)?$/i.test(`${info.name} ${info.url}`);
}

function isSourceSpecTitle(title = "") {
  return /(?:原盘|原盤|片源|资源|資源|source|original disc)/iu.test(cleanText(title));
}

export function specMediaPlacementIssue(specTitle = "", mediaName = "") {
  if (!isSourceSpecTitle(specTitle)) return null;
  if (!/\.(mp4|m4v|mov|webm|mkv)(?:[?#].*)?$/i.test(String(mediaName ?? ""))) return null;
  return {
    code: "playable_media_in_source_spec",
    detail: "A playable video is under a source/original-disc spec page. Do not write it as a source asset or treat the placement as final; reupload it to the matching playable spec page.",
    suggestedAction: "reupload_to_playable_spec"
  };
}

function shortWorkTitle(title = "") {
  const normalized = cleanText(title);
  const beforeParen = normalized.replace(/\s*[\(（][12][0-9]{3}[\)）]\s*$/u, "").trim();
  const englishIndex = beforeParen.search(/\s[A-Z][A-Za-z0-9:'!.&-]+(?:\s|$)/u);
  if (englishIndex > 0) return beforeParen.slice(0, englishIndex).trim();
  return beforeParen || normalized;
}

function languageLabelFromName(name = "") {
  const text = name.toLowerCase();
  let audioLabel = "";
  let subtitleLabel = "";

  if (/\bzh[-_. ]?(?:mandarin|cn)\b|mandarin|普通话|普通話|国语|國語|国配|國配/u.test(text)) audioLabel = "国配";
  else if (/\bzh[-_. ]?cantonese\b|cantonese|粤语|粵語|粤配|粵配/u.test(text)) audioLabel = "粤配";
  else if (/\bzh[-_. ]?(?:taiwan|tw)\b|taiwan|台配|臺配/u.test(text)) audioLabel = "台配";
  else if (/\bzh\b|中文/u.test(text)) audioLabel = "中文";

  if (/\bchteng\b|繁英|繁.*英/u.test(text)) subtitleLabel = "繁英";
  else if (/\bchseng\b|简英|簡英|简.*英|簡.*英/u.test(text)) subtitleLabel = "简英";
  else if (/\bcht\b|繁/u.test(text)) subtitleLabel = "繁";
  else if (/\bchs\b|简|簡/u.test(text)) subtitleLabel = "简";

  return [audioLabel, subtitleLabel].filter(Boolean).join(" ") || "可播放";
}

function sizeLabelFromName(name = "") {
  const match = name.match(/(\d+(?:\.\d+)?)\s*(?:gb|gib)\b/iu);
  return match ? `${match[1]}GB` : "";
}

function variantLabelFromName(name = "") {
  const match = name.match(/\b(track\d+)\b/iu);
  return match ? match[1].toLowerCase() : "";
}

function episodeRangeFromName(name = "") {
  const text = String(name ?? "");
  const rangeMatch = text.match(/\bS\d{1,2}E(\d{1,3})\s*[-~–—至到]\s*(?:S\d{1,2})?E?(\d{1,3})\b/iu)
    ?? text.match(/\bEpisode[\s._-]*(\d{1,3})\s*[-~–—至到]\s*(\d{1,3})\b/iu)
    ?? text.match(/第\s*(\d{1,3})\s*[-~–—至到]\s*(\d{1,3})\s*[集话話]/u);
  if (rangeMatch) {
    const start = Number(rangeMatch[1]);
    const end = Number(rangeMatch[2]);
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
      return { start, end };
    }
  }
  const match = text.match(/\bS\d{1,2}E(\d{1,3})\b/iu)
    ?? text.match(/\bEpisode[\s._-]*(\d{1,3})\b/iu)
    ?? text.match(/\bE(\d{1,3})\b/iu);
  const episode = match ? Number(match[1]) : undefined;
  return episode ? { start: episode, end: episode } : undefined;
}

function episodeNumberFromName(name = "") {
  return episodeRangeFromName(name)?.start;
}

export function suggestedSpecTitle(workTitle, mediaName) {
  return [shortWorkTitle(workTitle), languageLabelFromName(mediaName), variantLabelFromName(mediaName), sizeLabelFromName(mediaName)]
    .filter(Boolean)
    .join(" ");
}

export function assignSuggestedTargets(rootLandingMedia, specPages) {
  const byTitle = new Map((specPages ?? []).map((spec) => [spec.title, spec]));
  return (rootLandingMedia ?? []).map((media) => {
    if (!media.playable || !media.suggestedSpecTitle) return media;

    const spec = byTitle.get(media.suggestedSpecTitle);
    if (!spec) {
      return {
        ...media,
        suggestedTarget: {
          kind: "spec_page",
          title: media.suggestedSpecTitle,
          status: "missing_spec_page"
        }
      };
    }

    const episodeRange = episodeRangeFromName(media.name);
    const episodeNumber = episodeRange?.start;
    if (episodeNumber !== undefined && (spec.episodePages ?? []).length > 0) {
      const episode = spec.episodePages.find((item) => (
        item.episodeNumber === episodeNumber &&
        (item.episodeEndNumber ?? item.episodeNumber) === (episodeRange?.end ?? episodeNumber)
      ));
      if (episode) {
        return {
          ...media,
          suggestedTarget: {
            kind: "episode_page",
            pageId: episode.pageId,
            title: episode.title,
            episodeNumber,
            ...(episodeRange?.end > episodeNumber ? { episodeEndNumber: episodeRange.end } : {}),
            specPageId: spec.pageId,
            specTitle: spec.title,
            status: "ready"
          }
        };
      }
      return {
        ...media,
        suggestedTarget: {
          kind: "episode_page",
          episodeNumber,
          ...(episodeRange?.end > episodeNumber ? { episodeEndNumber: episodeRange.end } : {}),
          specPageId: spec.pageId,
          specTitle: spec.title,
          status: "missing_episode_page"
        }
      };
    }

    return {
      ...media,
      suggestedTarget: {
        kind: "spec_page",
        pageId: spec.pageId,
        title: spec.title,
        status: "ready"
      }
    };
  });
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

async function loadLibraryDataSource(notion) {
  const dataSourceId = dotenv("NOTION_LIBRARY_DATA_SOURCE_ID");
  if (dataSourceId) return notion.dataSources.retrieve({ data_source_id: dataSourceId });

  const databaseId = dotenv("NOTION_LIBRARY_DATABASE_ID");
  if (databaseId) {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    return notion.dataSources.retrieve({ data_source_id: database.data_sources?.[0]?.id || databaseId });
  }

  throw new Error("Set NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_LIBRARY_DATABASE_ID.");
}

async function queryPages(notion, dataSource, query, limit) {
  const response = await notion.dataSources.query({
    data_source_id: dataSource.id,
    page_size: limit,
    filter: {
      property: titlePropertyName(dataSource),
      title: { contains: query }
    }
  });
  return response.results;
}

async function allPages(notion, dataSource, query = "") {
  const pages = [];
  let startCursor;
  do {
    const request = {
      data_source_id: dataSource.id,
      page_size: 100,
      ...(startCursor ? { start_cursor: startCursor } : {}),
      ...(query ? {
        filter: {
          property: titlePropertyName(dataSource),
          title: { contains: query }
        }
      } : {})
    };
    const response = await notion.dataSources.query(request);
    pages.push(...response.results);
    startCursor = response.has_more ? response.next_cursor : undefined;
  } while (startCursor);
  return pages;
}

async function recentPages(notion, dataSource, limit) {
  const response = await notion.dataSources.query({
    data_source_id: dataSource.id,
    page_size: limit,
    sorts: [{ timestamp: "last_edited_time", direction: "descending" }]
  });
  return response.results;
}

function summarizeMedia(block, path, structuralStatus, workTitle = "", specTitle = "") {
  const info = mediaPayload(block);
  const placementIssue = specMediaPlacementIssue(specTitle, info.name);
  const summary = {
    blockId: block.id,
    blockType: block.type,
    blockCreatedTime: block.created_time ?? null,
    blockLastEditedTime: block.last_edited_time ?? null,
    name: info.name,
    notionFileType: info.notionFileType,
    expiryTime: info.expiryTime,
    urlPresent: Boolean(info.url),
    playable: isPlayableMedia(block),
    sourceLike: isSourceLikeMedia(block),
    structuralStatus,
    path
  };
  if (placementIssue) {
    summary.placementIssue = placementIssue.code;
    summary.placementIssueDetail = placementIssue.detail;
    summary.recommendedAction = placementIssue.suggestedAction;
    summary.suggestedTargetSpecTitle = suggestedSpecTitle(workTitle, summary.name);
  }
  if (structuralStatus === "structure_incomplete_root_landing" && summary.playable) {
    summary.recommendedAction = "Create or reuse the suggested spec child page, then move this uploaded block there manually or reupload the matching local file to that page before final Media Assets write.";
    summary.suggestedSpecTitle = suggestedSpecTitle(workTitle, summary.name);
  }
  return summary;
}

export function summarizeEpisodeMedia(episodePage, children, parentPath, specTitle = "", workTitle = "") {
  const path = [...parentPath, `child_page:${blockTitle(episodePage)}`];
  return children
    .filter(isMediaBlock)
    .map((child) => summarizeMedia(child, [...path, child.type], "valid_episode_media", workTitle, specTitle));
}

async function scanSpecLikeChild(notion, block, parentPath) {
  const title = blockTitle(block);
  const path = [...parentPath, `child_page:${title}`];
  const children = await listChildren(notion, block.id).catch(() => []);
  const episodePages = [];
  const episodeMedia = [];
  for (const child of children.filter((item) => item.type === "child_page")) {
    const episodeRange = episodeRangeFromName(blockTitle(child));
    if (episodeRange === undefined) continue;
    episodePages.push({
      pageId: child.id,
      title: blockTitle(child),
      episodeNumber: episodeRange.start,
      episodeEndNumber: episodeRange.end
    });
    const episodeChildren = await listChildren(notion, child.id).catch(() => []);
    episodeMedia.push(...summarizeEpisodeMedia(child, episodeChildren, path, title, parentPath[0] ?? ""));
  }
  const media = children
    .filter(isMediaBlock)
    .map((child) => summarizeMedia(child, [...path, child.type], "valid_spec_media", parentPath[0] ?? "", title));
  return {
    pageId: block.id,
    title,
    path,
    episodePages,
    media,
    episodeMedia
  };
}

async function scanWorkPage(notion, page) {
  const title = pageTitle(page);
  const children = await listChildren(notion, page.id);
  const rootLandingMedia = [];
  const specPages = [];
  const nestedSpecPages = [];

  for (const block of children) {
    if (isMediaBlock(block)) {
      rootLandingMedia.push(summarizeMedia(block, [title, block.type], "structure_incomplete_root_landing", title));
      continue;
    }

    if (block.type === "child_page") {
      specPages.push(await scanSpecLikeChild(notion, block, [title]));
      continue;
    }

    if (block.type === "callout" || block.type === "toggle") {
      const containerTitle = blockTitle(block);
      const containerChildren = await listChildren(notion, block.id).catch(() => []);
      for (const child of containerChildren.filter((item) => item.type === "child_page")) {
        nestedSpecPages.push(await scanSpecLikeChild(notion, child, [title, `${block.type}:${containerTitle}`]));
      }
    }
  }

  const allSpecPages = [...specPages, ...nestedSpecPages];
  const rootLandingMediaWithTargets = assignSuggestedTargets(rootLandingMedia, allSpecPages);
  const specMedia = allSpecPages.flatMap((item) => [...item.media, ...item.episodeMedia]);
  return {
    pageId: page.id,
    title,
    lastEditedTime: page.last_edited_time,
    rootLandingMedia: rootLandingMediaWithTargets,
    specPages: allSpecPages.map((item) => ({
      pageId: item.pageId,
      title: item.title,
      path: item.path,
      episodePages: item.episodePages,
      mediaCount: item.media.length + item.episodeMedia.length,
      episodeMediaCount: item.episodeMedia.length
    })),
    specMedia,
    status: rootLandingMedia.some((item) => item.playable)
      ? "needs_manual_upload_organization"
      : specMedia.some((item) => item.playable && !item.placementIssue)
        ? "has_structured_playable_media"
        : specMedia.some((item) => item.placementIssue)
          ? "needs_spec_placement_correction"
        : "no_playable_media_seen"
  };
}

async function scanWorkPageRootOnly(notion, page) {
  const title = pageTitle(page);
  const children = await listChildren(notion, page.id);
  const rootLandingMedia = children
    .filter(isMediaBlock)
    .map((block) => summarizeMedia(block, [title, block.type], "structure_incomplete_root_landing", title));
  return {
    pageId: page.id,
    title,
    lastEditedTime: page.last_edited_time,
    rootLandingMedia,
    specPages: [],
    specMedia: [],
    status: rootLandingMedia.some((item) => item.playable)
      ? "needs_manual_upload_organization"
      : "no_playable_media_seen"
  };
}

async function ensureSpecPage(notion, workPageId, specTitle, apply) {
  const children = await listChildren(notion, workPageId);
  const existing = children.find((block) => block.type === "child_page" && blockTitle(block) === specTitle);
  if (existing) {
    return { action: "exists", pageId: existing.id, title: specTitle };
  }

  if (!apply) {
    return { action: "would_create", pageId: null, title: specTitle };
  }

  const page = await notion.pages.create({
    parent: { page_id: workPageId },
    properties: {
      title: { title: richText(specTitle) }
    }
  });
  return { action: "created", pageId: page.id, title: specTitle };
}

function writeReport(filePath, payload) {
  fs.mkdirSync(filePath.replace(/[\\/][^\\/]*$/u, "") || ".", { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function mediaItemsFromScans(scans) {
  return scans.flatMap((scan) => [
    ...(scan.rootLandingMedia ?? []).map((media) => ({ ...media, sourcePageId: scan.pageId, workTitle: scan.title })),
    ...(scan.specMedia ?? []).map((media) => ({ ...media, sourcePageId: scan.pageId, workTitle: scan.title }))
  ]);
}

function mediaVersion(media) {
  return media.blockLastEditedTime || media.blockCreatedTime || "";
}

export function markNewMedia(scans, previousState = {}) {
  const previousBlocks = previousState.blocks ?? {};
  const items = mediaItemsFromScans(scans);
  // Keep the global index when a targeted scan only contains one work page.
  // Otherwise a manual one-page check would erase the watcher baseline.
  const nextBlocks = { ...previousBlocks };
  const newBlockIds = [];

  for (const media of items) {
    const previous = previousBlocks[media.blockId];
    const currentVersion = mediaVersion(media);
    const isNew = !previous || currentVersion > (previous.version || "");
    if (isNew) newBlockIds.push(media.blockId);
    nextBlocks[media.blockId] = {
      version: currentVersion,
      blockCreatedTime: media.blockCreatedTime ?? null,
      blockLastEditedTime: media.blockLastEditedTime ?? null,
      name: media.name,
      sourcePageId: media.sourcePageId,
      workTitle: media.workTitle,
      path: media.path
    };
  }

  const annotatedScans = scans.map((scan) => ({
    ...scan,
    rootLandingMedia: (scan.rootLandingMedia ?? []).map((media) => ({
      ...media,
      isNewSinceLastScan: newBlockIds.includes(media.blockId)
    })),
    specMedia: (scan.specMedia ?? []).map((media) => ({
      ...media,
      isNewSinceLastScan: newBlockIds.includes(media.blockId)
    }))
  }));

  return {
    scans: annotatedScans,
    state: { version: 1, savedAt: new Date().toISOString(), blocks: nextBlocks },
    newBlockIds
  };
}

export function scanConcurrency(rootOnly) {
  // Notion's rate limit is shared across the workspace. A single in-flight
  // page-tree read keeps the long-running watcher reliable on large libraries.
  return 1;
}

export function effectiveScanDelayMs(rootOnly, delayMs) {
  return rootOnly ? delayMs : 0;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);

  const token = dotenv("NOTION_TOKEN") || dotenv("NOTION_READ_ONLY_TOKEN");
  if (!token) throw new Error("Set NOTION_TOKEN or NOTION_READ_ONLY_TOKEN.");
  const notion = createNotionClient(token, options.noProxy);
  const dataSource = await loadLibraryDataSource(notion);

  let pages;
  if (options.pageIds.length > 0) {
    pages = await Promise.all(options.pageIds.map((pageId) => notion.pages.retrieve({ page_id: pageId })));
  } else if (options.all) {
    pages = await allPages(notion, dataSource, options.query);
  } else if (options.query) {
    pages = await queryPages(notion, dataSource, options.query, options.recent);
  } else {
    pages = await recentPages(notion, dataSource, options.recent);
  }

  const scans = [];
  if (options.rootOnly) {
    // Notion rate-limits page-tree reads; keep the bounded scan gentle enough for repeated use.
    const concurrency = scanConcurrency(true);
    const delayMs = effectiveScanDelayMs(true, options.delayMs);
    for (let index = 0; index < pages.length; index += concurrency) {
      if (index > 0 && delayMs > 0) await sleep(delayMs);
      const batch = pages.slice(index, index + concurrency);
      scans.push(...await Promise.all(batch.map((page) => scanWorkPageRootOnly(notion, page))));
    }
  } else {
    const concurrency = scanConcurrency(false);
    for (let index = 0; index < pages.length; index += concurrency) {
      const batch = pages.slice(index, index + concurrency);
      scans.push(...await Promise.all(batch.map((page) => scanWorkPage(notion, page))));
    }
  }

  let preparedTarget = null;
  if (options.specTitle) {
    preparedTarget = await ensureSpecPage(notion, options.pageIds[0], options.specTitle, options.apply);
    const refreshed = await notion.pages.retrieve({ page_id: options.pageIds[0] });
    scans.splice(0, scans.length, await scanWorkPage(notion, refreshed));
  }

  const previousState = readJson(options.statePath, { version: 1, blocks: {} });
  const marked = markNewMedia(scans, previousState);
  const finalScans = marked.scans;
  const summary = {
    pagesScanned: finalScans.length,
    pagesNeedingOrganization: finalScans.filter((item) => item.status === "needs_manual_upload_organization").length,
    pagesNeedingSpecPlacementCorrection: finalScans.filter((item) => item.status === "needs_spec_placement_correction").length,
    rootPlayableBlocks: finalScans.flatMap((item) => item.rootLandingMedia).filter((item) => item.playable).length,
    structuredPlayableBlocks: finalScans.flatMap((item) => item.specMedia).filter((item) => item.playable && !item.placementIssue).length,
    misplacedPlayableBlocks: finalScans.flatMap((item) => item.specMedia).filter((item) => item.placementIssue).length,
    newMediaBlocksSinceLastScan: marked.newBlockIds.length
  };
  writeReport(options.statePath, marked.state);
  const payload = {
    scannedAt: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    preparedTarget,
    summary,
    pages: finalScans
  };
  writeReport(options.reportPath, payload);

  console.log(JSON.stringify({
    reportPath: options.reportPath,
    mode: payload.mode,
    preparedTarget,
    summary,
      pages: finalScans.map((item) => ({
      title: item.title,
      pageId: item.pageId,
      lastEditedTime: item.lastEditedTime,
      status: item.status,
      rootLandingMedia: item.rootLandingMedia.map((media) => ({
        blockId: media.blockId,
        type: media.blockType,
        playable: media.playable,
        sourceLike: media.sourceLike,
        name: media.name,
        suggestedSpecTitle: media.suggestedSpecTitle,
        suggestedTarget: media.suggestedTarget,
        path: media.path.join(" > ")
      })),
      specPages: item.specPages
    }))
  }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
