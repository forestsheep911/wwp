import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

function parseArgs() {
  const options = {
    manifestPath: "",
    pageIds: [],
    limit: 20,
    skipTargets: 0,
    reportPath: ".local-data/notion-series-structure-audit.json",
    includePrefixed: false,
    resolveIp: ""
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--manifest") options.manifestPath = value();
    else if (name === "--page-id") options.pageIds.push(value());
    else if (name === "--limit") options.limit = Number(value());
    else if (name === "--skip-targets") options.skipTargets = Number(value());
    else if (name === "--report") options.reportPath = value();
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (arg === "--include-prefixed") options.includePrefixed = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && !options.manifestPath) {
      options.manifestPath = arg;
    } else if (!arg.startsWith("-") && options.reportPath === ".local-data/notion-series-structure-audit.json") {
      options.reportPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.manifestPath && options.pageIds.length === 0) {
    throw new Error("Set --manifest or at least one --page-id.");
  }
  if (!Number.isFinite(options.limit) || options.limit < 1) {
    throw new Error("--limit must be a positive number.");
  }
  if (!Number.isFinite(options.skipTargets) || options.skipTargets < 0) {
    throw new Error("--skip-targets must be zero or a positive number.");
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-series-structure-audit.mjs --manifest .local-data/notion-media-assets-batch-round22.json --limit 20 --report .local-data/series-audit.json
  node tools/notion-series-structure-audit.mjs --manifest .local-data/notion-media-assets-batch-round22.json --skip-targets 20 --limit 20 --report .local-data/series-audit-next.json
  npm run notion:series-audit -- .local-data/notion-media-assets-batch-round22.json .local-data/series-audit.json
  node tools/notion-series-structure-audit.mjs --page-id <notion-page-id> --report .local-data/series-audit.json

This is read-only. It inspects TV/season page structure and reports whether the
old Notion tree follows season -> spec -> episode -> media.
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

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function pageTitle(page) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property.type === "title") return cleanText(plainText(property.title));
  }
  return "";
}

