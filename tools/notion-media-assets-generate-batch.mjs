import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

function parseArgs() {
  const options = {
    outputPath: ".local-data/notion-media-assets-batch.json",
    maxItems: 50,
    scanLimit: 500,
    maxAssets: 3,
    resolveIp: "",
    excludePreviewPaths: [],
    includeExisting: false,
    includePrefixed: false,
    includeSeries: false,
    includeDuplicateTitles: false,
    excludeNoWritePreviewPages: true,
    excludeHighIssuePreviewPages: true
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--output") options.outputPath = value();
    else if (name === "--max-items") options.maxItems = Number(value());
    else if (name === "--scan-limit") options.scanLimit = Number(value());
    else if (name === "--max-assets") options.maxAssets = Number(value());
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (name === "--exclude-preview") options.excludePreviewPaths.push(value());
    else if (arg === "--include-existing") options.includeExisting = true;
    else if (arg === "--include-prefixed") options.includePrefixed = true;
    else if (arg === "--include-series") options.includeSeries = true;
    else if (arg === "--include-duplicate-titles") options.includeDuplicateTitles = true;
    else if (arg === "--include-no-write-preview-pages") options.excludeNoWritePreviewPages = false;
    else if (arg === "--include-high-issue-preview-pages") options.excludeHighIssuePreviewPages = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.maxItems) || options.maxItems < 1) {
    throw new Error("--max-items must be a positive number.");
  }
  if (!Number.isFinite(options.scanLimit) || options.scanLimit < 1) {
    throw new Error("--scan-limit must be a positive number.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-media-assets-generate-batch.mjs --output .local-data/media-assets-batch.json

This is read-only. It scans the Notion library, excludes works already present
in Media Assets by default, and writes a guarded batch manifest for
notion-media-assets-write.mjs.

Options:
  --max-items 50
  --scan-limit 500
  --include-existing
  --include-prefixed
  --include-series
  --include-duplicate-titles
  --exclude-preview .local-data/previous-preview.json
  --include-no-write-preview-pages
  --include-high-issue-preview-pages
  --resolve-ip 208.103.161.1
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

function createNotionClient(token) {
  const proxyUrl = dotenv("NOTION_PROXY_URL") || dotenv("HTTPS_PROXY") || dotenv("HTTP_PROXY");
  const options = { auth: token, timeoutMs: Number(dotenv("NOTION_REQUEST_TIMEOUT_MS") || 30000) };
  if (proxyUrl) {
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

function relationIds(property) {
  return property?.type === "relation" ? property.relation.map((item) => item.id) : [];
}

function selectName(property) {
  return property?.type === "select" ? property.select?.name ?? "" : "";
}

function stripOperatorPrefix(title) {
  return title.replace(/^【(?:敬请期待|仅供下载)】\s*/u, "").trim();
}

function titleIdentity(title) {
  return stripOperatorPrefix(title)
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("zh-Hans-CN");
}

function hasOperatorPrefix(title) {
  return /^【(?:敬请期待|仅供下载)】/u.test(title);
}

function looksLikeSeries(title) {
  return /(?:第\s*\d+\s*季|第一季|第二季|第三季|第四季|第五季|Season\s*\d+|\bS\d{1,2}\b|\bs\d{1,2}\b|\bbig\s*bang\s*\d+\b|最终季|Part\.\d+)/iu.test(title);
}

function libraryMediaKind(page) {
  return selectName(page.properties?.["影别"]);
}

function looksLikeNonMovieKind(kind) {
  return Boolean(kind) && !/^(?:movie|film|电影|短片|short)$/iu.test(kind);
}

function expectedTitleFragment(title) {
  const cleaned = stripOperatorPrefix(title)
    .replace(/\s*\([^)]*\)\s*$/u, "")
    .trim();
  const fragment = cleaned.split(/[\s(（]/u)[0].slice(0, 18);
  return fragment.length >= 2 ? fragment : "";
}

async function queryAllDataSourcePages(notion, dataSourceId, limit) {
  const pages = [];
  let cursor;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: Math.min(100, Math.max(1, limit - pages.length)),
      start_cursor: cursor
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor && pages.length < limit);
  return pages;
}

function loadPreviewExclusions(options) {
  const exclusions = new Map();
  for (const previewPath of options.excludePreviewPaths) {
    const preview = JSON.parse(fs.readFileSync(previewPath, "utf8"));
    for (const page of preview.pages ?? []) {
      const reasons = [];
      if (options.excludeNoWritePreviewPages && page.summary?.wouldCreate === 0) {
        reasons.push("previous_preview_no_writes");
      }
      if (options.excludeHighIssuePreviewPages && (page.summary?.issues ?? 0) > 1) {
        reasons.push("previous_preview_high_issues");
      }
      if (page.summary?.skippedTitleMismatch) {
        reasons.push("previous_preview_title_mismatch");
      }
      if (reasons.length > 0) {
        exclusions.set(page.pageId, reasons);
      }
    }
    for (const page of preview.filteredOut ?? []) {
      const reasons = page.reasons?.length
        ? page.reasons.map((reason) => `previous_filter_${reason}`)
        : ["previous_filter_excluded"];
      if (page.pageId && reasons.length > 0) {
        exclusions.set(page.pageId, reasons);
      }
    }
  }
  return exclusions;
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_READ_ONLY_TOKEN") || dotenv("NOTION_TOKEN") || dotenv("NOTION_WRITE_TOKEN");
  if (!token) throw new Error("Set NOTION_READ_ONLY_TOKEN, NOTION_TOKEN, or NOTION_WRITE_TOKEN.");

  const libraryDataSourceId = dotenv("NOTION_LIBRARY_DATA_SOURCE_ID");
  const mediaAssetsDataSourceId = dotenv("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID");
  if (!libraryDataSourceId) throw new Error("Set NOTION_LIBRARY_DATA_SOURCE_ID.");
  if (!mediaAssetsDataSourceId) throw new Error("Set NOTION_MEDIA_ASSETS_DATA_SOURCE_ID.");

  const notion = createNotionClient(token);
  const mediaAssetPages = await queryAllDataSourcePages(notion, mediaAssetsDataSourceId, 10000);
  const existingWorkIds = new Set(mediaAssetPages.flatMap((page) => relationIds(page.properties?.Work)));
  const libraryPages = await queryAllDataSourcePages(notion, libraryDataSourceId, options.scanLimit);
  const existingWorkTitleIds = new Map(
    libraryPages
      .filter((page) => existingWorkIds.has(page.id))
      .map((page) => [titleIdentity(pageTitle(page)), page.id])
      .filter(([title]) => title)
  );
  const previewExclusions = loadPreviewExclusions(options);

  const skipped = [];
  const items = [];
  for (const page of libraryPages) {
    const title = pageTitle(page);
    const expected = expectedTitleFragment(title);
    const mediaKind = libraryMediaKind(page);
    const reasons = [];
    if (!title) reasons.push("missing_title");
    if (!expected) reasons.push("weak_expected_title");
    if (!options.includeExisting && existingWorkIds.has(page.id)) reasons.push("already_has_media_assets");
    if (
      !options.includeExisting &&
      !options.includeDuplicateTitles &&
      !existingWorkIds.has(page.id) &&
      existingWorkTitleIds.has(titleIdentity(title))
    ) {
      reasons.push("already_has_media_assets_same_title");
    }
    if (!options.includePrefixed && hasOperatorPrefix(title)) reasons.push("operator_prefix");
    if (!options.includeSeries && looksLikeSeries(title)) reasons.push("series_season");
    if (!options.includeSeries && looksLikeNonMovieKind(mediaKind)) {
      reasons.push(`non_movie_kind:${mediaKind}`);
    }
    if (previewExclusions.has(page.id)) reasons.push(...previewExclusions.get(page.id));

    if (reasons.length > 0) {
      skipped.push({ pageId: page.id, title, reasons });
      continue;
    }

    items.push({
      label: stripOperatorPrefix(title).replace(/\s*\([^)]*\)\s*$/u, "").slice(0, 60),
      pageId: page.id,
      expectedTitleContains: [expected],
      maxAssets: options.maxAssets,
      allowedAssetTypes: [
        "playable_video",
        "original_disc",
        "source_archive",
        "subtitle_package"
      ]
    });
    if (items.length >= options.maxItems) break;
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    note: "Generated read-only from Notion library pages not yet represented in Media Assets. Dry-run before apply.",
    source: {
      libraryDataSourceId,
      mediaAssetsDataSourceId,
      scanLimit: options.scanLimit,
      existingMediaAssetPages: mediaAssetPages.length,
      existingWorks: existingWorkIds.size,
      existingWorkTitles: existingWorkTitleIds.size,
      excludePreviewPaths: options.excludePreviewPaths
    },
    defaults: {
      maxAssets: options.maxAssets,
      allowedAssetTypes: [
        "playable_video",
        "original_disc",
        "source_archive",
        "subtitle_package"
      ]
    },
    items,
    skipped
  };

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  fs.writeFileSync(options.outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    outputPath: options.outputPath,
    summary: {
      scanned: libraryPages.length,
      existingMediaAssetPages: mediaAssetPages.length,
      existingWorks: existingWorkIds.size,
      existingWorkTitles: existingWorkTitleIds.size,
      items: items.length,
      skipped: skipped.length,
      previewExcluded: [...previewExclusions.keys()].length
    },
    firstItems: items.slice(0, 10)
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
