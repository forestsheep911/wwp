#!/usr/bin/env node

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openLedger } from "./lib/film-ledger-schema.mjs";

const DEFAULT_PREVIEW_LIMIT = 3;
const DEFAULT_INDEX = path.resolve(".local-data/home-site/search-index.json");
const DEFAULT_LEDGER = path.resolve(".local-data/wwp-film-workflow.sqlite");

function parseArgs(args) {
  const options = { index: DEFAULT_INDEX, previewLimit: DEFAULT_PREVIEW_LIMIT };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--page-id") options.pageId = args[++index];
    else if (arg === "--index") options.index = path.resolve(args[++index]);
    else if (arg === "--preview-limit") options.previewLimit = Number(args[++index]);
    else if (arg === "--live") options.live = true;
    else if (arg === "--title") options.title = args[++index];
    else if (arg === "--origin") options.origin = args[++index];
    else if (arg === "--db") options.db = path.resolve(args[++index]);
    else if (arg === "--record-ledger") options.recordLedger = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.pageId?.trim()) throw new Error("--page-id is required.");
  if (!Number.isInteger(options.previewLimit) || options.previewLimit < 1) throw new Error("--preview-limit must be a positive integer.");
  if (options.live && !options.title?.trim()) throw new Error("--live requires --title for a bounded website search.");
  if (options.recordLedger && !options.live) throw new Error("--record-ledger requires --live; local index evidence is not publication proof.");
  return options;
}

function normalizedPageId(value) {
  return String(value ?? "").replaceAll("-", "").toLowerCase();
}

export function liveSearchIndexDocument(payload, pageId) {
  const results = Array.isArray(payload) ? payload : payload?.results ?? payload?.items ?? [];
  const expected = normalizedPageId(pageId);
  const result = results.find((item) => normalizedPageId(item?.sourcePageId) === expected);
  const assetKey = `notion-page-${pageId.trim()}`;
  return { entries: result ? { [assetKey]: { result } } : {} };
}

async function fetchLiveSearch(options) {
  const origin = String(options.origin ?? process.env.WWPDW_HOME_PUBLIC_ORIGIN ?? "").trim();
  const passcode = String(process.env.WWPDW_ADMIN_KEY ?? "").trim();
  if (!origin) throw new Error("WWPDW_HOME_PUBLIC_ORIGIN or --origin is required for --live.");
  if (!passcode) throw new Error("WWPDW_ADMIN_KEY is required for authenticated --live readback.");

  const login = await fetch(new URL("/api/auth/login", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ passcode })
  });
  if (!login.ok) throw new Error(`Live website login failed: HTTP ${login.status}`);
  const setCookies = typeof login.headers.getSetCookie === "function"
    ? login.headers.getSetCookie()
    : [login.headers.get("set-cookie")].filter(Boolean);
  const cookie = setCookies.map((value) => value.split(";", 1)[0]).join("; ");
  if (!cookie) throw new Error("Live website login did not return a session cookie.");

  const searchUrl = new URL("/api/search", origin);
  searchUrl.searchParams.set("q", options.title.trim());
  const response = await fetch(searchUrl, { headers: { cookie } });
  if (!response.ok) throw new Error(`Live website search failed: HTTP ${response.status}`);
  return { payload: await response.json(), origin };
}

