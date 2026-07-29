import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

function parseArgs() {
  const options = {
    auditReportPath: "",
    reportPath: ".local-data/notion-media-assets-series-write.json",
    metadataManifestPath: "",
    skipPages: 0,
    maxPages: 2,
    maxAssets: 50,
    includeDirectSpec: false,
    allowPartialEpisodes: false,
    updateExistingMissing: false,
    correctExisting: false,
    ensureSchema: true,
    apply: false,
    resolveIp: ""
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--audit-report") options.auditReportPath = value();
    else if (name === "--report") options.reportPath = value();
    else if (name === "--metadata-manifest") options.metadataManifestPath = value();
    else if (name === "--skip-pages") options.skipPages = Number(value());
    else if (name === "--max-pages") options.maxPages = Number(value());
    else if (name === "--max-assets") options.maxAssets = Number(value());
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (arg === "--include-direct-spec") options.includeDirectSpec = true;
    else if (arg === "--allow-partial-episodes") options.allowPartialEpisodes = true;
    else if (arg === "--update-existing-missing") options.updateExistingMissing = true;
    else if (arg === "--correct-existing") options.correctExisting = true;
    else if (arg === "--no-ensure-schema") options.ensureSchema = false;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && !options.auditReportPath) {
      options.auditReportPath = arg;
    } else if (!arg.startsWith("-") && options.reportPath === ".local-data/notion-media-assets-series-write.json") {
      options.reportPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.auditReportPath) throw new Error("Set --audit-report.");
  if (!Number.isFinite(options.skipPages) || options.skipPages < 0) throw new Error("--skip-pages must be zero or a positive number.");
  if (!Number.isFinite(options.maxPages) || options.maxPages < 1) throw new Error("--max-pages must be a positive number.");
  if (!Number.isFinite(options.maxAssets) || options.maxAssets < 1) throw new Error("--max-assets must be a positive number.");
  if (options.correctExisting && !options.metadataManifestPath) {
    throw new Error("--correct-existing requires --metadata-manifest.");
  }
  if (options.correctExisting && options.updateExistingMissing) {
    throw new Error("--correct-existing cannot be combined with --update-existing-missing.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-media-assets-write-series.mjs --audit-report .local-data/series-audit.json --report .local-data/series-write-preview.json
  node tools/notion-media-assets-write-series.mjs --audit-report .local-data/series-audit.json --metadata-manifest .local-data/series-metadata.json --apply --report .local-data/series-write-apply.json
  node tools/notion-media-assets-write-series.mjs --audit-report .local-data/series-audit.json --apply --report .local-data/series-write-apply.json
  node tools/notion-media-assets-write-series.mjs --audit-report .local-data/series-audit.json --skip-pages 12 --max-pages 6 --apply
  node tools/notion-media-assets-write-series.mjs --audit-report .local-data/series-audit.json --include-direct-spec --report .local-data/direct-spec-preview.json
  node tools/notion-media-assets-write-series.mjs --audit-report .local-data/series-audit.json --allow-partial-episodes --report .local-data/partial-series-preview.json
  node tools/notion-media-assets-write-series.mjs --audit-report .local-data/series-audit.json --metadata-manifest .local-data/series-metadata.json --update-existing-missing --apply
  node tools/notion-media-assets-write-series.mjs --audit-report .local-data/series-audit.json --metadata-manifest .local-data/series-corrections.json --correct-existing --apply

This writer is episode-range-aware. It creates Media Assets rows for real media blocks
found under episode-range child pages. Empty placeholders are reported but not
written. Direct spec-page media is reported by default; with
--include-direct-spec, direct media is written only when the media title or file
name contains a parseable episode number. With --allow-partial-episodes, pages
with some unparseable episode titles can still write the parseable episode rows;
the unparseable rows remain issues. With --update-existing-missing, existing
matched Media Assets rows are patched only for empty properties; existing human
values are not overwritten. With --correct-existing, only manifest-declared
technical fields from the safe replacement allowlist may overwrite a matched
row. Name, Work, Playback Verified, and Hide from Website are never eligible.
The writer ensures the numeric Media Assets property \`Episode End\` on apply so
collection rows preserve an inclusive range. Use --no-ensure-schema only for a
deliberately schema-read-only run.
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

function cleanText(value = "") {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function publicWorkTitle(value = "") {
  return cleanText(value).replace(/^【[^】]+】\s*/u, "").trim();
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function blockTitle(block) {
  const payload = block[block.type] ?? {};
  if (block.type === "child_page") return cleanText(payload.title ?? "");
  if (block.type === "callout" || block.type === "toggle") return cleanText(plainText(payload.rich_text));
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

function isExternalMediaUrl(block) {
  const payload = block[block.type] ?? {};
  return Boolean(payload.external?.url);
}

function mediaBlockName(block) {
  const payload = block[block.type] ?? {};
  return blockTitle(block) || fileNameFromUrl(payload.file?.url ?? payload.external?.url ?? "");
}

function isPlayableMedia(block) {
  const name = mediaBlockName(block);
  const url = mediaUrl(block);
  return (
    (block.type === "video" || block.type === "file") &&
    /\.(mp4|m4v|mov|webm|mkv)(?:[?#].*)?$/i.test(`${name} ${url}`) &&
    !/\.(7z|zip|rar|srt|ass|ssa|pdf|txt|nfo)(?:\.\d+)?(?:[?#].*)?$/i.test(`${name} ${url}`)
  );
}

function isSourceSpecTitle(title = "") {
  return /(?:原盘|原盤|片源|资源|資源|source|original disc)/iu.test(cleanText(title));
}

export function playablePlacementIssue(specTitle = "", fileName = "") {
  if (!isSourceSpecTitle(specTitle)) return null;
  if (!/\.(mp4|m4v|mov|webm|mkv)(?:[?#].*)?$/i.test(String(fileName ?? ""))) return null;
  return {
    kind: "playable_media_in_source_spec",
    recommendedAction: "Do not write a Media Assets row. Reupload this playable file to the matching playable spec page instead of the source/original-disc spec."
  };
}

function chineseEpisodeNumber(value) {
  const digits = { 零: 0, "〇": 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  let total = 0;
  let current = 0;
  for (const char of value) {
    if (char === "百") {
      total += (current || 1) * 100;
      current = 0;
      continue;
    }
    if (char === "十") {
      total += (current || 1) * 10;
      current = 0;
      continue;
    }
    const digit = digits[char];
    if (digit === undefined) return undefined;
    current = digit;
  }
  const number = total + current;
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function episodeNumberFromLabel(value) {
  const cleaned = cleanText(value);
  const patterns = [
    /^(\d{1,3})$/,
    /\bS\d{1,2}E(\d{1,3})\b/i,
    /\b\d{1,2}x(\d{1,3})\b/i,
    /\b(?:Episode|Ep)[\s._-]*(\d{1,3})\b/i,
    /\bE(?:P)?[\s._-]*(\d{1,3})\b/i,
    /第\s*(\d{1,3})\s*[集话話]/u
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const number = match?.[1] ? Number(match[1]) : NaN;
    if (Number.isInteger(number) && number > 0) return number;
  }
  return chineseEpisodeNumber(cleaned.match(/第\s*([一二两三四五六七八九十百零〇]+)\s*[集话話]/u)?.[1] ?? "");
}

function episodeRangeFromLabel(value) {
  const cleaned = cleanText(value);
  const patterns = [
    /\bS\d{1,2}E(\d{1,3})\s*[-~–—至到]\s*(?:S\d{1,2})?E?(\d{1,3})\b/i,
    /\b(?:Episode|Ep)[\s._-]*(\d{1,3})\s*[-~–—至到]\s*(\d{1,3})\b/i,
    /第\s*(\d{1,3})\s*[-~–—至到]\s*(\d{1,3})\s*[集话話]/u
  ];
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    const start = Number(match?.[1]);
    const end = Number(match?.[2]);
    if (Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start) {
      return { start, end };
    }
  }
  const episode = episodeNumberFromLabel(cleaned);
  return episode ? { start: episode, end: episode } : undefined;
}

function canonicalEpisodeLabel(value) {
  const range = episodeRangeFromLabel(value);
  if (!range) return cleanText(value);
  const start = String(range.start).padStart(2, "0");
  const end = String(range.end).padStart(2, "0");
  return range.end > range.start ? `Episode ${start}-${end}` : `Episode ${start}`;
}

function pushUnique(target, value) {
  if (value && !target.includes(value)) target.push(value);
}

function firstMatch(value, patterns) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    const text = match?.[1] ?? match?.[0];
    if (text) return cleanText(text);
  }
  return undefined;
}

function normalizeVideoCodec(value) {
  if (/\b(?:h265|h\.265|hevc|x265)\b/i.test(value)) return "hevc";
  if (/\b(?:h264|h\.264|avc|x264)\b/i.test(value)) return "h264";
  if (/\bav1\b/i.test(value)) return "av1";
  return undefined;
}

function extensionFromFileName(value) {
  return value.match(/\.([a-z0-9]{2,5})(?:[?#].*)?$/i)?.[1]?.toLowerCase();
}

function parseAssetMetadata(label, fileName, episodeNumber, episodeEndNumber = episodeNumber) {
  const labelText = cleanText(label);
  const fileText = cleanText(fileName ?? "");
  const combined = `${labelText} ${fileText}`.trim();
  const technicalText = fileText || labelText;
  const sizeText = `${fileText} ${labelText}`.trim();
  const audioLanguages = [];
  const subtitleLanguages = [];
  const subtitleRegions = [];
  const sourceLineage = ["encode"];

  if (/普通话|普通話|国语|國語|mandarin/i.test(combined)) pushUnique(audioLanguages, "zh-Mandarin");
  if (/粤语|粵語|cantonese/i.test(combined)) pushUnique(audioLanguages, "zh-Cantonese");
  if (/韩语|韓語|korean audio|\.korean\.|korean\.audio|\.kor\b|\bkor\b/i.test(combined)) pushUnique(audioLanguages, "ko");
  if (/日语发音|日語發音|japanese audio|\.japanese\.|japanese\.audio/i.test(combined)) pushUnique(audioLanguages, "ja");
  if (/英语发音|英語發音|english audio|\.english\.|english\.audio/i.test(combined)) pushUnique(audioLanguages, "en");

  if (/繁简英|繁簡英|chtchseng|chschteng/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hant");
    pushUnique(subtitleLanguages, "zh-Hans");
    pushUnique(subtitleLanguages, "en");
  } else if (/简英|簡英|chseng/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hans");
    pushUnique(subtitleLanguages, "en");
  } else if (/繁英|chteng/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hant");
    pushUnique(subtitleLanguages, "en");
  } else {
    if (/简|簡|\bchs\b/i.test(combined)) pushUnique(subtitleLanguages, "zh-Hans");
    if (/繁|cht/i.test(combined)) pushUnique(subtitleLanguages, "zh-Hant");
  }
  if (/繁港|chth/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hant");
    pushUnique(subtitleRegions, "HK");
  }
  if (/繁台|chtt/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hant");
    pushUnique(subtitleRegions, "TW");
  }
  if (/英语字幕|英語字幕|\beng\b/i.test(combined)) pushUnique(subtitleLanguages, "en");

  if (/WEB[- ]?DL/i.test(combined)) pushUnique(sourceLineage, "WEB-DL");
  if (/Blu[- ]?ray|Bluray/i.test(combined)) pushUnique(sourceLineage, "Blu-ray");
  if (/remux/i.test(combined)) pushUnique(sourceLineage, "remux");

  const size = Number(sizeText.match(/(\d+(?:\.\d+)?)\s*GB/i)?.[1]);
  const metadata = {
    availability: "playable",
    episodeNumber,
    episodeEndNumber: episodeEndNumber > episodeNumber ? episodeEndNumber : undefined,
    resolution: firstMatch(technicalText, [/\b(?:2160p|1080p|720p|480p)\b/i, /\b4K\b/i])?.toLowerCase(),
    videoCodec: normalizeVideoCodec(technicalText),
    container: extensionFromFileName(fileName),
    approximateSizeGb: Number.isFinite(size) ? size : undefined,
    audioLanguages,
    subtitleLanguages,
    subtitleRegions,
    sourceLineage
  };

  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== "";
  }));
}

async function listChildren(notion, blockId) {
  const blocks = [];
  let cursor;
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor
    });
    blocks.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

async function loadMediaAssetsDataSource(notion) {
  const dataSourceId = dotenv("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID");
  if (dataSourceId) return notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const databaseId = dotenv("NOTION_MEDIA_ASSETS_DATABASE_ID");
  if (databaseId) {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    return notion.dataSources.retrieve({ data_source_id: database.data_sources?.[0]?.id || databaseId });
  }
  throw new Error("Set NOTION_MEDIA_ASSETS_DATA_SOURCE_ID or NOTION_MEDIA_ASSETS_DATABASE_ID.");
}

async function ensureSeriesCollectionSchema(notion, dataSource, apply) {
  if (dataSource.properties?.["Episode End"]) return { dataSource, added: [] };
  if (!apply) return { dataSource, added: ["Episode End"] };
  const updated = await notion.dataSources.update({
    data_source_id: dataSource.id,
    properties: {
      "Episode End": { number: { format: "number" } }
    }
  });
  return { dataSource: updated, added: ["Episode End"] };
}

function titlePropertyName(dataSource) {
  return Object.entries(dataSource.properties ?? {}).find(([, property]) => property.type === "title")?.[0] ?? "Title";
}

function richText(value) {
  const content = cleanText(String(value ?? ""));
  return content ? [{ text: { content: content.slice(0, 2000) } }] : [];
}

function setIfProperty(properties, dataSource, name, value) {
  if (!dataSource.properties?.[name] || value === undefined || value === null) return;
  properties[name] = value;
}

function asSelect(name) {
  return name ? { select: { name: String(name) } } : undefined;
}

function asMultiSelect(values) {
  const items = (values ?? []).filter(Boolean).map((name) => ({ name: String(name) }));
  return items.length > 0 ? { multi_select: items } : undefined;
}

function buildAssetProperties(dataSource, candidate) {
  const metadata = candidate.metadata ?? {};
  const properties = {};
  setIfProperty(properties, dataSource, "Name", { title: richText(candidate.name) });
  setIfProperty(properties, dataSource, "Work", { relation: [{ id: candidate.workPageId }] });
  setIfProperty(properties, dataSource, "Asset Type", asSelect("playable_video"));
  setIfProperty(properties, dataSource, "Media Availability", asSelect("playable"));
  setIfProperty(properties, dataSource, "Display Label", { rich_text: richText(candidate.displayLabel) });
  setIfProperty(properties, dataSource, "Episode Number", { number: metadata.episodeNumber });
  setIfProperty(properties, dataSource, "Episode End", metadata.episodeEndNumber ? { number: metadata.episodeEndNumber } : undefined);
  setIfProperty(properties, dataSource, "Resolution", asSelect(metadata.resolution));
  setIfProperty(properties, dataSource, "Video Codec", asSelect(metadata.videoCodec));
  setIfProperty(properties, dataSource, "Container", asSelect(metadata.container));
  setIfProperty(properties, dataSource, "Approx Size GB", metadata.approximateSizeGb ? { number: metadata.approximateSizeGb } : undefined);
  setIfProperty(properties, dataSource, "Quality Tag", { rich_text: richText(metadata.qualityTag) });
  setIfProperty(properties, dataSource, "Audio Languages", asMultiSelect(metadata.audioLanguages));
  setIfProperty(properties, dataSource, "Subtitle Languages", asMultiSelect(metadata.subtitleLanguages));
  setIfProperty(properties, dataSource, "Subtitle Regions", asMultiSelect(metadata.subtitleRegions));
  setIfProperty(properties, dataSource, "Source Lineage", asMultiSelect(metadata.sourceLineage));
  // A discovered media block on the exact episode-range page is the workflow's upload proof.
  setIfProperty(properties, dataSource, "Playback Verified", { checkbox: true });
  setIfProperty(properties, dataSource, "Hide from Website", { checkbox: true });
  setIfProperty(properties, dataSource, "Original File Name", { rich_text: richText(candidate.originalFileName) });
  setIfProperty(properties, dataSource, "Asset URL", candidate.assetUrl ? { url: candidate.assetUrl } : undefined);
  setIfProperty(properties, dataSource, "Source Page ID", { rich_text: richText(candidate.sourcePageId) });
  setIfProperty(properties, dataSource, "Media Block ID", { rich_text: richText(candidate.mediaBlockId) });
  setIfProperty(properties, dataSource, "Developer Memo", {
    rich_text: richText(candidate.developerMemo || "Created by notion-media-assets-write-series.mjs from an episode-range child page with a real media block. Upload-backed playback verification recorded.")
  });
  return properties;
}

function propertyPlainText(property) {
  if (!property) return "";
  if (property.type === "title") return plainText(property.title);
  if (property.type === "rich_text") return plainText(property.rich_text);
  return "";
}

function relationIds(property) {
  return property?.type === "relation" ? property.relation.map((item) => item.id) : [];
}

function candidateMatchesPage(page, dataSource, candidate) {
  const nameProperty = titlePropertyName(dataSource);
  const properties = page.properties ?? {};
  const workMatches = relationIds(properties.Work).includes(candidate.workPageId);
  const titleMatches = propertyPlainText(properties[nameProperty]) === candidate.name;
  const sourcePageMatches = propertyPlainText(properties["Source Page ID"]) === candidate.sourcePageId;
  const mediaBlockMatches = propertyPlainText(properties["Media Block ID"]) === candidate.mediaBlockId;
  const fileNameMatches = !candidate.originalFileName || propertyPlainText(properties["Original File Name"]) === candidate.originalFileName;
  return workMatches && (mediaBlockMatches || (sourcePageMatches && fileNameMatches && titleMatches) || (titleMatches && fileNameMatches));
}

function makeExistingAssetLookup(notion, dataSource) {
  const nameProperty = titlePropertyName(dataSource);
  const byMediaBlockId = new Map();
  const bySourcePageId = new Map();
  const byTitle = new Map();

  const cachePages = (cache, key, pages) => {
    const existing = cache.get(key) ?? [];
    const seen = new Set(existing.map((page) => page.id));
    for (const page of pages) {
      if (!seen.has(page.id)) {
        existing.push(page);
        seen.add(page.id);
      }
    }
    cache.set(key, existing);
    return existing;
  };

  const queryRichText = async (propertyName, value) => {
    const response = await notion.dataSources.query({
      data_source_id: dataSource.id,
      page_size: 100,
      filter: { property: propertyName, rich_text: { equals: value } }
    });
    return response.results;
  };

  const queryTitle = async (value) => {
    const response = await notion.dataSources.query({
      data_source_id: dataSource.id,
      page_size: 20,
      filter: { property: nameProperty, title: { equals: value } }
    });
    return response.results;
  };

  return {
    async find(candidate) {
      const candidates = [];

      if (dataSource.properties?.["Media Block ID"] && candidate.mediaBlockId) {
        const pages = byMediaBlockId.has(candidate.mediaBlockId)
          ? byMediaBlockId.get(candidate.mediaBlockId)
          : cachePages(byMediaBlockId, candidate.mediaBlockId, await queryRichText("Media Block ID", candidate.mediaBlockId));
        candidates.push(...pages);
      }

      if (dataSource.properties?.["Source Page ID"] && candidate.sourcePageId) {
        const pages = bySourcePageId.has(candidate.sourcePageId)
          ? bySourcePageId.get(candidate.sourcePageId)
          : cachePages(bySourcePageId, candidate.sourcePageId, await queryRichText("Source Page ID", candidate.sourcePageId));
        candidates.push(...pages);
      }

      if (candidates.length === 0) {
        const pages = byTitle.has(candidate.name)
          ? byTitle.get(candidate.name)
          : cachePages(byTitle, candidate.name, await queryTitle(candidate.name));
        candidates.push(...pages);
      }

      const seen = new Set();
      return candidates.find((page) => {
        if (seen.has(page.id)) return false;
        seen.add(page.id);
        return candidateMatchesPage(page, dataSource, candidate);
      });
    },

    remember(page) {
      const properties = page.properties ?? {};
      const mediaBlockId = propertyPlainText(properties["Media Block ID"]);
      const sourcePageId = propertyPlainText(properties["Source Page ID"]);
      const title = propertyPlainText(properties[nameProperty]);
      if (mediaBlockId) cachePages(byMediaBlockId, mediaBlockId, [page]);
      if (sourcePageId) cachePages(bySourcePageId, sourcePageId, [page]);
      if (title) cachePages(byTitle, title, [page]);
    }
  };
}

async function findExistingAsset(notion, dataSource, candidate) {
  const nameProperty = titlePropertyName(dataSource);
  const responses = [];

  if (dataSource.properties?.["Media Block ID"] && candidate.mediaBlockId) {
    responses.push(await notion.dataSources.query({
      data_source_id: dataSource.id,
      page_size: 20,
      filter: { property: "Media Block ID", rich_text: { equals: candidate.mediaBlockId } }
    }));
  }
  if (dataSource.properties?.["Source Page ID"] && candidate.sourcePageId) {
    responses.push(await notion.dataSources.query({
      data_source_id: dataSource.id,
      page_size: 20,
      filter: { property: "Source Page ID", rich_text: { equals: candidate.sourcePageId } }
    }));
  }
  responses.push(await notion.dataSources.query({
    data_source_id: dataSource.id,
    page_size: 20,
    filter: { property: nameProperty, title: { equals: candidate.name } }
  }));

  const pages = responses.flatMap((response) => response.results);
  const seen = new Set();
  return pages.find((page) => {
    if (seen.has(page.id)) return false;
    seen.add(page.id);
    return candidateMatchesPage(page, dataSource, candidate);
  });
}

async function createAsset(notion, dataSource, candidate) {
  return notion.pages.create({
    parent: { data_source_id: dataSource.id },
    properties: buildAssetProperties(dataSource, candidate)
  });
}

function isEmptyProperty(property) {
  if (!property) return true;
  if (property.type === "title") return (property.title ?? []).length === 0;
  if (property.type === "rich_text") return (property.rich_text ?? []).length === 0;
  if (property.type === "select") return !property.select;
  if (property.type === "multi_select") return (property.multi_select ?? []).length === 0;
  if (property.type === "number") return property.number === null || property.number === undefined;
  if (property.type === "url") return !property.url;
  if (property.type === "relation") return (property.relation ?? []).length === 0;
  if (property.type === "files") return (property.files ?? []).length === 0;
  if (property.type === "date") return !property.date;
  if (property.type === "checkbox") return false;
  return false;
}

function buildMissingProperties(dataSource, existingPage, candidate) {
  const candidateProperties = buildAssetProperties(dataSource, candidate);
  const existingProperties = existingPage.properties ?? {};
  const patch = {};

  for (const [name, value] of Object.entries(candidateProperties)) {
    if (name === titlePropertyName(dataSource)) continue;
    if (!dataSource.properties?.[name]) continue;
    if (!isEmptyProperty(existingProperties[name])) continue;
    patch[name] = value;
  }

  return patch;
}

const SAFE_REPLACE_EXISTING_FIELDS = new Set([
  "Display Label",
  "Resolution",
  "Video Codec",
  "Container",
  "Approx Size GB",
  "Quality Tag",
  "Audio Languages",
  "Subtitle Languages",
  "Subtitle Regions",
  "Source Lineage",
  "Developer Memo"
]);

function normalizeReplaceExistingFields(value, label = "metadata override") {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} replaceExistingFields must be an array.`);
  const fields = [...new Set(value.map((field) => cleanText(String(field))).filter(Boolean))];
  const disallowed = fields.filter((field) => !SAFE_REPLACE_EXISTING_FIELDS.has(field));
  if (disallowed.length > 0) {
    throw new Error(`${label} cannot replace protected or unknown fields: ${disallowed.join(", ")}`);
  }
  return fields;
}

function propertyMatchesPayload(existingProperty, payload) {
  if (!existingProperty || !payload) return false;
  if (existingProperty.type === "select") {
    return (existingProperty.select?.name ?? "") === (payload.select?.name ?? "");
  }
  if (existingProperty.type === "multi_select") {
    const current = (existingProperty.multi_select ?? []).map((item) => item.name).sort();
    const next = (payload.multi_select ?? []).map((item) => item.name).sort();
    return JSON.stringify(current) === JSON.stringify(next);
  }
  if (existingProperty.type === "number") return existingProperty.number === payload.number;
  if (existingProperty.type === "rich_text") {
    const next = (payload.rich_text ?? [])
      .map((item) => item.plain_text ?? item.text?.content ?? "")
      .join("")
      .trim();
    return propertyPlainText(existingProperty) === next;
  }
  return false;
}

function buildReplacementProperties(dataSource, existingPage, candidate) {
  const fields = normalizeReplaceExistingFields(candidate.replaceExistingFields, candidate.name);
  const candidateProperties = buildAssetProperties(dataSource, candidate);
  const existingProperties = existingPage.properties ?? {};
  const patch = {};

  for (const name of fields) {
    const value = candidateProperties[name];
    if (!value || !dataSource.properties?.[name]) continue;
    if (propertyMatchesPayload(existingProperties[name], value)) continue;
    patch[name] = value;
  }

  return patch;
}

async function updateExistingMissing(notion, dataSource, existingPage, candidate, apply) {
  const patch = buildMissingProperties(dataSource, existingPage, candidate);
  const fields = Object.keys(patch);
  if (fields.length === 0) {
    return { action: "skip_existing", pageId: existingPage.id, candidate };
  }
  if (!apply) {
    return { action: "would_update_existing", pageId: existingPage.id, candidate, fields, properties: patch };
  }
  await notion.pages.update({ page_id: existingPage.id, properties: patch });
  return { action: "updated_existing", pageId: existingPage.id, candidate, fields };
}

async function correctExisting(notion, dataSource, existingPage, candidate, apply) {
  const patch = buildReplacementProperties(dataSource, existingPage, candidate);
  const fields = Object.keys(patch);
  if (fields.length === 0) {
    return { action: "skip_existing", pageId: existingPage.id, candidate };
  }
  if (!apply) {
    return { action: "would_correct_existing", pageId: existingPage.id, candidate, fields, properties: patch };
  }
  await notion.pages.update({ page_id: existingPage.id, properties: patch });
  return { action: "corrected_existing", pageId: existingPage.id, candidate, fields };
}

function selectablePages(auditReport, skipPages, maxPages, includeDirectSpec, allowPartialEpisodes) {
  return (auditReport.pages ?? [])
    .filter((page) => (
      isOrganizerReportPage(page)
        ? organizerPageIsSelectable(page, allowPartialEpisodes)
        : (
            (page.summary?.hasPlayableEpisodeMedia || (includeDirectSpec && page.summary?.directPlayableMediaCount > 0)) &&
            (allowPartialEpisodes || page.summary?.unparseableEpisodePages === 0) &&
            page.summary?.duplicateEpisodeNumbers === 0
          )
    ))
    .slice(skipPages)
    .slice(0, maxPages);
}

function isOrganizerReportPage(page) {
  return Array.isArray(page.specMedia) && Array.isArray(page.specPages);
}

function organizerPageIsSelectable(page, allowPartialEpisodes) {
  const validMedia = page.specMedia.filter((item) => item.playable && item.structuralStatus === "valid_episode_media");
  if (validMedia.length === 0) return false;
  for (const spec of page.specPages) {
    const episodes = spec.episodePages ?? [];
    const numbers = episodes.map((episode) => episode.episodeNumber).filter(Number.isInteger);
    if (!allowPartialEpisodes && numbers.length !== episodes.length) return false;
    if (new Set(numbers).size !== numbers.length) return false;
    const covered = new Set();
    for (const episode of episodes) {
      const start = episode.episodeNumber;
      const end = episode.episodeEndNumber ?? start;
      if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) continue;
      for (let number = start; number <= end; number += 1) {
        if (covered.has(number)) return false;
        covered.add(number);
      }
    }
  }
  return true;
}

