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
  const options = { db: DEFAULT_DB, outputRoot: DEFAULT_OUTPUT_ROOT, episodeOffset: 0, apply: false };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const value = () => args[++index];
    if (option === "--work-page-id") options.workPageId = value();
    else if (option === "--work-title") options.workTitle = value();
    else if (option === "--year") options.year = Number(value());
    else if (option === "--work-id") options.workId = Number(value());
    else if (option === "--episode-offset") options.episodeOffset = Number(value());
    else if (option === "--db") options.db = path.resolve(value());
    else if (option === "--output-root") options.outputRoot = path.resolve(value());
    else if (option === "--apply") options.apply = true;
    else throw new Error(`Unknown option: ${option}`);
  }
  if (!options.workPageId || !options.workTitle || !Number.isInteger(options.year)) {
    throw new Error("--work-page-id, --work-title, and --year are required");
  }
  if (options.workId != null && (!Number.isInteger(options.workId) || options.workId < 1)) {
    throw new Error("--work-id must be a positive integer");
  }
  if (!Number.isInteger(options.episodeOffset)) throw new Error("--episode-offset must be an integer");
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
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return original(hostname, options, callback);
    if (typeof options === "function") return options(null, env.NOTION_API_RESOLVE_IP, 4);
    if (options?.all) return callback(null, [{ address: env.NOTION_API_RESOLVE_IP, family: 4 }]);
    return callback(null, env.NOTION_API_RESOLVE_IP, 4);
  };
}

function text(property) {
  return (property?.rich_text ?? property?.title ?? []).map(item => item.plain_text ?? "").join("").trim();
}

async function listChildren(notion, pageId) {
  const results = [];
  let cursor;
  do {
    const response = await notion.blocks.children.list({ block_id: pageId, page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    results.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return results;
}

async function mediaAssetsForWork(notion, dataSourceId, workPageId) {
  const rows = [];
  let cursor;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: 100,
      filter: { property: "Work", relation: { contains: workPageId } },
      ...(cursor ? { start_cursor: cursor } : {})
    });
    rows.push(...response.results);
    cursor = response.has_more ? response.next_cursor : undefined;
  } while (cursor);
  return rows;
}

export async function episodeSpecMap(notion, workPageId) {
  const mapping = new Map();
  const specs = [];

  async function collectSpecPages(parentId) {
    const children = await listChildren(notion, parentId);
    for (const child of children) {
      if (child.type === "child_page") {
        specs.push(child);
      } else if (child.has_children) {
        // Legacy work pages can place specs inside a toggle or callout wrapper.
        await collectSpecPages(child.id);
      }
    }
  }

  await collectSpecPages(workPageId);
  for (const spec of specs) {
    const episodes = await listChildren(notion, spec.id);
    for (const episode of episodes.filter(block => (
      block.type === "child_page" && /^Episode\s+\d+/iu.test(block.child_page?.title ?? "")
    ))) {
      mapping.set(episode.id, spec.id);
    }
  }
  return mapping;
}

function localFiles(outputRoot) {
  const byName = new Map();
  const legacyEpisodes = new Map();
  for (const file of fs.readdirSync(outputRoot, { withFileTypes: true })) {
    if (file.isFile()) {
      const fullPath = path.join(outputRoot, file.name);
      const details = { path: fullPath, bytes: fs.statSync(fullPath).size };
      byName.set(file.name.toLocaleLowerCase(), details);
      const legacyEpisode = file.name.match(/^Hokuto\.no\.Ken\.E(\d{3})\.960p\.h265\.cht\.low\.mp4$/iu);
      if (legacyEpisode) legacyEpisodes.set(Number(legacyEpisode[1]), details);
    }
  }
  return { byName, legacyEpisodes };
}

function candidate(asset, episodeToSpec, files, episodeOffset) {
  const properties = asset.properties ?? {};
  const episodePageId = text(properties["Source Page ID"]);
  const mediaBlockId = text(properties["Media Block ID"]);
  const fileName = text(properties["Original File Name"]);
  const episodeNumber = properties["Episode Number"]?.number;
  const playbackVerified = properties["Playback Verified"]?.checkbox === true;
  const hidden = properties["Hide from Website"]?.checkbox === true;
  const availability = properties["Media Availability"]?.select?.name;
  const specPageId = episodeToSpec.get(episodePageId);
  const local = files.byName.get(fileName.toLocaleLowerCase())
    ?? (episodeOffset === 0 ? null : files.legacyEpisodes.get(episodeNumber + episodeOffset));
  const issues = [];
  if (!Number.isInteger(episodeNumber) || episodeNumber < 1) issues.push("episode_number_missing");
  if (!episodePageId || !specPageId) issues.push("episode_page_unmapped");
  if (!mediaBlockId) issues.push("media_block_missing");
  if (!fileName || !local) issues.push("local_file_missing");
  if (!playbackVerified || hidden || availability !== "playable") issues.push("asset_not_released");
  return {
    assetPageId: asset.id,
    episodePageId,
    specPageId,
    episodeNumber,
    mediaBlockId,
    fileName,
    outputPath: local?.path ?? null,
    outputBytes: local?.bytes ?? null,
    displayTitle: text(properties["Display Label"]) || `Episode ${String(episodeNumber).padStart(2, "0")}`,
    audioVariant: (properties["Audio Languages"]?.multi_select ?? []).map(item => item.name).join(",") || "unknown",
    subtitleVariant: (properties["Subtitle Languages"]?.multi_select ?? []).map(item => item.name).join(",") || "unknown",
    issues
  };
}