export function auditWebsiteCoverage(indexDocument, pageId, previewLimit = DEFAULT_PREVIEW_LIMIT) {
  const normalizedPageId = pageId.trim();
  const entries = indexDocument?.entries ?? {};
  const entry = entries[`notion-page-${normalizedPageId}`] ?? entries[`notion-page-${normalizedPageId.replaceAll("-", "")}`];
  if (!entry) return { status: "missing", pageId: normalizedPageId, fullVariantCount: 0, previewVariantCount: 0, variants: [] };

  const variants = Array.isArray(entry.result?.variants) ? entry.result.variants : [];
  const metadata = entry.result?.metadata ?? {};
  return {
    status: "ok",
    pageId: normalizedPageId,
    title: entry.result?.title ?? entry.title,
    fullVariantCount: variants.length,
    previewVariantCount: Math.min(variants.length, previewLimit),
    previewLimit,
    previewOnly: variants.length > previewLimit,
    posterPresent: Boolean(metadata.posterUrl || metadata.posters?.length || metadata.work?.media?.posters?.length),
    coreMetadataPresent: Boolean(metadata.work?.titles?.length && metadata.work?.release?.year),
    variants: variants.map((variant) => ({
      assetKey: variant.assetKey,
      label: variant.label,
      sourcePageId: variant.sourcePageId,
      mediaAssetPageId: variant.metadata?.mediaAssetPageId,
      mediaBlockId: variant.metadata?.mediaBlockId
    }))
  };
}

export function recordWebsiteSyncEvidence(db, report, pageId, verifiedAt = new Date().toISOString()) {
  if (report.status !== "ok" || normalizedPageId(report.pageId) !== normalizedPageId(pageId)) {
    throw new Error("Cannot record website evidence without an exact live page readback.");
  }
  const insert = db.prepare(`INSERT INTO events
    (entity_type, entity_id, event_type, payload_json, created_at)
    VALUES ('variant', ?, 'website_sync_verified', ?, ?)`);
  const recorded = [];
  const unmatched = [];
  for (const variant of report.variants) {
    const rows = db.prepare(`SELECT variants.id AS variant_id, works.notion_work_page_id,
        COALESCE(targets.episode_page_id, targets.spec_page_id) AS source_page_id,
        targets.media_asset_page_id, targets.media_block_id, targets.assets_verified_at
      FROM notion_targets AS targets
      JOIN variants ON variants.id=targets.variant_id AND variants.publication_state='sync_ready'
      JOIN works ON works.id=variants.work_id
      WHERE targets.work_page_id=? AND COALESCE(targets.episode_page_id, targets.spec_page_id)=?
        AND targets.media_asset_page_id=? AND targets.media_block_id=?`)
      .all(pageId, variant.sourcePageId, variant.mediaAssetPageId, variant.mediaBlockId);
    if (rows.length !== 1) {
      unmatched.push({ sourcePageId: variant.sourcePageId, mediaAssetPageId: variant.mediaAssetPageId, reason: "ledger_target_not_unique" });
      continue;
    }
    const target = rows[0];
    insert.run(target.variant_id, JSON.stringify({
      workPageId: target.notion_work_page_id,
      sourcePageId: variant.sourcePageId,
      mediaAssetPageId: variant.mediaAssetPageId,
      mediaBlockId: variant.mediaBlockId,
      verifiedAt
    }), verifiedAt);
    recorded.push(target.variant_id);
  }
  return { recordedVariantIds: recorded, unmatched };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let indexDocument;
  let indexDescription;
  if (options.live) {
    const live = await fetchLiveSearch(options);
    indexDocument = liveSearchIndexDocument(live.payload, options.pageId);
    indexDescription = `live:${live.origin}`;
  } else {
    indexDocument = JSON.parse(fs.readFileSync(options.index, "utf8"));
    indexDescription = options.index;
  }
  const report = {
    ...auditWebsiteCoverage(indexDocument, options.pageId, options.previewLimit),
    index: indexDescription
  };
  if (options.recordLedger) {
    const db = openLedger(options.db ?? DEFAULT_LEDGER);
    try {
      report.ledgerEvidence = recordWebsiteSyncEvidence(db, report, options.pageId);
    } finally {
      db.close();
    }
  }
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(`${report.title ?? report.pageId}: ${report.fullVariantCount} full variants; list preview ${report.previewVariantCount}/${report.previewLimit}.`);
  if (report.previewOnly) console.log("Diagnosis: list preview is capped; inspect the full detail/index result before treating this as sync loss.");
  for (const variant of report.variants) console.log(`- ${variant.label ?? "(unnamed)"} | ${variant.assetKey}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
