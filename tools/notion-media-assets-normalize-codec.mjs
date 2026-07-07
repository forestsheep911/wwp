import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

const CODEC_MAP = new Map([
  ["h265", "hevc"],
  ["HEVC", "hevc"],
  ["x265", "hevc"],
  ["H.264", "h264"],
  ["avc", "h264"],
  ["x264", "h264"],
  ["AV1", "av1"]
]);

function parseArgs() {
  const options = {
    reportPath: ".local-data/notion-media-assets-normalize-codec.json",
    resolveIp: "",
    limit: 200,
    delayMs: 350,
    concurrency: 1,
    apply: false
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--report") options.reportPath = value();
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (name === "--limit") options.limit = Number(value());
    else if (name === "--delay-ms") options.delayMs = Number(value());
    else if (name === "--concurrency") options.concurrency = Number(value());
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!Number.isFinite(options.limit) || options.limit < 1) throw new Error("--limit must be a positive number.");
  if (!Number.isFinite(options.delayMs) || options.delayMs < 0) throw new Error("--delay-ms must be zero or a positive number.");
  if (!Number.isFinite(options.concurrency) || options.concurrency < 1) throw new Error("--concurrency must be a positive number.");
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-media-assets-normalize-codec.mjs --report .local-data/codec-preview.json
  node tools/notion-media-assets-normalize-codec.mjs --apply --limit 500 --concurrency 3 --report .local-data/codec-apply-1.json

Default mode is dry-run. It normalizes Media Assets "Video Codec" select values:
h265/x265 -> hevc, avc/x264 -> h264, and keeps av1 as the canonical AV1 family value.

Network workaround:
  node tools/notion-media-assets-normalize-codec.mjs --resolve-ip 208.103.161.1
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

async function retrieveMediaAssetsDataSource(notion) {
  const dataSourceId = dotenv("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID");
  if (dataSourceId) return notion.dataSources.retrieve({ data_source_id: dataSourceId });

  const databaseId = dotenv("NOTION_MEDIA_ASSETS_DATABASE_ID");
  if (databaseId) {
    const database = await notion.databases.retrieve({ database_id: databaseId });
    return notion.dataSources.retrieve({ data_source_id: database.data_sources?.[0]?.id || databaseId });
  }

  throw new Error("Set NOTION_MEDIA_ASSETS_DATA_SOURCE_ID or NOTION_MEDIA_ASSETS_DATABASE_ID.");
}

async function queryAllPages(notion, dataSourceId) {
  const pages = [];
  let cursor;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      start_cursor: cursor
    });
    pages.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return pages;
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function pageTitle(page) {
  for (const property of Object.values(page.properties ?? {})) {
    if (property?.type === "title") return plainText(property.title);
  }
  return "";
}

function codecValue(page) {
  const property = page.properties?.["Video Codec"];
  return property?.type === "select" ? property.select?.name ?? "" : "";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateWithRetry(notion, pageId, nextValue) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await notion.pages.update({
        page_id: pageId,
        properties: {
          "Video Codec": { select: { name: nextValue } }
        }
      });
      return;
    } catch (error) {
      const status = error.status ?? error.code;
      if (status !== 429 && status !== "rate_limited") throw error;
      await sleep(1000 * attempt);
    }
  }
  throw new Error(`Rate limited too many times while updating ${pageId}`);
}

async function runUpdatePool(items, concurrency, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  if (!token) throw new Error("Set NOTION_WRITE_TOKEN or NOTION_TOKEN.");

  const notion = createNotionClient(token);
  const dataSource = await retrieveMediaAssetsDataSource(notion);
  const pages = await queryAllPages(notion, dataSource.id);
  const counts = {};
  const candidates = [];

  for (const page of pages) {
    const current = codecValue(page);
    if (!current) continue;
    counts[current] = (counts[current] ?? 0) + 1;
    const next = CODEC_MAP.get(current);
    if (next && next !== current) {
      candidates.push({
        pageId: page.id,
        title: pageTitle(page),
        from: current,
        to: next
      });
    }
  }

  const selected = candidates.slice(0, options.limit);
  const updated = [];
  const errors = [];
  if (options.apply) {
    await runUpdatePool(selected, options.concurrency, async (candidate) => {
      try {
        await updateWithRetry(notion, candidate.pageId, candidate.to);
        updated.push(candidate);
      } catch (error) {
        errors.push({ ...candidate, error: error.message });
      }
      if (options.delayMs > 0) await sleep(options.delayMs);
    });
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dataSourceId: dataSource.id,
    apply: options.apply,
    counts,
    candidatesFound: candidates.length,
    selected: selected.length,
    updated: updated.length,
    errors,
    remainingEstimate: Math.max(0, candidates.length - updated.length),
    sample: selected.slice(0, 20)
  };

  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    reportPath: options.reportPath,
    apply: options.apply,
    candidatesFound: report.candidatesFound,
    selected: report.selected,
    updated: report.updated,
    errors: report.errors.length,
    remainingEstimate: report.remainingEstimate,
    counts: report.counts
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