function childPageTitle(pathItem = "") {
  return String(pathItem).startsWith("child_page:") ? String(pathItem).slice("child_page:".length) : "";
}

export function candidatesFromOrganizerPage(page, metadataOverrides = []) {
  const candidates = [];
  const issues = [];
  const prepared = [];
  for (const media of page.specMedia ?? []) {
    if (!media.playable || media.structuralStatus !== "valid_episode_media") continue;
    const childTitles = (media.path ?? []).map(childPageTitle).filter(Boolean);
    const specTitle = childTitles[0];
    const episodeTitle = childTitles.at(-1);
    const spec = (page.specPages ?? []).find((item) => item.title === specTitle);
    const episode = (spec?.episodePages ?? []).find((item) => item.title === episodeTitle);
    if (!spec || !episode || !Number.isInteger(episode.episodeNumber)) {
      issues.push({
        kind: "organizer_media_target_unresolved",
        mediaBlockId: media.blockId,
        fileName: media.name,
        specTitle,
        episodeTitle
      });
      continue;
    }
    const placementIssue = playablePlacementIssue(spec.title, media.name);
    if (placementIssue) {
      issues.push({
        ...placementIssue,
        specPageId: spec.pageId,
        specTitle: spec.title,
        episodePageId: episode.pageId,
        episodeTitle: episode.title,
        mediaBlockId: media.blockId,
        fileName: media.name
      });
      continue;
    }
    prepared.push({ media, spec, episode });
  }
  const mediaPerEpisode = new Map();
  for (const item of prepared) {
    mediaPerEpisode.set(item.episode.pageId, (mediaPerEpisode.get(item.episode.pageId) ?? 0) + 1);
  }
  for (const { media, spec, episode } of prepared) {
    const episodeRange = episodeRangeFromLabel(episode.title);
    const episodeLabel = canonicalEpisodeLabel(episode.title);
    const variantSuffix = mediaPerEpisode.get(episode.pageId) > 1 ? ` / ${media.name || media.blockId}` : "";
    const displayLabel = `${spec.title} / ${episodeLabel}${variantSuffix}`;
    const workTitle = publicWorkTitle(page.title);
    candidates.push({
      workPageId: page.pageId,
      workTitle,
      sourcePageId: episode.pageId,
      mediaBlockId: media.blockId,
      name: `${workTitle} / ${displayLabel}`,
      displayLabel,
      originalFileName: media.name,
      metadata: parseAssetMetadata(
        `${spec.title} ${episode.title}`,
        media.name,
        episode.episodeNumber,
        episode.episodeEndNumber ?? episodeRange?.end ?? episode.episodeNumber
      )
    });
  }
  return { candidates: applyMetadataOverrides(candidates, metadataOverrides), issues };
}

