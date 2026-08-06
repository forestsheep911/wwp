import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

const DEFAULT_QUERIES = [
  "泰坦尼克",
  "终结者2",
  "银翼杀手",
  "风之谷",
  "功夫熊猫3",
  "阿凡达",
  "指环王",
  "十二怒汉",
  "12 Angry Men",
  "黑暗骑士",
  "千与千寻"
];

function parseArgs() {
  const options = {
    queries: [],
    reportPath: ".local-data/notion-media-assets-audit.json",
    limitPerQuery: 2,
    maxSpecsPerPage: 80,
    resolveIp: ""
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--query") options.queries.push(value());
    else if (name === "--report") options.reportPath = value();
    else if (name === "--limit-per-query") options.limitPerQuery = Number(value());
    else if (name === "--max-specs-per-page") options.maxSpecsPerPage = Number(value());
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (options.queries.length === 0) {
    options.queries = DEFAULT_QUERIES;
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-media-assets-audit.mjs [--query "泰坦尼克"] [--report .local-data/audit.json]

This is read-only. It inspects representative Notion work pages and proposes
candidate Media Assets rows for playable specs and source/original-disc pages.

Network workaround:
  node tools/notion-media-assets-audit.mjs --resolve-ip 208.103.161.1
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

  if (/普通话|普通話|国语|國語|mandarin/i.test(combined)) pushUnique(audioLanguages, "zh-Mandarin");
  if (/粤语|粵語|cantonese/i.test(combined)) pushUnique(audioLanguages, "zh-Cantonese");
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
    resolution: firstMatch(combined, [/\b(?:2160p|1080p|960p|720p|576p|480p)\b/i, /\b4K\b/i])?.toLowerCase(),
    videoCodec: normalizeVideoCodec(combined),
    container: extensionFromFileName(cleanedFileName),
    approximateSizeGb: Number.isFinite(size) ? size : undefined,
    qualityTag: combined.match(/\b((?:I?CQ|CRF)[\s._-]?\d{1,2})\b/i)?.[1]?.replace(/[\s._-]+/g, "").toUpperCase(),
    audioLanguages: audioLanguages.length > 0 ? audioLanguages : undefined,
    subtitleLanguages: subtitleLanguages.length > 0 ? subtitleLanguages : undefined,
    subtitleRegions: subtitleRegions.length > 0 ? subtitleRegions : undefined,
    sourceLineage: sourceLineage.length > 0 ? sourceLineage : undefined,
    commentary: audioLanguages.includes("commentary") || undefined,
    noSubtitles: subtitleLanguages.includes("none") || undefined,
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

function titlePropertyName(dataSource) {
  return Object.entries(dataSource.properties ?? {}).find(([, property]) => property.type === "title")?.[0] ?? "Title";
}

function isSeriesTitle(title) {
  return /(?:第\s*[一二三四五六七八九十百千万0-9]+\s*季|\bS\d{1,2}\b|\bSeason\s*\d+\b|电视剧|剧集)/iu.test(title);
}

function hasPerEpisodeSizeMarker(title) {
  return /(?:\/\s*集|每\s*集|per\s*episode)/iu.test(title);
}

function hasGbSize(title) {
  return /\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*GB\b/i.test(title);
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
    if (isSeriesTitle(title) && hasGbSize(specTitle) && !hasPerEpisodeSizeMarker(specTitle)) {
      issues.push({
        kind: "series_spec_size_not_per_episode",
        pageId: specPage.id,
        label: specTitle,
        titleConfidence: "untrusted_title_only",
        recommendedAction: "Measure the episode files, rename the spec with a per-episode decimal-GB value or range such as 0.32-0.36GB/集, and never use the season aggregate in the spec title."
      });
    }
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
      const metadata = parseAssetMetadata(specTitle, fileName, { assetType: "playable_video" });
      const displayLabel = normalizeAssetDisplayLabel(specTitle);
      candidates.push({
        assetType: "playable_video",
        workPageId: page.id,
        workTitle: title,
        sourcePageId: specPage.id,
        name: displayLabel,
        displayLabel,
        titleConfidence: "verified_by_media_block",
        originalFileName: fileName,
        assetUrlPresent: Boolean(mediaUrl(mediaBlock)),
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
        name: displayLabel,
        displayLabel,
        titleConfidence: "verified_by_media_block",
        originalFileName: firstFile,
        fileCount: media.length,
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

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_READ_ONLY_TOKEN") || dotenv("NOTION_TOKEN") || dotenv("NOTION_WRITE_TOKEN");
  if (!token) throw new Error("Set NOTION_READ_ONLY_TOKEN, NOTION_TOKEN, or NOTION_WRITE_TOKEN.");

  const notion = createNotionClient(token);
  const dataSource = await loadMainDataSource(notion);
  const seen = new Set();
  const pages = [];
  for (const query of options.queries) {
    const matches = await queryPages(notion, dataSource, query, options.limitPerQuery);
    for (const page of matches) {
      if (seen.has(page.id)) continue;
      seen.add(page.id);
      pages.push({ query, page });
    }
  }

  const audited = [];
  for (const item of pages) {
    audited.push({
      query: item.query,
      ...(await auditPage(notion, item.page, options.maxSpecsPerPage))
    });
  }

  const allCandidates = audited.flatMap((page) => page.candidates);
  const allIssues = audited.flatMap((page) => page.issues.map((issue) => ({
    workTitle: page.title,
    ...issue
  })));
  const report = {
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    dataSourceId: dataSource.id,
    queries: options.queries,
    summary: {
      pages: audited.length,
      candidates: allCandidates.length,
      playableVideoCandidates: allCandidates.filter((item) => item.assetType === "playable_video").length,
      sourceCandidates: allCandidates.filter((item) => item.assetType !== "playable_video").length,
      issues: allIssues.length
    },
    pages: audited,
    candidates: allCandidates,
    issues: allIssues
  };

  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    reportPath: options.reportPath,
    summary: report.summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
