#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    discoverOnly: false,
    searchOnly: false,
    timeoutMs: 30000,
    pretty: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--pretty") {
      options.pretty = true;
      continue;
    }
    if (arg === "--discover-only") {
      options.discoverOnly = true;
      continue;
    }
    if (arg === "--search-only") {
      options.searchOnly = true;
      continue;
    }
    if (!arg.startsWith("--")) throw new Error(`Unexpected positional argument: ${arg}`);

    const [name, inlineValue] = arg.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (inlineValue === undefined) index += 1;

    if (name === "rotten-url") options.rottenUrl = value;
    else if (name === "metacritic-url") options.metacriticUrl = value;
    else if (name === "imdb-url") options.imdbUrl = value;
    else if (name === "ratings-json") options.ratingsJson = value;
    else if (name === "imdb-id") options.imdbId = normalizeImdbId(value);
    else if (name === "wikidata-json") options.wikidataJson = value;
    else if (name === "title") options.title = value;
    else if (name === "year") options.year = value;
    else if (name === "timeout-ms") options.timeoutMs = Number(value);
    else throw new Error(`Unknown option: --${name}`);
  }

  return options;
}

function usage() {
  return `Usage:
  node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --rotten-url <url-or-html-path>
  node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --metacritic-url <url-or-html-path>
  node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --rotten-url <url> --metacritic-url <url>
  node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --imdb-id <ttid>
  node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --imdb-url <url-or-html-path>
  node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --ratings-json <trusted-evidence.json>
  node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --title <title> --year <year> --search-only

Options:
  --rotten-url <url-or-path>      Rotten Tomatoes official page or saved HTML.
  --metacritic-url <url-or-path>  Metacritic official page or saved HTML.
  --imdb-url <url-or-path>        IMDb official title page or saved HTML for Metascore fallback.
  --ratings-json <url-or-path>    Trusted structured manual/licensed evidence JSON.
  --imdb-id <ttid>                Discover Rotten Tomatoes/Metacritic URLs from Wikidata by IMDb ID, then inspect them.
  --wikidata-json <url-or-path>   Read Wikidata SPARQL JSON instead of calling the live endpoint.
  --discover-only                 Only return discovered official-page URLs; do not fetch page HTML.
  --title <title> --year <year>   Emit official critic-site search URLs for manual page confirmation.
  --search-only                   Only emit official search URLs; do not fetch page HTML.
  --timeout-ms <ms>               Network timeout for fetches. Default: 30000.
  --pretty                        Pretty-print JSON output.
`;
}

function normalizeImdbId(value) {
  const match = String(value ?? "").trim().match(/tt\d{7,9}/i);
  return match ? match[0].toLowerCase() : undefined;
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

async function readHtml(source, options = {}) {
  if (!sourceIsUrl(source)) return await readFile(source, "utf8");
  const response = await fetchWithTimeout(source, {
    timeoutMs: options.timeoutMs,
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    }
  });
  if (!response.ok) throw new Error(`Request failed for ${source}: ${response.status} ${response.statusText}`);
  return await response.text();
}

async function readJson(source, options = {}) {
  if (!sourceIsUrl(source)) return JSON.parse(await readFile(source, "utf8"));
  const response = await fetchWithTimeout(source, {
    timeoutMs: options.timeoutMs,
    headers: {
      "accept": "application/sparql-results+json,application/json;q=0.9,*/*;q=0.8",
      "user-agent": "WWP-Film-Workflow/1.0 (local metadata backfill)"
    }
  });
  if (!response.ok) throw new Error(`Request failed for ${source}: ${response.status} ${response.statusText}`);
  return await response.json();
}

async function fetchWikidataCriticIds(imdbId, options = {}) {
  if (!normalizeImdbId(imdbId)) throw new Error(`Invalid IMDb ID for Wikidata lookup: ${imdbId}`);
  const query = `
SELECT ?item ?itemLabel ?rottenTomatoesId ?metacriticId WHERE {
  ?item wdt:P345 "${normalizeImdbId(imdbId)}".
  OPTIONAL { ?item wdt:P1258 ?rottenTomatoesId. }
  OPTIONAL { ?item wdt:P1712 ?metacriticId. }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 5`;
  const endpoint = new URL("https://query.wikidata.org/sparql");
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("format", "json");
  return await readJson(endpoint.href, options);
}

