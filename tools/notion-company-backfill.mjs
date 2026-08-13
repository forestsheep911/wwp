import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";

const DEFAULT_INDEX = ".local-data/home-site/search-index.json";
const DEFAULT_CANDIDATES = ".local-data/notion-company-backfill-candidates.json";
const DEFAULT_EVIDENCE = ".local-data/notion-company-backfill-omdb-cache.json";
const DEFAULT_WIKIDATA_EVIDENCE = ".local-data/notion-company-backfill-wikidata-cache.json";
const DEFAULT_PROGRESS = ".local-data/notion-company-backfill-progress.jsonl";
const DEFAULT_REPORT = ".local-data/notion-company-backfill-report.json";

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
    skipOmdb: false,
    limit: 5,
    poolSize: 80,
    minYear: undefined,
    requestIntervalMs: 1100,
    indexPath: DEFAULT_INDEX,
    candidatePath: DEFAULT_CANDIDATES,
    evidencePath: DEFAULT_EVIDENCE,
    wikidataEvidencePath: DEFAULT_WIKIDATA_EVIDENCE,
    progressPath: DEFAULT_PROGRESS,
    reportPath: DEFAULT_REPORT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--skip-omdb") options.skipOmdb = true;
    else if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg === "--pool-size") options.poolSize = Number(argv[++index]);
    else if (arg === "--min-year") options.minYear = Number(argv[++index]);
    else if (arg === "--request-interval-ms") options.requestIntervalMs = Number(argv[++index]);
    else if (arg === "--index") options.indexPath = argv[++index];
    else if (arg === "--candidate-cache") options.candidatePath = argv[++index];
    else if (arg === "--evidence-cache") options.evidencePath = argv[++index];
    else if (arg === "--wikidata-evidence-cache") options.wikidataEvidencePath = argv[++index];
    else if (arg === "--progress") options.progressPath = argv[++index];
    else if (arg === "--report") options.reportPath = argv[++index];
    else if (arg === "--help") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1) throw new Error("--limit must be a positive integer.");
  if (!Number.isInteger(options.poolSize) || options.poolSize < options.limit) throw new Error("--pool-size must be an integer >= --limit.");
  if (options.minYear !== undefined && (!Number.isInteger(options.minYear) || options.minYear < 1880 || options.minYear > 2100)) {
    throw new Error("--min-year must be a plausible four-digit year.");
  }
  if (!Number.isFinite(options.requestIntervalMs) || options.requestIntervalMs < 1000) {
    throw new Error("--request-interval-ms must be at least 1000.");
  }
  return options;
}

function usage() {
  return `Usage:
  node tools/notion-company-backfill.mjs [--limit 5] [--pool-size 80] [--apply]

Builds a reusable candidate cache from the local website index, fetches OMDb
Production by exact IMDb ID, and fills only an empty Notion
"Production Companies" field. Dry-run is the default. Notion is never scanned;
each candidate is retrieved and verified by exact page ID before any write.`;
}

function env(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(".env")) return undefined;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match?.[1] === name) return match[2].trim().replace(/^['"]|['"]$/gu, "");
  }
  return undefined;
}

function installNotionDnsOverride() {
  const address = env("NOTION_API_RESOLVE_IP");
  if (!address) return;
  const originalLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return originalLookup(hostname, options, callback);
    if (typeof options === "function") return options(null, address, 4);
    if (options?.all) return callback(null, [{ address, family: 4 }]);
    return callback(null, address, 4);
  };
}

