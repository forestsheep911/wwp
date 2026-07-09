#!/usr/bin/env node

import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_RATINGS_URL = "https://datasets.imdbws.com/title.ratings.tsv.gz";

function parseArgs(argv = process.argv.slice(2)) {
  const ids = [];
  const options = {
    ratingsTsv: DEFAULT_RATINGS_URL,
    dataset: true,
    page: true,
    pretty: false,
    timeoutMs: 30000
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--no-dataset") {
      options.dataset = false;
      continue;
    }
    if (arg === "--no-page") {
      options.page = false;
      continue;
    }
    if (arg === "--pretty") {
      options.pretty = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const [name, inlineValue] = arg.slice(2).split("=", 2);
      const value = inlineValue ?? argv[index + 1];
      if (inlineValue === undefined) index += 1;
      if (name === "ratings-tsv") options.ratingsTsv = value;
      else if (name === "timeout-ms") options.timeoutMs = Number(value);
      else throw new Error(`Unknown option: --${name}`);
      continue;
    }
    ids.push(arg);
  }

  return { ids, options };
}

function usage() {
  return `Usage:
  node .codex/plugins/wwp-film-workflow/scripts/imdb-rating-inspect.mjs tt43592244
  node .codex/plugins/wwp-film-workflow/scripts/imdb-rating-inspect.mjs tt43592244 --ratings-tsv .local-data/title.ratings.tsv.gz

Options:
  --ratings-tsv <path-or-url>  IMDb title.ratings.tsv or .tsv.gz source.
  --no-dataset                Skip IMDb official dataset lookup.
  --no-page                   Skip best-effort IMDb title page JSON-LD lookup.
  --timeout-ms <ms>           Network timeout for fetches. Default: 30000.
  --pretty                    Pretty-print JSON output.
`;
}

function parseCount(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseRatingsLine(line) {
  const [tconst, ratingText, votesText] = String(line).trim().split("\t");
  if (!/^tt\d+$/.test(tconst) || tconst === "tconst") return null;

  const averageRating = Number(ratingText);
  const numVotes = parseCount(votesText);
  if (!Number.isFinite(averageRating) || numVotes === undefined) return null;

  return { tconst, averageRating, numVotes };
}

function sourceIsUrl(source) {
  return /^https?:\/\//i.test(String(source));
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function openRatingsStream(source, options) {
  let stream;
  if (sourceIsUrl(source)) {
    const response = await fetchWithTimeout(source, { timeoutMs: options.timeoutMs });
    if (!response.ok) throw new Error(`IMDb ratings dataset request failed: ${response.status} ${response.statusText}`);
    stream = Readable.fromWeb(response.body);
  } else {
    stream = createReadStream(source);
  }

  if (String(source).endsWith(".gz")) return stream.pipe(createGunzip());
  return stream;
}

export async function findDatasetRating(imdbId, source = DEFAULT_RATINGS_URL, options = {}) {
  const input = await openRatingsStream(source, options);
  const lines = createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.startsWith(`${imdbId}\t`)) continue;
    const parsed = parseRatingsLine(line);
    if (!parsed) return null;
    lines.close();
    return {
      id: parsed.tconst,
      averageRating: parsed.averageRating,
      numVotes: parsed.numVotes,
      source: "imdb-datasets"
    };
  }
  return null;
}

function parseJsonLdBlocks(html) {
  const blocks = [];
  const pattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // IMDb page markup changes over time; ignore malformed blocks and try regex fallback.
    }
  }
  return blocks;
}

function walk(value, visit) {
  if (!value || typeof value !== "object") return null;
  const result = visit(value);
  if (result) return result;
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = walk(item, visit);
      if (nested) return nested;
    }
    return null;
  }
  for (const item of Object.values(value)) {
    const nested = walk(item, visit);
    if (nested) return nested;
  }
  return null;
}

function ratingFromAggregate(aggregateRating) {
  if (!aggregateRating || typeof aggregateRating !== "object") return null;
  const averageRating = Number(aggregateRating.ratingValue);
  const numVotes = parseCount(aggregateRating.ratingCount ?? aggregateRating.reviewCount);
  if (!Number.isFinite(averageRating)) return null;
  return { averageRating, numVotes };
}

export function parseImdbPageRating(html) {
  for (const block of parseJsonLdBlocks(html)) {
    const found = walk(block, (node) => ratingFromAggregate(node.aggregateRating));
    if (found) return found;
  }

  const aggregateMatch = html.match(/"aggregateRating"\s*:\s*\{([\s\S]{0,1000}?)\}/);
  if (!aggregateMatch) return null;

  const ratingValue = aggregateMatch[1].match(/"ratingValue"\s*:\s*"?([0-9.]+)"?/);
  const ratingCount = aggregateMatch[1].match(/"(?:ratingCount|reviewCount)"\s*:\s*"?([0-9,]+)"?/);
  return ratingFromAggregate({
    ratingValue: ratingValue?.[1],
    ratingCount: ratingCount?.[1]
  });
}

export async function fetchImdbPageRating(imdbId, options = {}) {
  const url = `https://www.imdb.com/title/${encodeURIComponent(imdbId)}/`;
  const response = await fetchWithTimeout(url, {
    timeoutMs: options.timeoutMs,
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    }
  });
  if (!response.ok) return null;
  const parsed = parseImdbPageRating(await response.text());
  if (!parsed) return null;
  return {
    id: imdbId,
    averageRating: parsed.averageRating,
    numVotes: parsed.numVotes,
    source: "imdb-page"
  };
}

export async function lookupImdbRating(imdbId, options = {}) {
  if (!/^tt\d+$/.test(imdbId)) throw new Error(`Invalid IMDb ID: ${imdbId}`);

  if (options.dataset !== false) {
    const datasetResult = await findDatasetRating(imdbId, options.ratingsTsv ?? DEFAULT_RATINGS_URL, options);
    if (datasetResult) return datasetResult;
  }

  if (options.page !== false) {
    const pageResult = await fetchImdbPageRating(imdbId, options);
    if (pageResult) return pageResult;
  }

  return {
    id: imdbId,
    averageRating: null,
    numVotes: null,
    source: null
  };
}

async function main() {
  const { ids, options } = parseArgs();
  if (options.help || ids.length === 0) {
    console.log(usage());
    process.exit(options.help ? 0 : 1);
  }

  const results = [];
  for (const id of ids) {
    results.push(await lookupImdbRating(id, options));
  }

  const output = results.length === 1 ? results[0] : results;
  console.log(JSON.stringify(output, null, options.pretty ? 2 : 0));
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