function officialRottenTomatoesUrl(id) {
  const value = String(id ?? "").trim().replace(/^\/+/, "");
  if (!value) return undefined;
  if (sourceIsUrl(value)) return value;
  return `https://www.rottentomatoes.com/${value}`;
}

function officialMetacriticUrl(id) {
  const value = String(id ?? "").trim().replace(/^\/+/, "");
  if (!value) return undefined;
  if (sourceIsUrl(value)) return value;
  return `https://www.metacritic.com/${value}`;
}

export function buildOfficialSearchUrls({ title, year } = {}) {
  const query = [title, year].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!query) return {};
  const encoded = encodeSearchComponent(query);
  return {
    rottenTomatoes: `https://www.rottentomatoes.com/search?search=${encoded}`,
    metacritic: `https://www.metacritic.com/search/${encoded}/`
  };
}

function encodeSearchComponent(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function parseWikidataCriticIds(payload) {
  const bindings = payload?.results?.bindings;
  if (!Array.isArray(bindings)) return { candidates: [] };

  const candidates = bindings.map((binding) => {
    const rottenTomatoesId = binding.rottenTomatoesId?.value;
    const metacriticId = binding.metacriticId?.value;
    return {
      item: binding.item?.value,
      label: binding.itemLabel?.value,
      rottenTomatoesId,
      rottenTomatoesUrl: officialRottenTomatoesUrl(rottenTomatoesId),
      metacriticId,
      metacriticUrl: officialMetacriticUrl(metacriticId)
    };
  });

  const withUrls = candidates.find((candidate) => candidate.rottenTomatoesUrl || candidate.metacriticUrl) ?? candidates[0];
  return {
    candidates,
    rottenTomatoesUrl: withUrls?.rottenTomatoesUrl,
    metacriticUrl: withUrls?.metacriticUrl
  };
}

function parseNumber(value) {
  const cleaned = String(value ?? "").replace(/,/g, "").replace(/%$/, "").trim();
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parsePercentScore(value, fieldName) {
  const score = parseNumber(value);
  if (score === undefined) return undefined;
  if (score < 0 || score > 100) {
    throw new Error(`${fieldName} score must be between 0 and 100: ${value}`);
  }
  return score;
}

function validEvidenceSource(source) {
  return /^(rotten-tomatoes-page|metacritic-page|imdb-page-metascore)$/i.test(source) ||
    /^(licensed-source|manual-evidence):[A-Za-z0-9][A-Za-z0-9 ._-]{1,80}$/i.test(source);
}

function scoreExists(value) {
  return parseNumber(value) !== undefined;
}

function normalizeRatingEvidenceItem(input, fieldName) {
  if (input === undefined || input === null) return undefined;
  const item = typeof input === "object" ? input : { score: input };
  const score = parsePercentScore(
    item.score ?? item.value ?? item.rating ?? item.ratingValue ?? item.percent,
    fieldName
  );
  if (score === undefined) return undefined;

  const source = String(item.source ?? item.sourceLabel ?? "").trim();
  if (!validEvidenceSource(source)) {
    throw new Error(
      `${fieldName} structured evidence requires source "rotten-tomatoes-page", "metacritic-page", ` +
      `"imdb-page-metascore", "licensed-source:<name>", or "manual-evidence:<name>".`
    );
  }

  const result = { score, source };
  const reviewCount = parseNumber(item.reviewCount ?? item.ratingCount ?? item.reviews);
  if (reviewCount !== undefined) result.reviewCount = reviewCount;
  const averageRating = parseNumber(item.averageRating);
  if (averageRating !== undefined) result.averageRating = averageRating;
  if (typeof item.certified === "boolean") result.certified = item.certified;
  if (item.url || item.sourceUrl) result.url = String(item.url ?? item.sourceUrl);
  if (item.observedAt || item.capturedAt || item.date) {
    result.observedAt = String(item.observedAt ?? item.capturedAt ?? item.date);
  }
  return result;
}

export function normalizeStructuredRatingEvidence(payload = {}) {
  const rottenInput =
    payload.rottenTomatoes ??
    payload.rotten ??
    payload.rt ??
    payload.tomatometer ??
    payload["烂番茄新鲜度"];
  const metacriticInput =
    payload.metacritic ??
    payload.metascore ??
    payload.Metascore ??
    payload.meta ??
    payload["Meta评分"];

  const result = {};
  const rottenTomatoes = normalizeRatingEvidenceItem(rottenInput, "Rotten Tomatoes");
  const metacritic = normalizeRatingEvidenceItem(metacriticInput, "Metascore");
  if (rottenTomatoes) result.rottenTomatoes = rottenTomatoes;
  if (metacritic) result.metacritic = metacritic;
  return result;
}

function firstScriptJsonById(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`<script[^>]*id=["']${escapedId}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const match = html.match(pattern);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}

function scriptJsonByType(html, typePattern) {
  const scripts = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!typePattern.test(match[1])) continue;
    const raw = decodeHtmlEntities(match[2].trim());
    if (!raw) continue;
    try {
      scripts.push(JSON.parse(raw));
    } catch {
      // Ignore non-JSON script bodies. Official pages sometimes include malformed
      // legacy snippets next to valid JSON-LD.
    }
  }
  return scripts;
}

function decodeHtmlEntities(value) {
  return String(value)
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/gi, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function flattenJsonLd(value) {
  const output = [];
  const visit = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    output.push(node);
    visit(node["@graph"]);
  };
  visit(value);
  return output;
}

function jsonLdAggregateRatings(html, expectedNamePattern) {
  const ratings = [];
  for (const script of scriptJsonByType(html, /\btype=["']application\/ld\+json["']/i)) {
    for (const node of flattenJsonLd(script)) {
      const rating = node.aggregateRating ?? (String(node["@type"] ?? "").includes("AggregateRating") ? node : undefined);
      if (!rating || typeof rating !== "object") continue;
      const name = String(rating.name ?? rating.description ?? "").trim();
      if (expectedNamePattern && !expectedNamePattern.test(name)) continue;
      const score = parseNumber(rating.ratingValue ?? rating.value ?? rating.score);
      if (score === undefined) continue;
      const bestRating = parseNumber(rating.bestRating);
      if (bestRating !== undefined && bestRating !== 100) continue;
      const result = { score };
      const reviewCount = parseNumber(rating.reviewCount ?? rating.ratingCount);
      if (reviewCount !== undefined) result.reviewCount = reviewCount;
      ratings.push(result);
    }
  }
  return ratings;
}

function parseHtmlAttributes(source = "") {
  const attributes = {};
  for (const match of source.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
    attributes[match[1].toLowerCase()] = match[3];
  }
  return attributes;
}

function parseRottenTomatoesScoreBoard(html) {
  const tag = html.match(/<score-board\b([^>]*)>/i);
  if (!tag) return null;

  const attributes = parseHtmlAttributes(tag[1]);
  const score = parseNumber(attributes.tomatometerscore ?? attributes.tomatometer_score);
  if (score === undefined) return null;

  const result = { score };
  const reviewCount = parseNumber(
    attributes.tomatometerreviewcount ??
    attributes.tomatometer_review_count ??
    attributes.reviewcount ??
    attributes.ratingcount
  );
  if (reviewCount !== undefined) result.reviewCount = reviewCount;

  const state = attributes.tomatometerstate ?? attributes.tomatometer_state;
  if (state) result.certified = /\bcertified\b/i.test(state);
  return result;
}

export function parseRottenTomatoesPage(html) {
  const scorecard = firstScriptJsonById(html, "media-scorecard-json");
  const critics = scorecard?.criticsScore;
  if (!critics) return parseRottenTomatoesScoreBoard(html) ?? parseRottenTomatoesJsonLd(html);

  const score = parseNumber(critics.score ?? critics.scorePercent);
  if (score === undefined) return null;

  const result = { score };
  const reviewCount = parseNumber(critics.reviewCount ?? critics.ratingCount);
  const averageRating = parseNumber(critics.averageRating);
  if (reviewCount !== undefined) result.reviewCount = reviewCount;
  if (averageRating !== undefined) result.averageRating = averageRating;
  if (typeof critics.certified === "boolean") result.certified = critics.certified;
  return result;
}

function parseRottenTomatoesJsonLd(html) {
  const [rating] = jsonLdAggregateRatings(html, /tomatometer|rotten tomatoes/i);
  return rating ?? null;
}

export function parseMetacriticPage(html) {
  const result = parseMetascoreMarkup(html) ?? parseMetacriticJsonLd(html);
  if (!result) return null;

  if (result.reviewCount === undefined) {
    const countMatch = html.match(/Based on\s+([0-9,]+)\s+Critic Reviews/i);
    const reviewCount = parseNumber(countMatch?.[1]);
    if (reviewCount !== undefined) result.reviewCount = reviewCount;
  }
  return result;
}

function parseMetascoreMarkup(html) {
  const titleMatch = html.match(/(?:^|[\s<])(?:title|aria-label)=["']Metascore\s+([0-9]+)\s+out of\s+100["']/i);
  const scoreValueMatch = html.match(/data-testid=["']global-score-value["'][^>]*>\s*([0-9]+)\s*</i);
  const legacyScoreMatch = html.match(/<[^>]*class=["'][^"']*\bmetascore_w\b[^"']*["'][^>]*>\s*([0-9]+)\s*</i);
  const imdbJsonMatch = html.match(/"metacriticScore"\s*:\s*\{[\s\S]{0,500}?"score"\s*:\s*([0-9]+)/i);
  const score = parseNumber(titleMatch?.[1] ?? scoreValueMatch?.[1] ?? legacyScoreMatch?.[1] ?? imdbJsonMatch?.[1]);
  if (score === undefined) return null;

  return { score };
}

function parseMetacriticJsonLd(html) {
  const [rating] = jsonLdAggregateRatings(html, /metascore/i);
  return rating ?? null;
}

export function parseImdbMetascorePage(html) {
  return parseMetascoreMarkup(html);
}

export async function inspectCriticRatings(options) {
  const result = {};
  let rottenUrl = options.rottenUrl;
  let metacriticUrl = options.metacriticUrl;
  const searchUrls = buildOfficialSearchUrls(options);
  const structuredEvidence = options.ratingsJson
    ? normalizeStructuredRatingEvidence(await readJson(options.ratingsJson, options))
    : {};

  if (options.imdbId || options.wikidataJson) {
    const wikidataPayload = options.wikidataJson
      ? await readJson(options.wikidataJson, options)
      : await fetchWikidataCriticIds(options.imdbId, options);
    const discovery = parseWikidataCriticIds(wikidataPayload);
    result.discovery = {
      source: options.wikidataJson ? "wikidata-json" : "wikidata-sparql",
      imdbId: options.imdbId,
      ...discovery
    };
    rottenUrl ??= discovery.rottenTomatoesUrl;
    metacriticUrl ??= discovery.metacriticUrl;
  }

  if (Object.keys(searchUrls).length > 0) {
    result.officialSearch = searchUrls;
  }

  if (options.searchOnly) return result;
  if (options.discoverOnly) return result;

  if (rottenUrl) {
    const parsed = parseRottenTomatoesPage(await readHtml(rottenUrl, options));
    result.rottenTomatoes = parsed
      ? { ...parsed, source: "rotten-tomatoes-page", url: sourceIsUrl(rottenUrl) ? rottenUrl : undefined }
      : { score: null, source: null };
  }

  if (metacriticUrl) {
    const parsed = parseMetacriticPage(await readHtml(metacriticUrl, options));
    result.metacritic = parsed
      ? { ...parsed, source: "metacritic-page", url: sourceIsUrl(metacriticUrl) ? metacriticUrl : undefined }
      : { score: null, source: null };
  }

  if (options.imdbUrl && !result.metacritic?.score) {
    const parsed = parseImdbMetascorePage(await readHtml(options.imdbUrl, options));
    result.metacritic = parsed
      ? { ...parsed, source: "imdb-page-metascore", url: sourceIsUrl(options.imdbUrl) ? options.imdbUrl : undefined }
      : (result.metacritic ?? { score: null, source: null });
  }

  if (structuredEvidence.rottenTomatoes && !scoreExists(result.rottenTomatoes?.score)) {
    result.rottenTomatoes = structuredEvidence.rottenTomatoes;
  }

  if (structuredEvidence.metacritic && !scoreExists(result.metacritic?.score)) {
    result.metacritic = structuredEvidence.metacritic;
  }

  return result;
}

async function main() {
  const options = parseArgs();
  if (options.help || (!options.rottenUrl && !options.metacriticUrl && !options.imdbUrl && !options.imdbId && !options.wikidataJson && !options.title && !options.ratingsJson)) {
    console.log(usage());
    process.exit(options.help ? 0 : 1);
  }

  const result = await inspectCriticRatings(options);
  console.log(JSON.stringify(result, null, options.pretty ? 2 : 0));
}

if (import.meta.url === pathToFileURL(path.resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