function ensureParent(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function writeJson(filePath, value) {
  ensureParent(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(filePath, fallback) {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
}

function appendJsonl(filePath, value) {
  ensureParent(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function plainText(items = []) {
  return items.map((item) => item?.plain_text ?? "").join("").trim();
}

export function propertyText(property) {
  if (!property) return "";
  if (property.type === "title") return plainText(property.title);
  if (property.type === "rich_text") return plainText(property.rich_text);
  if (property.type === "url") return property.url ?? "";
  if (property.type === "number") return property.number == null ? "" : `${property.number}`;
  if (property.type === "select") return property.select?.name ?? "";
  return "";
}

function pageTitle(properties = {}) {
  const titleProperty = Object.values(properties).find((property) => property?.type === "title");
  return propertyText(titleProperty);
}

function pageImdbId(properties = {}) {
  for (const name of ["IMDb ID", "IMDB ID", "imdb"]) {
    const match = propertyText(properties[name]).match(/tt\d{5,12}/iu);
    if (match) return match[0].toLowerCase();
  }
  for (const property of Object.values(properties)) {
    const match = propertyText(property).match(/(?:imdb\.com\/title\/)?(tt\d{5,12})/iu);
    if (match) return match[1].toLowerCase();
  }
  return "";
}

function metadataImdbId(metadata = {}) {
  return `${metadata.imdbId ?? metadata.externalIds?.imdb ?? metadata.work?.externalIds?.imdb ?? ""}`
    .match(/tt\d{5,12}/iu)?.[0]?.toLowerCase() ?? "";
}

export function buildCandidates(indexJson, poolSize = 80, minYear) {
  const candidates = Object.values(indexJson?.entries ?? {})
    .map((entry) => {
      const result = entry?.result ?? {};
      const metadata = result.metadata ?? {};
      const kind = metadata.kind ?? metadata.work?.kind;
      return {
        pageId: entry.sourcePageId ?? result.sourcePageId,
        title: entry.title ?? result.title,
        imdbId: metadataImdbId(metadata),
        kind,
        year: metadata.year ?? metadata.release?.year ?? metadata.work?.release?.year,
        sourceUpdatedAt: entry.sourceUpdatedAt ?? result.updatedAt
      };
    })
    .filter((item) => item.pageId && item.title && item.kind === "movie" && item.imdbId &&
      (minYear === undefined || Number(item.year) >= minYear))
    .sort((left, right) =>
      `${left.sourceUpdatedAt ?? ""}`.localeCompare(`${right.sourceUpdatedAt ?? ""}`) ||
      `${left.title}`.localeCompare(`${right.title}`, "zh-CN") ||
      `${left.pageId}`.localeCompare(`${right.pageId}`)
    );
  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.pageId)) continue;
    seen.add(candidate.pageId);
    unique.push(candidate);
    if (unique.length >= poolSize) break;
  }
  return unique;
}

function readProgress(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

function createLimiter(intervalMs) {
  let lastStartedAt = 0;
  return async (operation) => {
    const waitMs = Math.max(0, intervalMs - (Date.now() - lastStartedAt));
    if (waitMs) await sleep(waitMs);
    lastStartedAt = Date.now();
    return operation();
  };
}

function richText(value) {
  return `${value}`.match(/[\s\S]{1,1900}/gu).map((content) => ({ type: "text", text: { content } }));
}

function statusCode(error) {
  return error?.status ?? error?.statusCode ?? error?.code;
}

function retryAfter(error) {
  return error?.headers?.get?.("retry-after") ?? error?.headers?.["retry-after"] ?? error?.body?.retry_after;
}

async function fetchOmdb(imdbId, apiKey) {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("i", imdbId);
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const payload = await response.json();
  if (!response.ok) throw new Error(`OMDb HTTP ${response.status}`);
  return {
    fetchedAt: new Date().toISOString(),
    imdbId,
    response: payload.Response,
    error: payload.Error,
    title: payload.Title,
    year: payload.Year,
    type: payload.Type,
    production: payload.Production && payload.Production !== "N/A" ? payload.Production.trim() : ""
  };
}

export function parseWikidataBindings(bindings = []) {
  const byImdbId = {};
  for (const binding of bindings) {
    const imdbId = `${binding?.imdb?.value ?? ""}`.toLowerCase();
    const entityUrl = binding?.company?.value ?? "";
    const name = `${binding?.companyLabel?.value ?? ""}`.trim();
    if (!/^tt\d{5,12}$/u.test(imdbId) || !name || /^Q\d+$/u.test(name) || !entityUrl) continue;
    byImdbId[imdbId] ??= [];
    if (!byImdbId[imdbId].some((company) => company.entityUrl === entityUrl)) {
      byImdbId[imdbId].push({ name, entityUrl });
    }
  }
  return byImdbId;
}

export function wikidataNeedsHistoricalReview(year, omdbProduction = "") {
  return !`${omdbProduction}`.trim() && Number(year) < 2020;
}

async function fetchWikidataProduction(imdbIds) {
  const values = [...new Set(imdbIds)].map((id) => `"${id}"`).join(" ");
  const query = `SELECT ?imdb ?company ?companyLabel WHERE {
    VALUES ?imdb { ${values} }
    ?work wdt:P345 ?imdb; wdt:P272 ?company.
    SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
  }`;
  const response = await fetch("https://query.wikidata.org/sparql", {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      Accept: "application/sparql-results+json",
      "User-Agent": "WWP-film-metadata-backfill/1.0 (local catalog maintenance)"
    },
    body: new URLSearchParams({ query })
  });
  if (!response.ok) throw new Error(`Wikidata SPARQL HTTP ${response.status}`);
  const payload = await response.json();
  return parseWikidataBindings(payload?.results?.bindings ?? []);
}

async function run(options) {
  const startedAt = new Date().toISOString();
  let candidateDocument = readJson(options.candidatePath, null);
  if (!candidateDocument) {
    const indexJson = readJson(options.indexPath, null);
    if (!indexJson) throw new Error(`Local index not found: ${options.indexPath}`);
    candidateDocument = {
      generatedAt: startedAt,
      sourceIndex: path.resolve(options.indexPath),
      sourceIndexMtime: fs.statSync(options.indexPath).mtime.toISOString(),
      criteria: { kind: "movie", minYear: options.minYear ?? null, poolSize: options.poolSize },
      candidates: buildCandidates(indexJson, options.poolSize, options.minYear)
    };
    writeJson(options.candidatePath, candidateDocument);
  }

  const progress = readProgress(options.progressPath);
  const completed = new Set(progress.filter((row) => ["updated", "already_populated", "identity_mismatch", "no_company_evidence", "page_unavailable", "historical_name_review_required"].includes(row.status)).map((row) => row.pageId));
  const evidence = readJson(options.evidencePath, {});
  let wikidataEvidence = readJson(options.wikidataEvidencePath, null);
  if (!wikidataEvidence || wikidataEvidence.language !== "en") {
    const imdbIds = (candidateDocument.candidates ?? []).map((candidate) => candidate.imdbId).filter(Boolean);
    wikidataEvidence = {
      fetchedAt: new Date().toISOString(),
      source: "Wikidata P272",
      language: "en",
      byImdbId: await fetchWikidataProduction(imdbIds)
    };
    writeJson(options.wikidataEvidencePath, wikidataEvidence);
  }
  const omdbKey = env("OMDB_API_KEY");
  if (!options.skipOmdb && !omdbKey) throw new Error("OMDB_API_KEY is required unless --skip-omdb is used.");

  installNotionDnsOverride();
  const token = options.apply
    ? env("NOTION_WRITE_TOKEN") ?? env("NOTION_TOKEN")
    : env("NOTION_READ_ONLY_TOKEN") ?? env("NOTION_WRITE_TOKEN") ?? env("NOTION_TOKEN");
  if (!token) throw new Error(options.apply ? "NOTION_WRITE_TOKEN or NOTION_TOKEN is required." : "A Notion token is required.");
  const notion = new Client({ auth: token, timeoutMs: Number(env("NOTION_REQUEST_TIMEOUT_MS") ?? 30000), maxRetries: 0 });
  const notionRequest = createLimiter(options.requestIntervalMs);
  const omdbRequest = createLimiter(options.requestIntervalMs);
  const actions = [];
  let successful = 0;
  let halted = false;

  for (const candidate of candidateDocument.candidates ?? []) {
    if (successful >= options.limit || halted) break;
    if (completed.has(candidate.pageId)) continue;

    let omdb = evidence[candidate.imdbId] ?? { imdbId: candidate.imdbId, production: "" };
    if (!options.skipOmdb && !evidence[candidate.imdbId]) {
      omdb = await omdbRequest(() => fetchOmdb(candidate.imdbId, omdbKey));
      evidence[candidate.imdbId] = omdb;
      writeJson(options.evidencePath, evidence);
    }
    const wikidataCompanies = (wikidataEvidence.byImdbId?.[candidate.imdbId] ?? [])
      .filter((company) => company?.name && !/^Q\d+$/u.test(company.name));
    const productionCompanies = omdb.production || wikidataCompanies.map((company) => company.name).join(" / ");
    const companyEvidence = omdb.production
      ? { source: "OMDb Production", imdbId: omdb.imdbId, title: omdb.title, year: omdb.year, fetchedAt: omdb.fetchedAt }
      : wikidataCompanies.length
        ? { source: "Wikidata P272", imdbId: candidate.imdbId, fetchedAt: wikidataEvidence.fetchedAt, companies: wikidataCompanies }
        : null;
    if (!productionCompanies) {
      const record = {
        at: new Date().toISOString(), status: "no_company_evidence", ...candidate,
        attemptedSources: options.skipOmdb ? ["Wikidata P272"] : ["OMDb Production", "Wikidata P272"]
      };
      appendJsonl(options.progressPath, record);
      actions.push(record);
      completed.add(candidate.pageId);
      continue;
    }
    if (wikidataNeedsHistoricalReview(candidate.year, omdb.production)) {
      const record = {
        at: new Date().toISOString(), status: "historical_name_review_required", ...candidate,
        reason: "Wikidata company labels are current entity labels and may not preserve the name credited at release time.",
        evidence: companyEvidence
      };
      appendJsonl(options.progressPath, record);
      actions.push(record);
      completed.add(candidate.pageId);
      continue;
    }

    try {
      const page = await notionRequest(() => notion.pages.retrieve({ page_id: candidate.pageId }));
      const currentTitle = pageTitle(page.properties);
      const currentImdbId = pageImdbId(page.properties);
      if (page.archived || page.in_trash || currentImdbId !== candidate.imdbId) {
        const record = { at: new Date().toISOString(), status: "identity_mismatch", ...candidate, currentTitle, currentImdbId };
        appendJsonl(options.progressPath, record);
        actions.push(record);
        completed.add(candidate.pageId);
        continue;
      }
      const productionProperty = page.properties["Production Companies"];
      if (!productionProperty || productionProperty.type !== "rich_text") {
        throw new Error(`Production Companies rich_text field is missing on ${candidate.pageId}.`);
      }
      const existing = propertyText(productionProperty);
      if (existing) {
        const record = { at: new Date().toISOString(), status: "already_populated", ...candidate, currentTitle, existing };
        appendJsonl(options.progressPath, record);
        actions.push(record);
        completed.add(candidate.pageId);
        continue;
      }

      if (!options.apply) {
        actions.push({ status: "would_update", ...candidate, currentTitle, productionCompanies, evidence: companyEvidence });
        successful += 1;
        continue;
      }

      await notionRequest(() => notion.pages.update({
        page_id: candidate.pageId,
        properties: { "Production Companies": { rich_text: richText(productionCompanies) } }
      }));
      const readback = await notionRequest(() => notion.pages.retrieve({ page_id: candidate.pageId }));
      const readbackValue = propertyText(readback.properties["Production Companies"]);
      if (readbackValue !== productionCompanies) throw new Error(`Readback mismatch for ${candidate.pageId}.`);
      const record = {
        at: new Date().toISOString(), status: "updated", ...candidate,
        currentTitle, productionCompanies: readbackValue,
        evidence: companyEvidence
      };
      appendJsonl(options.progressPath, record);
      actions.push(record);
      completed.add(candidate.pageId);
      successful += 1;
    } catch (error) {
      const code = statusCode(error);
      const unavailable = code === 404 || code === "object_not_found";
      const record = {
        at: new Date().toISOString(),
        status: code === 429 || code === "rate_limited" ? "halted_rate_limit" : unavailable ? "page_unavailable" : "error",
        ...candidate, code, error: error?.message ?? `${error}`, retryAfter: retryAfter(error)
      };
      appendJsonl(options.progressPath, record);
      actions.push(record);
      if (unavailable) completed.add(candidate.pageId);
      if (record.status === "halted_rate_limit") halted = true;
    }
  }

  const report = {
    startedAt,
    finishedAt: new Date().toISOString(),
    apply: options.apply,
    skipOmdb: options.skipOmdb,
    requestedSuccessfulUpdates: options.limit,
    successful,
    halted,
    candidateCache: path.resolve(options.candidatePath),
    evidenceCache: path.resolve(options.evidencePath),
    wikidataEvidenceCache: path.resolve(options.wikidataEvidencePath),
    progress: path.resolve(options.progressPath),
    actions
  };
  writeJson(options.reportPath, report);
  console.log(JSON.stringify(report, null, 2));
  if (halted) process.exitCode = 2;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const options = parseArgs();
  if (options.help) console.log(usage());
  else await run(options);
}
