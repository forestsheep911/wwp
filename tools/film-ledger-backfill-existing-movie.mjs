#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");
const DEFAULT_OUTPUT_ROOT = "E:\\video_made";

function optionsFromArgs(args = process.argv.slice(2)) {
  const options = { db: DEFAULT_DB, outputRoot: DEFAULT_OUTPUT_ROOT, apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = () => args[++index];
    if (option === "--work-page-id") options.workPageId = value();
    else if (option === "--work-id") options.workId = Number(value());
    else if (option === "--db") options.db = path.resolve(value());
    else if (option === "--output-root") options.outputRoot = path.resolve(value());
    else if (option === "--apply") options.apply = true;
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!options.workPageId || !Number.isInteger(options.workId) || options.workId < 1) {
    throw new Error("--work-page-id and positive --work-id are required");
  }
  return options;
}

function envValues() {
  const env = { ...process.env };
  if (!fs.existsSync(".env")) return env;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

function installDnsOverride(env) {
  if (!env.NOTION_API_RESOLVE_IP) return;
  const original = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => hostname !== "api.notion.com"
    ? original(hostname, options, callback)
    : typeof options === "function" ? options(null, env.NOTION_API_RESOLVE_IP, 4)
    : options?.all ? callback(null, [{ address: env.NOTION_API_RESOLVE_IP, family: 4 }])
    : callback(null, env.NOTION_API_RESOLVE_IP, 4);
}

function text(property) { return (property?.rich_text ?? property?.title ?? []).map((item) => item.plain_text ?? "").join("").trim(); }
function relationIds(property) { return property?.relation?.map((item) => item.id) ?? []; }

async function listChildren(notion, pageId) {
  const results = []; let cursor;
  do { const response = await notion.blocks.children.list({ block_id: pageId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }); results.push(...response.results); cursor = response.has_more ? response.next_cursor : undefined; } while (cursor);
  return results;
}

async function specPages(notion, workPageId) {
  const result = new Set();
  async function visit(parentId) {
    for (const child of await listChildren(notion, parentId)) {
      if (child.type === "child_page") result.add(child.id);
      else if (child.has_children) await visit(child.id);
    }
  }
  await visit(workPageId); return result;
}

async function mediaAssetsForWork(notion, dataSourceId, workPageId) {
  const rows = []; let cursor;
  do { const response = await notion.dataSources.query({ data_source_id: dataSourceId, page_size: 100, filter: { property: "Work", relation: { contains: workPageId } }, ...(cursor ? { start_cursor: cursor } : {}) }); rows.push(...response.results); cursor = response.has_more ? response.next_cursor : undefined; } while (cursor);
  return rows;
}

export function movieCandidate(asset, specPageIds, outputRoot) {
  const properties = asset.properties ?? {};
  const specPageId = text(properties["Source Page ID"]);
  const fileName = text(properties["Original File Name"]);
  const outputPath = fileName ? path.join(outputRoot, fileName) : "";
  const issues = [];
  if (!specPageId || !specPageIds.has(specPageId)) issues.push("spec_page_unmapped");
  if (!text(properties["Media Block ID"])) issues.push("media_block_missing");
  if (!fileName || !fs.existsSync(outputPath)) issues.push("local_file_missing");
  if (properties["Playback Verified"]?.checkbox !== true || properties["Hide from Website"]?.checkbox === true || properties["Media Availability"]?.select?.name !== "playable" || properties["Asset Type"]?.select?.name !== "playable_video") issues.push("asset_not_released");
  return { assetPageId: asset.id, specPageId, mediaBlockId: text(properties["Media Block ID"]), fileName, outputPath: outputPath || null, outputBytes: outputPath && fs.existsSync(outputPath) ? fs.statSync(outputPath).size : null, displayTitle: text(properties["Display Label"]) || fileName, audioVariant: (properties["Audio Languages"]?.multi_select ?? []).map((item) => item.name).join(",") || "unknown", subtitleVariant: (properties["Subtitle Languages"]?.multi_select ?? []).map((item) => item.name).join(",") || "none", issues };
}

function completeVariant(repo, variantId, item, workPageId, at) {
  let variant = repo.refreshProductionEvidence(variantId, { outputPath: item.outputPath, outputSizeBytes: item.outputBytes });
  const production = { discovered: "evaluated", evaluated: "selected", selected: "encoding", encoding: "qc_passed" };
  while (variant.production_state !== "qc_passed") variant = repo.transitionProduction(variant.id, production[variant.production_state], variant.production_state === "encoding" ? { outputPath: item.outputPath, outputSizeBytes: item.outputBytes } : {});
  repo.registerNotionTarget(variant.id, { workPageId, specPageId: item.specPageId, expectedFilename: item.fileName, mediaBlockId: item.mediaBlockId, mediaAssetPageId: item.assetPageId, structureVerifiedAt: at, mediaVerifiedAt: at, assetsVerifiedAt: at, replaceExpectedFilename: true });
  repo.recordNotionInspection(variant.id, { structureVerified: true, mediaVerified: true, assetsVerified: true, mediaBlockId: item.mediaBlockId, mediaAssetPageId: item.assetPageId }, at, null);
  const publication = { not_ready: "structure_pending", structure_pending: "upload_pending", upload_pending: "upload_seen", upload_seen: "assets_pending", assets_pending: "verification_pending", verification_pending: "sync_ready" };
  while (variant.publication_state !== "sync_ready") variant = repo.transitionPublication(variant.id, publication[variant.publication_state], { existingMovieBackfill: true });
  return variant;
}

async function main() {
  const options = optionsFromArgs(); const env = envValues(); installDnsOverride(env);
  const token = env.NOTION_READ_ONLY_TOKEN || env.NOTION_TOKEN || env.NOTION_WRITE_TOKEN;
  if (!token || !env.NOTION_MEDIA_ASSETS_DATA_SOURCE_ID) throw new Error("Notion token and NOTION_MEDIA_ASSETS_DATA_SOURCE_ID are required");
  const notion = new Client({ auth: token, timeoutMs: 120000 });
  const [pages, assets] = await Promise.all([specPages(notion, options.workPageId), mediaAssetsForWork(notion, env.NOTION_MEDIA_ASSETS_DATA_SOURCE_ID, options.workPageId)]);
  const candidates = assets.map((asset) => movieCandidate(asset, pages, options.outputRoot));
  const accepted = candidates.filter((item) => item.issues.length === 0); const rejected = candidates.filter((item) => item.issues.length > 0);
  const report = { workPageId: options.workPageId, assets: assets.length, specPages: pages.size, accepted: accepted.length, rejected, apply: options.apply };
  if (!options.apply) return console.log(JSON.stringify(report, null, 2));
  const db = openLedger(options.db);
  try {
    const repo = createLedgerRepository(db); const work = db.prepare("SELECT * FROM works WHERE id=?").get(options.workId);
    if (!work || work.notion_work_page_id !== options.workPageId || work.work_type !== "movie") throw new Error("--work-id must be the matching movie work");
    const at = new Date().toISOString(); let created = 0; let updated = 0;
    for (const item of accepted) {
      const existing = repo.findVariantByNotionTarget({ workPageId: options.workPageId, specPageId: item.specPageId, episodePageId: null });
      const variant = existing ?? repo.ensureVariant({ workId: work.id, specKey: `existing-movie-${item.assetPageId}`, displayTitle: item.displayTitle, audioVariant: item.audioVariant, subtitleVariant: item.subtitleVariant, outputPath: item.outputPath, targetSizeBytes: item.outputBytes });
      completeVariant(repo, variant.id, item, options.workPageId, at); if (existing) updated += 1; else created += 1;
    }
    console.log(JSON.stringify({ ...report, workId: work.id, created, updated }, null, 2));
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