function selectName(property) {
  return property?.type === "select" ? property.select?.name ?? "" : "";
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

function canonicalEpisodeLabel(value) {
  const number = episodeNumberFromLabel(value);
  return number ? `Episode ${String(number).padStart(2, "0")}` : cleanText(value);
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

function loadTargets(options) {
  const targets = options.pageIds.map((pageId) => ({ pageId, title: "" }));
  if (!options.manifestPath) return targets.slice(0, options.limit);

  const manifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf8"));
  for (const item of manifest.skipped ?? []) {
    const reasons = item.reasons ?? [];
    const covered = reasons.includes("already_has_media_assets") || reasons.includes("already_has_media_assets_same_title");
    const prefixed = reasons.includes("operator_prefix");
    const series = reasons.includes("series_season") || reasons.some((reason) => reason.startsWith("non_movie_kind:TV"));
    if (covered || !series) continue;
    if (!options.includePrefixed && prefixed) continue;
    targets.push({ pageId: item.pageId, title: cleanText(item.title), reasons });
  }
  return targets.slice(options.skipTargets, options.skipTargets + options.limit);
}

async function auditSpecPage(notion, specPage) {
  const children = await listChildren(notion, specPage.id).catch(() => []);
  const episodeBlocks = children.filter((block) => block.type === "child_page");
  const directPlayable = children.filter(isPlayableMedia);
  const episodes = [];
  const seenNumbers = new Map();

  for (const episodeBlock of episodeBlocks) {
    const title = blockTitle(episodeBlock);
    const number = episodeNumberFromLabel(title);
    const episodeChildren = await listChildren(notion, episodeBlock.id).catch(() => []);
    const playable = episodeChildren.filter(isPlayableMedia);
    if (number) seenNumbers.set(number, (seenNumbers.get(number) ?? 0) + 1);
    episodes.push({
      pageId: episodeBlock.id,
      title,
      episodeNumber: number,
      canonicalLabel: canonicalEpisodeLabel(title),
      playableMediaCount: playable.length,
      playableMediaNames: playable.map(mediaBlockName).slice(0, 5)
    });
  }

  return {
    pageId: specPage.id,
    title: specPage.title,
    episodePageCount: episodes.length,
    parseableEpisodeCount: episodes.filter((episode) => episode.episodeNumber).length,
    unparseableEpisodeTitles: episodes.filter((episode) => !episode.episodeNumber).map((episode) => episode.title),
    duplicateEpisodeNumbers: [...seenNumbers.entries()].filter(([, count]) => count > 1).map(([number]) => number),
    emptyEpisodeTitles: episodes.filter((episode) => episode.playableMediaCount === 0).map((episode) => episode.title),
    playableMediaInEpisodes: episodes.reduce((sum, episode) => sum + episode.playableMediaCount, 0),
    directPlayableMediaCount: directPlayable.length,
    directPlayableMediaNames: directPlayable.map(mediaBlockName).slice(0, 5),
    episodes
  };
}

async function auditSeriesPage(notion, target) {
  const page = await notion.pages.retrieve({ page_id: target.pageId });
  const title = pageTitle(page) || target.title;
  const children = await listChildren(notion, page.id);
  const specPages = [];
  const legacyWrappers = [];

  for (const block of children) {
    if (block.type === "callout") {
      const nested = await listChildren(notion, block.id).catch(() => []);
      for (const child of nested.filter((item) => item.type === "child_page")) {
        specPages.push({ id: child.id, title: blockTitle(child), parentLabel: blockTitle(block), parentType: block.type });
      }
    } else if (block.type === "child_page") {
      const childTitle = blockTitle(block);
      // A manually moved legacy season container has the same title as the new
      // season work page. Flatten it for read-only auditing so its actual
      // specification pages are not mistaken for episode pages.
      if (cleanText(childTitle) === cleanText(title)) {
        legacyWrappers.push({ id: block.id, title: childTitle });
        const nested = await listChildren(notion, block.id).catch(() => []);
        for (const nestedBlock of nested) {
          if (nestedBlock.type === "child_page") {
            specPages.push({ id: nestedBlock.id, title: blockTitle(nestedBlock), parentLabel: childTitle, parentType: "legacy_wrapper" });
          } else if (nestedBlock.type === "callout") {
            const calloutChildren = await listChildren(notion, nestedBlock.id).catch(() => []);
            for (const child of calloutChildren.filter((item) => item.type === "child_page")) {
              specPages.push({ id: child.id, title: blockTitle(child), parentLabel: blockTitle(nestedBlock), parentType: "legacy_wrapper_callout" });
            }
          }
        }
      } else {
        specPages.push({ id: block.id, title: childTitle, parentLabel: "root", parentType: block.type });
      }
    }
  }

  const auditedSpecs = [];
  for (const specPage of specPages) {
    auditedSpecs.push(await auditSpecPage(notion, specPage));
  }

  const episodePageCount = auditedSpecs.reduce((sum, spec) => sum + spec.episodePageCount, 0);
  const playableMediaInEpisodes = auditedSpecs.reduce((sum, spec) => sum + spec.playableMediaInEpisodes, 0);
  const directPlayableMediaCount = auditedSpecs.reduce((sum, spec) => sum + spec.directPlayableMediaCount, 0);
  const unparseableEpisodeTitles = auditedSpecs.flatMap((spec) => spec.unparseableEpisodeTitles.map((episodeTitle) => `${spec.title} / ${episodeTitle}`));
  const duplicateEpisodeNumbers = auditedSpecs.flatMap((spec) => spec.duplicateEpisodeNumbers.map((episodeNumber) => `${spec.title} / ${episodeNumber}`));
  const emptyEpisodeTitles = auditedSpecs.flatMap((spec) => spec.emptyEpisodeTitles.map((episodeTitle) => `${spec.title} / ${episodeTitle}`));
  const emptySpecTitles = auditedSpecs
    .filter((spec) => spec.episodePageCount === 0 && spec.directPlayableMediaCount === 0)
    .map((spec) => spec.title);

  return {
    pageId: page.id,
    title,
    reasons: target.reasons ?? [],
    mediaKind: selectName(page.properties?.["影别"]),
    legacyWrappers,
    summary: {
      specPageCount: auditedSpecs.length,
      episodePageCount,
      playableMediaInEpisodes,
      directPlayableMediaCount,
      parseableEpisodePages: auditedSpecs.reduce((sum, spec) => sum + spec.parseableEpisodeCount, 0),
      unparseableEpisodePages: unparseableEpisodeTitles.length,
      emptyEpisodePages: emptyEpisodeTitles.length,
      emptySpecPages: emptySpecTitles.length,
      duplicateEpisodeNumbers: duplicateEpisodeNumbers.length,
      hasEpisodeLayer: episodePageCount > 0,
      hasPlayableEpisodeMedia: playableMediaInEpisodes > 0
    },
    issues: {
      emptySpecTitles,
      emptyEpisodeTitles,
      unparseableEpisodeTitles,
      duplicateEpisodeNumbers
    },
    specPages: auditedSpecs
  };
}

function summarize(pages) {
  return {
    pages: pages.length,
    pagesWithEpisodeLayer: pages.filter((page) => page.summary.hasEpisodeLayer).length,
    pagesWithPlayableEpisodeMedia: pages.filter((page) => page.summary.hasPlayableEpisodeMedia).length,
    pagesWithDirectSpecMedia: pages.filter((page) => page.summary.directPlayableMediaCount > 0).length,
    pagesWithEmptySpecs: pages.filter((page) => page.summary.emptySpecPages > 0).length,
    pagesWithEmptyEpisodes: pages.filter((page) => page.summary.emptyEpisodePages > 0).length,
    pagesWithUnparseableEpisodes: pages.filter((page) => page.summary.unparseableEpisodePages > 0).length,
    totalSpecPages: pages.reduce((sum, page) => sum + page.summary.specPageCount, 0),
    totalEpisodePages: pages.reduce((sum, page) => sum + page.summary.episodePageCount, 0),
    totalPlayableEpisodeMedia: pages.reduce((sum, page) => sum + page.summary.playableMediaInEpisodes, 0),
    totalDirectSpecPlayableMedia: pages.reduce((sum, page) => sum + page.summary.directPlayableMediaCount, 0)
  };
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_READ_ONLY_TOKEN") || dotenv("NOTION_TOKEN") || dotenv("NOTION_WRITE_TOKEN");
  if (!token) throw new Error("Set NOTION_READ_ONLY_TOKEN, NOTION_TOKEN, or NOTION_WRITE_TOKEN.");

  const targets = loadTargets(options);
  const notion = createNotionClient(token);
  const pages = [];
  for (const target of targets) {
    pages.push(await auditSeriesPage(notion, target));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "read-only",
    manifestPath: options.manifestPath || undefined,
    includePrefixed: options.includePrefixed,
    skipTargets: options.skipTargets,
    targetCount: targets.length,
    summary: summarize(pages),
    pages
  };

  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    reportPath: options.reportPath,
    summary: report.summary,
    firstPages: pages.slice(0, 8).map((page) => ({
      title: page.title,
      mediaKind: page.mediaKind,
      summary: page.summary
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