function normalizeMetadataOverrides(manifestPath) {
  if (!manifestPath) return [];
  const raw = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const defaults = raw.defaults ?? {};
  const items = Array.isArray(raw) ? raw : raw.items;
  if (!Array.isArray(items)) throw new Error("Metadata manifest must be an array or an object with an items array.");
  return items.map((item, index) => ({
    label: item.label || item.originalFileName || item.mediaBlockId || `item-${index + 1}`,
    originalFileName: item.originalFileName,
    mediaBlockId: item.mediaBlockId,
    sourcePageId: item.sourcePageId,
    developerMemo: item.developerMemo ?? defaults.developerMemo,
    replaceExistingFields: normalizeReplaceExistingFields(
      item.replaceExistingFields ?? defaults.replaceExistingFields,
      item.label || item.originalFileName || item.mediaBlockId || `item-${index + 1}`
    ),
    metadata: {
      ...(defaults.metadata ?? {}),
      ...(item.metadata ?? {})
    }
  }));
}

export function comparableUploadFileName(value = "") {
  return cleanText(value)
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function metadataOverrideMatches(candidate, override) {
  if (override.mediaBlockId && candidate.mediaBlockId === override.mediaBlockId) return true;
  if (override.sourcePageId && override.originalFileName) {
    return candidate.sourcePageId === override.sourcePageId
      && (
        candidate.originalFileName === override.originalFileName
        || comparableUploadFileName(candidate.originalFileName) === comparableUploadFileName(override.originalFileName)
      );
  }
  if (override.originalFileName && candidate.originalFileName === override.originalFileName) return true;
  return false;
}

function applyMetadataOverrides(candidates, overrides) {
  if (overrides.length === 0) return candidates;
  return candidates.map((candidate) => {
    const override = overrides.find((item) => metadataOverrideMatches(candidate, item));
    if (!override) return candidate;
    return {
      ...candidate,
      developerMemo: override.developerMemo ?? candidate.developerMemo,
      replaceExistingFields: override.replaceExistingFields,
      metadata: {
        ...(candidate.metadata ?? {}),
        ...(override.metadata ?? {})
      }
    };
  });
}

async function candidatesForSeriesPage(notion, page, options = {}) {
  const candidates = [];
  const issues = [];
  for (const spec of page.specPages ?? []) {
    if (spec.directPlayableMediaCount > 0) {
      if (!options.includeDirectSpec) {
        issues.push({
          kind: "direct_spec_media_not_written",
          specPageId: spec.pageId,
          specTitle: spec.title,
          count: spec.directPlayableMediaCount
        });
      } else {
        const specChildren = await listChildren(notion, spec.pageId).catch(() => []);
        const directPlayable = specChildren.filter(isPlayableMedia);
        const directEpisodeNumbers = new Map();
        const directCandidates = [];
        for (const mediaBlock of directPlayable) {
          const fileName = mediaBlockName(mediaBlock);
          const episodeRange = episodeRangeFromLabel(fileName);
          const episodeNumber = episodeRange?.start;
          const workTitle = publicWorkTitle(page.title);
          if (!episodeNumber) {
            issues.push({
              kind: "direct_spec_media_unparseable_episode",
              specPageId: spec.pageId,
              specTitle: spec.title,
              mediaBlockId: mediaBlock.id,
              fileName
            });
            continue;
          }
          const placementIssue = playablePlacementIssue(spec.title, fileName);
          if (placementIssue) {
            issues.push({
              ...placementIssue,
              specPageId: spec.pageId,
              specTitle: spec.title,
              mediaBlockId: mediaBlock.id,
              fileName
            });
            continue;
          }
          const rangeKey = `${episodeRange.start}-${episodeRange.end}`;
          directEpisodeNumbers.set(rangeKey, (directEpisodeNumbers.get(rangeKey) ?? 0) + 1);
          const episodeLabel = canonicalEpisodeLabel(fileName);
          const displayLabel = `${spec.title} / ${episodeLabel} / ${fileName || mediaBlock.id}`;
          directCandidates.push({
            workPageId: page.pageId,
            workTitle,
            sourcePageId: spec.pageId,
            mediaBlockId: mediaBlock.id,
            name: `${workTitle} / ${displayLabel}`,
            displayLabel,
            originalFileName: fileName,
            assetUrl: isExternalMediaUrl(mediaBlock) ? mediaUrl(mediaBlock) : undefined,
            metadata: parseAssetMetadata(`${spec.title} ${episodeLabel}`, fileName, episodeNumber, episodeRange.end)
          });
        }
        const duplicateDirectEpisodes = new Set();
        for (const [episodeRange, count] of directEpisodeNumbers.entries()) {
          if (count > 1) {
            duplicateDirectEpisodes.add(episodeRange);
            issues.push({
              kind: "direct_spec_duplicate_episode_range",
              specPageId: spec.pageId,
              specTitle: spec.title,
              episodeRange,
              count
            });
          }
        }
        candidates.push(...directCandidates.filter((candidate) => !duplicateDirectEpisodes.has(
          `${candidate.metadata?.episodeNumber}-${candidate.metadata?.episodeEndNumber ?? candidate.metadata?.episodeNumber}`
        )));
      }
    }
    for (const episode of spec.episodes ?? []) {
      if (!episode.episodeNumber) {
        issues.push({ kind: "unparseable_episode_title", episodePageId: episode.pageId, title: episode.title });
        continue;
      }
      const children = await listChildren(notion, episode.pageId).catch(() => []);
      const playable = children.filter(isPlayableMedia);
      if (playable.length === 0) {
        issues.push({ kind: "empty_episode_page", episodePageId: episode.pageId, title: episode.title });
        continue;
      }
      for (const mediaBlock of playable) {
        const episodeRange = episodeRangeFromLabel(episode.title);
        const episodeLabel = canonicalEpisodeLabel(episode.title);
        const fileName = mediaBlockName(mediaBlock);
        const placementIssue = playablePlacementIssue(spec.title, fileName);
        if (placementIssue) {
          issues.push({
            ...placementIssue,
            specPageId: spec.pageId,
            specTitle: spec.title,
            episodePageId: episode.pageId,
            episodeTitle: episode.title,
            mediaBlockId: mediaBlock.id,
            fileName
          });
          continue;
        }
        const variantSuffix = playable.length > 1 ? ` / ${fileName || mediaBlock.id}` : "";
        const displayLabel = `${spec.title} / ${episodeLabel}${variantSuffix}`;
        const workTitle = publicWorkTitle(page.title);
        candidates.push({
          workPageId: page.pageId,
          workTitle,
          sourcePageId: episode.pageId,
          mediaBlockId: mediaBlock.id,
          name: `${workTitle} / ${displayLabel}`,
          displayLabel,
          originalFileName: fileName,
          assetUrl: isExternalMediaUrl(mediaBlock) ? mediaUrl(mediaBlock) : undefined,
          metadata: parseAssetMetadata(
            `${spec.title} ${episode.title}`,
            fileName,
            episode.episodeNumber,
            episode.episodeEndNumber ?? episodeRange?.end ?? episode.episodeNumber
          )
        });
      }
    }
  }
  return { candidates: applyMetadataOverrides(candidates, options.metadataOverrides ?? []), issues };
}

async function processCandidate(
  notion,
  dataSource,
  existingLookup,
  candidate,
  apply,
  updateExistingMissingEnabled,
  correctExistingEnabled
) {
  const existing = existingLookup
    ? await existingLookup.find(candidate)
    : await findExistingAsset(notion, dataSource, candidate);
  if (existing) {
    if (correctExistingEnabled) {
      return correctExisting(notion, dataSource, existing, candidate, apply);
    }
    if (updateExistingMissingEnabled) {
      return updateExistingMissing(notion, dataSource, existing, candidate, apply);
    }
    return { action: "skip_existing", pageId: existing.id, candidate };
  }
  if (!apply) {
    return { action: "would_create", candidate, properties: buildAssetProperties(dataSource, candidate) };
  }
  const created = await createAsset(notion, dataSource, candidate);
  existingLookup?.remember(created);
  return { action: "created", pageId: created.id, candidate };
}

function summarizeReports(reports) {
  return reports.reduce((summary, report) => ({
    pages: summary.pages + 1,
    candidatesFound: summary.candidatesFound + report.candidatesFound,
    selected: summary.selected + report.selected,
    created: summary.created + report.created,
    updatedExisting: summary.updatedExisting + report.updatedExisting,
    correctedExisting: summary.correctedExisting + report.correctedExisting,
    skippedExisting: summary.skippedExisting + report.skippedExisting,
    wouldCreate: summary.wouldCreate + report.wouldCreate,
    wouldUpdateExisting: summary.wouldUpdateExisting + report.wouldUpdateExisting,
    wouldCorrectExisting: summary.wouldCorrectExisting + report.wouldCorrectExisting,
    issues: summary.issues + report.issues
  }), {
    pages: 0,
    candidatesFound: 0,
    selected: 0,
    created: 0,
    updatedExisting: 0,
    correctedExisting: 0,
    skippedExisting: 0,
    wouldCreate: 0,
    wouldUpdateExisting: 0,
    wouldCorrectExisting: 0,
    issues: 0
  });
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  if (!token) throw new Error("Set NOTION_WRITE_TOKEN or NOTION_TOKEN.");

  const auditReport = JSON.parse(fs.readFileSync(options.auditReportPath, "utf8"));
  const metadataOverrides = normalizeMetadataOverrides(options.metadataManifestPath);
  const pages = selectablePages(
    auditReport,
    options.skipPages,
    options.maxPages,
    options.includeDirectSpec,
    options.allowPartialEpisodes
  );
  const notion = createNotionClient(token);
  let mediaAssetsDataSource = await loadMediaAssetsDataSource(notion);
  const schema = options.ensureSchema
    ? await ensureSeriesCollectionSchema(notion, mediaAssetsDataSource, options.apply)
    : { dataSource: mediaAssetsDataSource, added: [] };
  mediaAssetsDataSource = schema.dataSource;
  const existingLookup = makeExistingAssetLookup(notion, mediaAssetsDataSource);
  let remainingAssets = options.maxAssets;
  const reports = [];

  for (const page of pages) {
    const { candidates, issues } = isOrganizerReportPage(page)
      ? candidatesFromOrganizerPage(page, metadataOverrides)
      : await candidatesForSeriesPage(notion, page, {
          includeDirectSpec: options.includeDirectSpec,
          metadataOverrides
        });
    const selected = candidates.slice(0, remainingAssets);
    remainingAssets -= selected.length;
    const actions = [];
    for (const candidate of selected) {
      actions.push(await processCandidate(
        notion,
        mediaAssetsDataSource,
        existingLookup,
        candidate,
        options.apply,
        options.updateExistingMissing,
        options.correctExisting
      ));
    }
    reports.push({
      pageId: page.pageId,
      title: page.title,
      mode: options.apply ? "apply" : "dry-run",
      candidatesFound: candidates.length,
      selected: selected.length,
      created: actions.filter((action) => action.action === "created").length,
      updatedExisting: actions.filter((action) => action.action === "updated_existing").length,
      correctedExisting: actions.filter((action) => action.action === "corrected_existing").length,
      skippedExisting: actions.filter((action) => action.action === "skip_existing").length,
      wouldCreate: actions.filter((action) => action.action === "would_create").length,
      wouldUpdateExisting: actions.filter((action) => action.action === "would_update_existing").length,
      wouldCorrectExisting: actions.filter((action) => action.action === "would_correct_existing").length,
      issues: issues.length,
      issueDetails: issues,
      actions
    });
    if (remainingAssets <= 0) break;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    auditReportPath: options.auditReportPath,
    metadataManifestPath: options.metadataManifestPath || undefined,
    skipPages: options.skipPages,
    includeDirectSpec: options.includeDirectSpec,
    allowPartialEpisodes: options.allowPartialEpisodes,
    updateExistingMissing: options.updateExistingMissing,
    correctExisting: options.correctExisting,
    schemaAdded: schema.added,
    mediaAssetsDataSourceId: mediaAssetsDataSource.id,
    summary: summarizeReports(reports),
    reports
  };

  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    reportPath: options.reportPath,
    summary: report.summary,
    pages: reports.map((page) => ({
      title: page.title,
      candidatesFound: page.candidatesFound,
      selected: page.selected,
      created: page.created,
      updatedExisting: page.updatedExisting,
      correctedExisting: page.correctedExisting,
      skippedExisting: page.skippedExisting,
      wouldCreate: page.wouldCreate,
      wouldUpdateExisting: page.wouldUpdateExisting,
      wouldCorrectExisting: page.wouldCorrectExisting,
      issues: page.issues
    }))
  }, null, 2));
}

export {
  buildAssetProperties,
  buildMissingProperties,
  buildReplacementProperties,
  isEmptyProperty,
  parseAssetMetadata,
  selectablePages
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