function completeVariant(repo, variantId, evidence) {
  let variant = repo.findVariantByOutputPath(evidence.outputPath) ?? null;
  if (!variant || variant.id !== variantId) {
    variant = repo.refreshProductionEvidence(variantId, { outputPath: evidence.outputPath, outputSizeBytes: evidence.outputBytes });
  }
  const productionStates = { discovered: "evaluated", evaluated: "selected", selected: "encoding", encoding: "qc_passed" };
  while (variant.production_state !== "qc_passed") {
    variant = repo.transitionProduction(variant.id, productionStates[variant.production_state], variant.production_state === "encoding"
      ? { outputPath: evidence.outputPath, outputSizeBytes: evidence.outputBytes }
      : {});
  }
  repo.registerNotionTarget(variant.id, {
    workPageId: evidence.workPageId,
    specPageId: evidence.specPageId,
    episodePageId: evidence.episodePageId,
    expectedFilename: evidence.fileName,
    mediaBlockId: evidence.mediaBlockId,
    mediaAssetPageId: evidence.assetPageId,
    structureVerifiedAt: evidence.at,
    mediaVerifiedAt: evidence.at,
    assetsVerifiedAt: evidence.at,
    replaceExpectedFilename: true
  });
  repo.recordNotionInspection(variant.id, {
    structureVerified: true,
    mediaVerified: true,
    assetsVerified: true,
    mediaBlockId: evidence.mediaBlockId,
    mediaAssetPageId: evidence.assetPageId
  }, evidence.at, null);
  const publicationStates = { not_ready: "structure_pending", structure_pending: "upload_pending", upload_pending: "upload_seen", upload_seen: "assets_pending", assets_pending: "verification_pending", verification_pending: "sync_ready" };
  variant = repo.findVariantByOutputPath(evidence.outputPath);
  while (variant.publication_state !== "sync_ready") {
    variant = repo.transitionPublication(variant.id, publicationStates[variant.publication_state], { legacyBackfill: true });
  }
  return variant;
}

async function main() {
  const options = optionsFromArgs();
  const env = envValues();
  installDnsOverride(env);
  const token = env.NOTION_READ_ONLY_TOKEN || env.NOTION_TOKEN || env.NOTION_WRITE_TOKEN;
  if (!token || !env.NOTION_MEDIA_ASSETS_DATA_SOURCE_ID) throw new Error("Notion token and NOTION_MEDIA_ASSETS_DATA_SOURCE_ID are required");
  const notion = new Client({ auth: token, timeoutMs: 120000 });
  const [episodeToSpec, assets] = await Promise.all([
    episodeSpecMap(notion, options.workPageId),
    mediaAssetsForWork(notion, env.NOTION_MEDIA_ASSETS_DATA_SOURCE_ID, options.workPageId)
  ]);
  const files = localFiles(options.outputRoot);
  const candidates = assets.map(asset => candidate(asset, episodeToSpec, files, options.episodeOffset));
  const accepted = candidates.filter(item => item.issues.length === 0).sort((a, b) => a.episodeNumber - b.episodeNumber);
  const rejected = candidates.filter(item => item.issues.length > 0);
  const report = { workPageId: options.workPageId, assets: assets.length, episodePages: episodeToSpec.size, episodeOffset: options.episodeOffset, accepted: accepted.length, rejected, apply: options.apply };
  if (!options.apply) return console.log(JSON.stringify(report, null, 2));

  const db = openLedger(options.db);
  try {
    const repo = createLedgerRepository(db);
    const existing = options.workId == null ? null : db.prepare("SELECT * FROM works WHERE id=?").get(options.workId);
    if (options.workId != null && (!existing || existing.notion_work_page_id !== options.workPageId)) throw new Error("--work-id does not match --work-page-id");
    const work = existing ?? repo.ensureWork({ canonicalTitle: options.workTitle, year: options.year, workType: "series", notionWorkPageId: options.workPageId, scopeState: "catalogued" });
    const at = new Date().toISOString();
    let created = 0;
    let updated = 0;
    for (const item of accepted) {
      const existingVariant = repo.findVariantByNotionTarget({ workPageId: options.workPageId, specPageId: item.specPageId, episodePageId: item.episodePageId });
      const variant = existingVariant ?? repo.ensureVariant({
        workId: work.id,
        specKey: `legacy-series-${options.workPageId}-${item.specPageId}-${item.episodeNumber}`,
        displayTitle: item.displayTitle,
        audioVariant: item.audioVariant,
        subtitleVariant: item.subtitleVariant,
        outputPath: item.outputPath,
        targetSizeBytes: item.outputBytes
      });
      completeVariant(repo, variant.id, { ...item, workPageId: options.workPageId, at });
      if (existingVariant) updated += 1;
      else created += 1;
    }
    repo.recordWorkHandoff(work.id, { status: "已完成", note: `Legacy series ledger backfill: ${accepted.length} released episode assets mirrored from Notion.` }, { enforceTransition: false });
    console.log(JSON.stringify({ ...report, workId: work.id, created, updated }, null, 2));
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
