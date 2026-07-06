import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

function parseArgs() {
  const options = {
    batchManifest: "",
    query: "",
    pageId: "",
    reportPath: ".local-data/notion-media-assets-write-preview.json",
    maxAssets: 3,
    maxSpecsPerPage: 80,
    resolveIp: "",
    apply: false,
    ensureSchema: true
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--batch-manifest") options.batchManifest = value();
    else if (name === "--query") options.query = value();
    else if (name === "--page-id") options.pageId = value();
    else if (name === "--report") options.reportPath = value();
    else if (name === "--max-assets") options.maxAssets = Number(value());
    else if (name === "--max-specs-per-page") options.maxSpecsPerPage = Number(value());
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--no-ensure-schema") options.ensureSchema = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.batchManifest && !options.query && !options.pageId) {
    throw new Error("Set --query, --page-id, or --batch-manifest.");
  }
  if (!Number.isFinite(options.maxAssets) || options.maxAssets < 1) {
    throw new Error("--max-assets must be a positive number.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-media-assets-write.mjs --query "风之谷"
  node tools/notion-media-assets-write.mjs --query "风之谷" --apply --max-assets 3
  node tools/notion-media-assets-write.mjs --batch-manifest .local-data/media-assets-batch.json

Default mode is dry-run. The script creates Media Assets rows only with --apply.
It writes a small representative sample, skips duplicates, and records source
Notion page/block IDs for traceability. Batch manifests use page IDs and
expected-title guards to avoid broad query mismatches.

Network workaround:
  node tools/notion-media-assets-write.mjs --query "风之谷" --resolve-ip 208.103.161.1
`);
}

function dotenv(name) {
  if (fs.existsSync(".env")) {
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match?.[1] === name) {
        return match[2].trim();
      }
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

function blockTitle(block) {
  const payload = block[block.type] ?? {};
  if (block.type === "child_page") return payload.title ?? "";
  if (block.type === "callout" || block.type === "toggle" || block.type === "paragraph") {
    return plainText(payload.rich_text);
  }
  if (block.type === "video" || block.type === "file") {
    return plainText(payload.caption) || payload.name || fileNameFromUrl(payload.file?.url ?? payload.external?.url ?? "");
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

function cleanText(value = "") {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
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

function parseAssetMetadata(label, fileName, options = {}) {
  const sourceLabel = cleanText(label);
  const cleanedFileName = cleanText(fileName ?? "");
  const combined = `${sourceLabel} ${cleanedFileName}`.trim();
  const audioLanguages = [];
  const subtitleLanguages = [];
  const subtitleRegions = [];
  const sourceLineage = [];

  if (/普通话|普通話|国语|國語|国配|國配|中影国配|中影國配|台配|mandarin|zh[-_. ]?mandarin|zh[-_. ]?taiwan/i.test(combined)) pushUnique(audioLanguages, "zh-Mandarin");
  if (/粤语|粵語|粤配|粵配|cantonese|zh[-_. ]?cantonese/i.test(combined)) pushUnique(audioLanguages, "zh-Cantonese");
  if (/日语发音|日語發音|japanese audio|\.japanese\.|japanese\.audio/i.test(combined)) pushUnique(audioLanguages, "ja");
  if (/英语发音|英語發音|english audio|\.english\.|english\.audio/i.test(combined)) pushUnique(audioLanguages, "en");
  if (/评论|評論|commentary|\bcmt\b|\bdc\d+\b/i.test(combined)) pushUnique(audioLanguages, "commentary");

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
  } else if (/简日|簡日|chsjp/i.test(combined)) {
    pushUnique(subtitleLanguages, "zh-Hans");
    pushUnique(subtitleLanguages, "ja");
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
  if (/日语字幕|日語字幕|\bjp\b/i.test(combined)) pushUnique(subtitleLanguages, "ja");
  if (/英语字幕|英語字幕|\beng\b/i.test(combined)) pushUnique(subtitleLanguages, "en");
  if (/无字幕|無字幕|no subtitles/i.test(combined)) pushUnique(subtitleLanguages, "none");

  if (/UHD Blu[- ]?ray|UHD/i.test(combined)) pushUnique(sourceLineage, "UHD Blu-ray");
  if (/Blu[- ]?ray|Bluray/i.test(combined)) pushUnique(sourceLineage, "Blu-ray");
  if (/WEB[- ]?DL/i.test(combined)) pushUnique(sourceLineage, "WEB-DL");
  if (/remux/i.test(combined)) pushUnique(sourceLineage, "remux");
  if (/\.iso\b|iso/i.test(combined)) pushUnique(sourceLineage, "ISO");
  if (/\.7z|source|片源|资源|原盘|原盤/i.test(combined)) pushUnique(sourceLineage, "source_archive");
  if (options.assetType === "playable_video") pushUnique(sourceLineage, "encode");

  const size = Number(sourceLabel.match(/(\d+(?:\.\d+)?)\s*GB/i)?.[1]);
  const metadata = {
    availability: options.availability ?? (options.assetType === "playable_video" ? "playable" : "source_only"),
    edition: firstMatch(combined, [
      /Open Matte/i,
      /The Final Cut/i,
      /Extended Collectors? Edition/i,
      /Extended (?:Edition|Cut)/i,
      /Theatrical/i,
      /IMAX/i,
      /公映比例/u,
      /剧场版/u,
      /加长版/u,
      /蓝光加长版/u
    ]),
    resolution: firstMatch(combined, [/\b(?:2160p|1080p|720p|480p)\b/i, /\b4K\b/i])?.toLowerCase(),
    videoCodec: normalizeVideoCodec(combined),
    container: extensionFromFileName(cleanedFileName),
    approximateSizeGb: Number.isFinite(size) ? size : undefined,
    qualityTag: combined.match(/\b((?:I?CQ|CRF)[\s._-]?\d{1,2})\b/i)?.[1]?.replace(/[\s._-]+/g, "").toUpperCase(),
    audioLanguages: audioLanguages.length > 0 ? audioLanguages : undefined,
    subtitleLanguages: subtitleLanguages.length > 0 ? subtitleLanguages : undefined,
    subtitleRegions: subtitleRegions.length > 0 ? subtitleRegions : undefined,
    sourceLineage: sourceLineage.length > 0 ? sourceLineage : undefined,
    originalFileName: cleanedFileName || undefined
  };

  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== "";
  }));
}

function normalizeAssetDisplayLabel(label) {
  return cleanText(label).replace(/(^|\s)(?:GB|GiB)(?=$|\s)/gi, "$1").replace(/\s+/g, " ").trim();
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

function isSourceMedia(block) {
  const name = mediaBlockName(block);
  const url = mediaUrl(block);
  return block.type === "file" || /\.(7z|zip|rar|iso|mkv|m2ts)(?:\.\d+)?(?:[?#].*)?$/i.test(`${name} ${url}`);
}

function isSourceContainerTitle(value) {
  return /^(?:基地|资源|資源|片源|原盘|原盤|source|sources)$/iu.test(cleanText(value));
}

function isMetadataContainerTitle(value) {
  return /^(?:资料|資料|meta|metadata)$/iu.test(cleanText(value));
}

async function listChildren(notion, blockId) {
  const out = [];
  let cursor;
  do {
    const response = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor
    });
    out.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function loadMainDataSource(notion) {
  const dataSourceId = dotenv("NOTION_LIBRARY_DATA_SOURCE_ID") || dotenv("NOTION_DATA_SOURCE_ID");
  if (dataSourceId) return notion.dataSources.retrieve({ data_source_id: dataSourceId });

  const databaseId = dotenv("NOTION_LIBRARY_DATABASE_ID") || dotenv("NOTION_MEDIA_DATABASE_ID");
  if (databaseId) {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    return notion.dataSources.retrieve({ data_source_id: database.data_sources?.[0]?.id || databaseId });
  }

  throw new Error("Set NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_LIBRARY_DATABASE_ID.");
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

function titlePropertyName(dataSource) {
  return Object.entries(dataSource.properties ?? {}).find(([, property]) => property.type === "title")?.[0] ?? "Title";
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

async function auditPage(notion, page, maxSpecsPerPage) {
  const title = pageTitle(page);
  const children = await listChildren(notion, page.id);
  const candidates = [];
  const issues = [];
  let specCount = 0;

  const auditPlayableSpecPage = async (specPage) => {
    if (specCount >= maxSpecsPerPage) return;
    specCount += 1;
    const specTitle = blockTitle(specPage);
    const specChildren = await listChildren(notion, specPage.id).catch(() => []);
    const media = specChildren.filter(isPlayableMedia);
    if (media.length === 0) {
      issues.push({
        kind: "playable_spec_without_media",
        pageId: specPage.id,
        label: specTitle,
        titleConfidence: "untrusted_title_only",
        recommendedAction: "Do not create a playable Media Assets row. Attach a real video/file, rename/delete the placeholder, or mark the work/asset as needs_processing/source_only."
      });
      return;
    }
    for (const mediaBlock of media) {
      const fileName = mediaBlockName(mediaBlock);
      const url = mediaUrl(mediaBlock);
      const metadata = parseAssetMetadata(specTitle, fileName, { assetType: "playable_video" });
      const displayLabel = normalizeAssetDisplayLabel(specTitle);
      candidates.push({
        assetType: "playable_video",
        workPageId: page.id,
        workTitle: title,
        sourcePageId: specPage.id,
        mediaBlockId: mediaBlock.id,
        name: displayLabel,
        displayLabel,
        titleConfidence: "verified_by_media_block",
        originalFileName: fileName,
        assetUrl: isExternalMediaUrl(mediaBlock) ? url : undefined,
        assetUrlPresent: Boolean(url),
        metadata
      });
    }
  };

  const auditSourceContainer = async (containerBlock) => {
    const groups = (await listChildren(notion, containerBlock.id).catch(() => [])).filter((item) => item.type === "child_page");
    for (const group of groups) {
      const groupTitle = blockTitle(group);
      const groupChildren = await listChildren(notion, group.id).catch(() => []);
      const media = groupChildren.filter(isSourceMedia);
      if (media.length === 0) {
        issues.push({
          kind: "source_group_without_media",
          pageId: group.id,
          label: groupTitle,
          titleConfidence: "untrusted_title_only",
          recommendedAction: "Do not create a source Media Assets row from this title alone. Attach files or remove/rename the empty source group."
        });
        continue;
      }
      const firstFile = mediaBlockName(media[0]);
      const firstUrl = mediaUrl(media[0]);
      const assetType = /字幕|subtitle/i.test(groupTitle)
        ? "subtitle_package"
        : /原盘|原盤|iso|disc/i.test(`${groupTitle} ${firstFile}`)
          ? "original_disc"
          : "source_archive";
      const metadata = parseAssetMetadata(groupTitle, firstFile, {
        assetType,
        availability: "source_only"
      });
      const displayLabel = normalizeAssetDisplayLabel(groupTitle);
      candidates.push({
        assetType,
        workPageId: page.id,
        workTitle: title,
        sourcePageId: group.id,
        mediaBlockId: media[0].id,
        name: displayLabel,
        displayLabel,
        titleConfidence: "verified_by_media_block",
        originalFileName: firstFile,
        fileCount: media.length,
        assetUrl: isExternalMediaUrl(media[0]) ? firstUrl : undefined,
        assetUrlPresent: media.some((item) => Boolean(mediaUrl(item))),
        metadata
      });
    }
  };

  for (const block of children) {
    if (block.type === "callout") {
      const specPages = (await listChildren(notion, block.id)).filter((item) => item.type === "child_page");
      for (const specPage of specPages) {
        await auditPlayableSpecPage(specPage);
      }
    }

    if (block.type === "toggle" && isSourceContainerTitle(blockTitle(block))) {
      await auditSourceContainer(block);
    }

    if (block.type === "child_page") {
      const rootTitle = blockTitle(block);
      if (isMetadataContainerTitle(rootTitle)) continue;
      if (isSourceContainerTitle(rootTitle)) {
        await auditSourceContainer(block);
      } else {
        await auditPlayableSpecPage(block);
      }
    }
  }

  return {
    pageId: page.id,
    title,
    candidates,
    issues
  };
}

function candidateKey(candidate) {
  return [
    candidate.workPageId,
    candidate.assetType,
    candidate.sourcePageId,
    candidate.mediaBlockId,
    candidate.name
  ].join("|");
}

function selectRepresentativeCandidates(candidates, maxAssets, allowedAssetTypes = []) {
  const allowed = new Set(allowedAssetTypes);
  const filteredCandidates = allowed.size > 0
    ? candidates.filter((candidate) => allowed.has(candidate.assetType))
    : candidates;
  const selected = [];
  const seen = new Set();
  const add = (candidate) => {
    if (!candidate || selected.length >= maxAssets) return;
    const key = candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(candidate);
  };

  add(filteredCandidates.find((item) => (
    item.assetType === "playable_video" &&
    item.metadata?.audioLanguages?.includes("zh-Mandarin")
  )));
  add(filteredCandidates.find((item) => (
    item.assetType === "playable_video" &&
    item.metadata?.subtitleLanguages?.includes("zh-Hant")
  )));
  add(filteredCandidates.find((item) => item.assetType === "original_disc"));
  add(filteredCandidates.find((item) => item.assetType === "source_archive"));
  add(filteredCandidates.find((item) => item.assetType === "subtitle_package"));

  for (const candidate of filteredCandidates) add(candidate);
  return selected;
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
  setIfProperty(properties, dataSource, "Name", { title: richText(candidate.name || candidate.displayLabel) });
  setIfProperty(properties, dataSource, "Work", { relation: [{ id: candidate.workPageId }] });
  setIfProperty(properties, dataSource, "Asset Type", asSelect(candidate.assetType));
  setIfProperty(properties, dataSource, "Media Availability", asSelect(metadata.availability));
  setIfProperty(properties, dataSource, "Display Label", { rich_text: richText(candidate.displayLabel) });
  setIfProperty(properties, dataSource, "Edition / Version", { rich_text: richText(metadata.edition) });
  setIfProperty(properties, dataSource, "Episode Number", metadata.episodeNumber ? { number: metadata.episodeNumber } : undefined);
  setIfProperty(properties, dataSource, "Resolution", asSelect(metadata.resolution));
  setIfProperty(properties, dataSource, "Video Codec", asSelect(metadata.videoCodec));
  setIfProperty(properties, dataSource, "Container", asSelect(metadata.container));
  setIfProperty(properties, dataSource, "Approx Size GB", metadata.approximateSizeGb ? { number: metadata.approximateSizeGb } : undefined);
  setIfProperty(properties, dataSource, "Quality Tag", { rich_text: richText(metadata.qualityTag) });
  setIfProperty(properties, dataSource, "Audio Languages", asMultiSelect(metadata.audioLanguages));
  setIfProperty(properties, dataSource, "Subtitle Languages", asMultiSelect(metadata.subtitleLanguages));
  setIfProperty(properties, dataSource, "Subtitle Regions", asMultiSelect(metadata.subtitleRegions));
  setIfProperty(properties, dataSource, "Source Lineage", asMultiSelect(metadata.sourceLineage));
  setIfProperty(properties, dataSource, "Playback Verified", { checkbox: false });
  setIfProperty(properties, dataSource, "Hide from Website", { checkbox: candidate.hideFromWebsite ?? candidate.assetType !== "playable_video" });
  setIfProperty(properties, dataSource, "Original File Name", { rich_text: richText(candidate.originalFileName) });
  setIfProperty(properties, dataSource, "Asset URL", candidate.assetUrl ? { url: candidate.assetUrl } : undefined);
  setIfProperty(properties, dataSource, "Source Page ID", { rich_text: richText(candidate.sourcePageId) });
  setIfProperty(properties, dataSource, "Media Block ID", { rich_text: richText(candidate.mediaBlockId) });
  setIfProperty(properties, dataSource, "Developer Memo", {
    rich_text: richText([
      "Created by notion-media-assets-write.mjs from existing Notion media tree.",
      candidate.assetType === "playable_video"
        ? "Playable row was created from an attached video/file block; playback still needs manual verification."
        : `Source-only row; ${candidate.fileCount ?? 1} file block(s) were observed.`,
      candidate.developerMemo,
      "Review metadata before bulk migration."
    ].filter(Boolean).join(" "))
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

async function findExistingAsset(notion, dataSource, candidate) {
  const nameProperty = titlePropertyName(dataSource);
  const responses = [];

  if (dataSource.properties?.["Media Block ID"] && candidate.mediaBlockId) {
    responses.push(await notion.dataSources.query({
      data_source_id: dataSource.id,
      page_size: 20,
      filter: {
        property: "Media Block ID",
        rich_text: { equals: candidate.mediaBlockId }
      }
    }));
  }

  if (dataSource.properties?.["Source Page ID"] && candidate.sourcePageId) {
    responses.push(await notion.dataSources.query({
      data_source_id: dataSource.id,
      page_size: 20,
      filter: {
        property: "Source Page ID",
        rich_text: { equals: candidate.sourcePageId }
      }
    }));
  }

  responses.push(await notion.dataSources.query({
    data_source_id: dataSource.id,
    page_size: 20,
    filter: {
      property: nameProperty,
      title: { equals: candidate.name }
    }
  }));

  const pages = responses.flatMap((response) => response.results);
  const seen = new Set();
  return pages.find((page) => {
    if (seen.has(page.id)) return false;
    seen.add(page.id);
    const properties = page.properties ?? {};
    const workMatches = relationIds(properties.Work).includes(candidate.workPageId);
    const titleMatches = propertyPlainText(properties[nameProperty]) === candidate.name;
    const sourcePageMatches = propertyPlainText(properties["Source Page ID"]) === candidate.sourcePageId;
    const mediaBlockMatches = propertyPlainText(properties["Media Block ID"]) === candidate.mediaBlockId;
    const fileNameMatches = !candidate.originalFileName ||
      propertyPlainText(properties["Original File Name"]) === candidate.originalFileName;
    return workMatches && (
      mediaBlockMatches ||
      (sourcePageMatches && fileNameMatches && titleMatches) ||
      (titleMatches && fileNameMatches)
    );
  });
}

async function ensureTraceabilitySchema(notion, dataSource) {
  const missing = missingTraceabilitySchema(dataSource);
  if (Object.keys(missing).length === 0) {
    return { dataSource, added: [] };
  }

  const updated = await notion.dataSources.update({
    data_source_id: dataSource.id,
    properties: missing
  });
  return { dataSource: updated, added: Object.keys(missing) };
}

function missingTraceabilitySchema(dataSource) {
  const missing = {};
  if (!dataSource.properties?.["Source Page ID"]) missing["Source Page ID"] = { rich_text: {} };
  if (!dataSource.properties?.["Media Block ID"]) missing["Media Block ID"] = { rich_text: {} };
  return missing;
}

async function resolveWorkPage(notion, mainDataSource, options) {
  if (options.pageId) {
    return notion.pages.retrieve({ page_id: options.pageId });
  }
  const matches = await queryPages(notion, mainDataSource, options.query, 3);
  if (matches.length === 0) throw new Error(`No Notion library page matched query: ${options.query}`);
  if (matches.length > 1) {
    console.log(JSON.stringify({
      matchedPages: matches.map((page) => ({ id: page.id, title: pageTitle(page) }))
    }, null, 2));
  }
  return matches[0];
}

async function createAsset(notion, dataSource, candidate) {
  return notion.pages.create({
    parent: { data_source_id: dataSource.id },
    properties: buildAssetProperties(dataSource, candidate)
  });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function arrayify(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function titleContainsExpected(title, expectedTitleContains) {
  const expected = arrayify(expectedTitleContains).map((item) => cleanText(String(item))).filter(Boolean);
  if (expected.length === 0) return true;
  const normalizedTitle = cleanText(title).toLowerCase();
  return expected.every((item) => normalizedTitle.includes(item.toLowerCase()));
}

function normalizeManifest(manifest, options) {
  const items = Array.isArray(manifest) ? manifest : manifest.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Batch manifest must be an array or an object with a non-empty items array.");
  }

  const defaults = Array.isArray(manifest) ? {} : manifest.defaults ?? {};
  return items.map((item, index) => {
    if (!item.pageId) throw new Error(`Batch manifest item ${index + 1} is missing pageId.`);
    return {
      label: item.label || item.expectedTitleContains || item.pageId,
      pageId: item.pageId,
      expectedTitleContains: item.expectedTitleContains,
      maxAssets: Number(item.maxAssets ?? defaults.maxAssets ?? options.maxAssets),
      maxSpecsPerPage: Number(item.maxSpecsPerPage ?? defaults.maxSpecsPerPage ?? options.maxSpecsPerPage),
      allowedAssetTypes: arrayify(item.allowedAssetTypes ?? defaults.allowedAssetTypes).filter(Boolean),
      mediaAvailability: item.mediaAvailability ?? defaults.mediaAvailability,
      hideFromWebsite: item.hideFromWebsite ?? defaults.hideFromWebsite,
      developerMemo: item.developerMemo ?? defaults.developerMemo
    };
  });
}

function applyManifestOverrides(candidate, item = {}) {
  if (item.mediaAvailability === undefined && item.hideFromWebsite === undefined && !item.developerMemo) {
    return candidate;
  }
  return {
    ...candidate,
    hideFromWebsite: item.hideFromWebsite,
    developerMemo: item.developerMemo,
    metadata: {
      ...(candidate.metadata ?? {}),
      availability: item.mediaAvailability ?? candidate.metadata?.availability
    }
  };
}

async function processWorkPage(notion, mediaAssetsDataSource, options, workPage, item = {}) {
  const audited = await auditPage(notion, workPage, item.maxSpecsPerPage ?? options.maxSpecsPerPage);
  const titleMatches = titleContainsExpected(audited.title, item.expectedTitleContains);
  if (!titleMatches) {
    return {
      label: item.label,
      mode: options.apply ? "apply" : "dry-run",
      pageId: workPage.id,
      title: audited.title,
      expectedTitleContains: item.expectedTitleContains,
      summary: {
        candidatesFound: audited.candidates.length,
        selected: 0,
        created: 0,
        skippedExisting: 0,
        wouldCreate: 0,
        issues: audited.issues.length,
        skippedTitleMismatch: 1
      },
      selected: [],
      actions: [{
        action: "skip_title_mismatch",
        expectedTitleContains: item.expectedTitleContains,
        actualTitle: audited.title
      }],
      issues: audited.issues
    };
  }

  const selected = selectRepresentativeCandidates(
    audited.candidates,
    item.maxAssets ?? options.maxAssets,
    item.allowedAssetTypes
  ).map((candidate) => applyManifestOverrides(candidate, item));
  const actions = [];

  for (const candidate of selected) {
    const existing = await findExistingAsset(notion, mediaAssetsDataSource, candidate);
    if (existing) {
      actions.push({
        action: "skip_existing",
        pageId: existing.id,
        candidate
      });
      continue;
    }

    if (!options.apply) {
      actions.push({
        action: "would_create",
        candidate,
        properties: buildAssetProperties(mediaAssetsDataSource, candidate)
      });
      continue;
    }

    const created = await createAsset(notion, mediaAssetsDataSource, candidate);
    actions.push({
      action: "created",
      pageId: created.id,
      candidate
    });
  }

  return {
    label: item.label,
    mode: options.apply ? "apply" : "dry-run",
    pageId: workPage.id,
    title: audited.title,
    expectedTitleContains: item.expectedTitleContains,
    allowedAssetTypes: item.allowedAssetTypes ?? [],
    summary: {
      candidatesFound: audited.candidates.length,
      selected: selected.length,
      created: actions.filter((action) => action.action === "created").length,
      skippedExisting: actions.filter((action) => action.action === "skip_existing").length,
      wouldCreate: actions.filter((action) => action.action === "would_create").length,
      issues: audited.issues.length,
      skippedTitleMismatch: 0
    },
    selected,
    actions,
    issues: audited.issues
  };
}

function summarizeReports(reports) {
  return reports.reduce((summary, report) => ({
    pages: summary.pages + 1,
    candidatesFound: summary.candidatesFound + report.summary.candidatesFound,
    selected: summary.selected + report.summary.selected,
    created: summary.created + report.summary.created,
    skippedExisting: summary.skippedExisting + report.summary.skippedExisting,
    wouldCreate: summary.wouldCreate + report.summary.wouldCreate,
    issues: summary.issues + report.summary.issues,
    skippedTitleMismatch: summary.skippedTitleMismatch + report.summary.skippedTitleMismatch
  }), {
    pages: 0,
    candidatesFound: 0,
    selected: 0,
    created: 0,
    skippedExisting: 0,
    wouldCreate: 0,
    issues: 0,
    skippedTitleMismatch: 0
  });
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  if (!token) throw new Error("Set NOTION_WRITE_TOKEN or NOTION_TOKEN.");

  const notion = createNotionClient(token);
  const mainDataSource = await loadMainDataSource(notion);
  let mediaAssetsDataSource = await loadMediaAssetsDataSource(notion);
  const schemaResult = options.ensureSchema && options.apply
    ? await ensureTraceabilitySchema(notion, mediaAssetsDataSource)
    : {
        dataSource: mediaAssetsDataSource,
        added: [],
        wouldAdd: options.ensureSchema ? Object.keys(missingTraceabilitySchema(mediaAssetsDataSource)) : []
      };
  mediaAssetsDataSource = schemaResult.dataSource;

  if (options.batchManifest) {
    const manifest = readJsonFile(options.batchManifest);
    const items = normalizeManifest(manifest, options);
    const pages = [];
    const reports = [];
    for (const item of items) {
      const workPage = await notion.pages.retrieve({ page_id: item.pageId });
      const report = await processWorkPage(notion, mediaAssetsDataSource, options, workPage, item);
      reports.push(report);
      pages.push({
        label: item.label,
        pageId: report.pageId,
        title: report.title,
        summary: report.summary,
        actions: report.actions.map((action) => ({
          action: action.action,
          pageId: action.pageId,
          assetType: action.candidate?.assetType,
          name: action.candidate?.name
        }))
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      mode: options.apply ? "apply" : "dry-run",
      manifestPath: options.batchManifest,
      mainDataSourceId: mainDataSource.id,
      mediaAssetsDataSourceId: mediaAssetsDataSource.id,
      schemaAdded: schemaResult.added,
      schemaWouldAdd: schemaResult.wouldAdd ?? [],
      summary: summarizeReports(reports),
      pages,
      reports
    };

    fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
    fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      reportPath: options.reportPath,
      summary: report.summary,
      schemaAdded: report.schemaAdded,
      schemaWouldAdd: report.schemaWouldAdd,
      pages: pages.map((page) => ({
        label: page.label,
        title: page.title,
        summary: page.summary
      }))
    }, null, 2));
    return;
  }

  const workPage = await resolveWorkPage(notion, mainDataSource, options);
  const pageReport = await processWorkPage(notion, mediaAssetsDataSource, options, workPage);
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    mainDataSourceId: mainDataSource.id,
    mediaAssetsDataSourceId: mediaAssetsDataSource.id,
    schemaAdded: schemaResult.added,
    schemaWouldAdd: schemaResult.wouldAdd ?? [],
    query: options.query || undefined,
    pageId: pageReport.pageId,
    title: pageReport.title,
    summary: pageReport.summary,
    selected: pageReport.selected,
    actions: pageReport.actions,
    issues: pageReport.issues
  };

  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    reportPath: options.reportPath,
    summary: report.summary,
    schemaAdded: report.schemaAdded,
    schemaWouldAdd: report.schemaWouldAdd,
    actions: report.actions.map((item) => ({
      action: item.action,
      pageId: item.pageId,
      assetType: item.candidate?.assetType,
      name: item.candidate?.name
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
