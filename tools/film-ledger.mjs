#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";
import { importScan } from "./lib/film-ledger-discovery.mjs";
import { createNotionTargetAdapter, reconcileDueTargets } from "./lib/film-ledger-notion.mjs";
import { installNotionDnsOverride } from "./lib/notion-network.mjs";
import { applyCorrectionsManifest, importProductionManifest, migrateOrganizerReport, migrateQueueState } from "./lib/film-ledger-migration.mjs";
import { discoverRecentProductionManifests } from "./lib/film-manifest-reconciliation.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");

function loadDotEnv() {
  if (!existsSync(".env")) return;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

function parse(argv) {
  const options = { db: DEFAULT_DB, json: false };
  const positionals = [];
  const values = new Set(["--db", "--scan", "--stage", "--limit", "--manifest-dir", "--variant", "--variant-id", "--work-page", "--spec-page", "--episode-page",
    "--output-path", "--output-size", "--probe-path", "--qc-artifact", "--failure-code", "--failure-detail",
    "--queue-state", "--organizer-report", "--corrections", "--production-manifest", "--year"]);
  const repeated = new Set(["--queue-state", "--organizer-report", "--variant-id"]);
  const booleans = new Set(["--json", "--pass", "--fail", "--dry-run", "--force-after-429"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (values.has(arg)) {
      if (argv[i + 1] == null || argv[i + 1].startsWith("--")) throw new Error(`${arg} requires a value`);
      const key = arg.slice(2).replaceAll("-", "_");
      const value = argv[++i];
      if (repeated.has(arg)) (options[key] ??= []).push(value);
      else options[key] = value;
    } else if (booleans.has(arg)) options[arg.slice(2)] = true;
    else if (arg.startsWith("--")) throw new Error(`unknown argument: ${arg}`);
    else positionals.push(arg);
  }
  if (positionals.length !== 1) throw new Error("exactly one command is required");
  return { command: positionals[0], options };
}

function requireOption(options, key, flag) {
  if (!options[key]) throw new Error(`${flag} is required`);
  return options[key];
}

function asId(value, flag = "--variant") {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new Error(`${flag} must be a positive integer`);
  return id;
}

function output(value, json, human) {
  if (json) process.stdout.write(`${JSON.stringify(value)}\n`);
  else process.stdout.write(`${human ?? JSON.stringify(value)}\n`);
}

function variantRecord(db, id) {
  const row = db.prepare(`SELECT variants.*, works.canonical_title, works.year, works.work_type
    FROM variants JOIN works ON works.id=variants.work_id WHERE variants.id=?`).get(id);
  if (!row) throw new Error(`variant not found: ${id}`);
  return row;
}

async function loadNotionAdapter() {
  const injectedModule = process.env.WWP_FILM_LEDGER_NOTION_ADAPTER_MODULE;
  if (injectedModule) {
    const module = await import(pathToFileURL(path.resolve(injectedModule)).href);
    if (typeof module.createAdapter !== "function") throw new Error("injected Notion adapter module must export createAdapter");
    return module.createAdapter();
  }
  const { Client } = await import("@notionhq/client");
  const auth = process.env.NOTION_API_KEY || process.env.NOTION_TOKEN;
  if (!auth) throw new Error("NOTION_API_KEY or NOTION_TOKEN is required");
  installNotionDnsOverride(process.env.NOTION_API_RESOLVE_IP);
  return createNotionTargetAdapter(new Client({ auth }));
}

async function main() {
  loadDotEnv();
  let parsed;
  try { parsed = parse(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 2; return; }
  const { command, options } = parsed;
  let db;
  try {
    db = openLedger(path.resolve(options.db));
    const repo = createLedgerRepository(db);
    if (command === "init") output({ database: path.resolve(options.db), initialized: true }, options.json, `initialized ${path.resolve(options.db)}`);
    else if (command === "discover") {
      const scan = JSON.parse(readFileSync(requireOption(options, "scan", "--scan"), "utf8"));
      const result = importScan(repo, scan);
      output(result, options.json, `inserted=${result.summary.inserted} changed=${result.summary.changed} missing=${result.summary.missing}`);
    } else if (command === "next") {
      const stage = requireOption(options, "stage", "--stage");
      if (!new Set(["production", "publication"]).has(stage)) throw new Error("--stage must be production|publication");
      const rows = stage === "production" ? repo.listProductionCandidates({ limit: options.limit }) : repo.listPublicationCandidates({ limit: options.limit });
      output(rows, options.json, `${rows.length} ${stage} candidate(s)`);
    } else if (command === "handoff") {
      const rows = repo.listManualUploadHandoffs({ limit: options.limit }).map((row) => ({
        variantId: row.variant_id, workTitle: row.work_title, year: row.year, specTitle: row.spec_title,
        outputPath: row.output_path, outputSizeBytes: row.output_size_bytes, workPageId: row.work_page_id,
        specPageId: row.spec_page_id, episodePageId: row.episode_page_id, expectedFilename: row.expected_filename,
        publicationState: row.publication_state
      }));
      output(rows, options.json, `${rows.length} manual upload handoff(s)`);
    } else if (command === "status") {
      const result = repo.getStatusSummary();
      result.queues = { production: repo.listProductionCandidates({ limit: 50 }).length, publication: repo.listPublicationCandidates({ limit: 20 }).length };
      output(result, options.json, `production=${result.queues.production} publication=${result.queues.publication} sync_ready=${result.totals.syncReady}`);
    } else if (command === "show") {
      const id = asId(requireOption(options, "variant", "--variant"));
      const variant = variantRecord(db, id);
      const target = db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(id) ?? null;
      const events = repo.getEvents({ entityType: "variant", entityId: id });
      output({ variant, target, events }, options.json);
    } else if (command === "record-qc") {
      const id = asId(requireOption(options, "variant", "--variant"));
      if (options.pass === options.fail) throw new Error("exactly one of --pass or --fail is required");
      const details = { outputPath: options.output_path, outputSizeBytes: options.output_size == null ? undefined : asId(options.output_size, "--output-size"),
        probePath: options.probe_path, qcArtifactPath: options.qc_artifact, failureCode: options.failure_code, failureDetail: options.failure_detail };
      const row = repo.transitionProduction(id, options.pass ? "qc_passed" : "qc_failed", details);
      output(row, options.json, `variant ${id}: ${row.production_state}`);
    } else if (command === "adopt-existing-variant") {
      const id = asId(requireOption(options, "variant", "--variant"));
      const existingTarget = db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(id);
      if (!existingTarget) throw new Error("existing variant requires a registered Notion target");
      const details = { outputPath: requireOption(options, "output_path", "--output-path"),
        outputSizeBytes: asId(requireOption(options, "output_size", "--output-size"), "--output-size"),
        probePath: requireOption(options, "probe_path", "--probe-path"), qcArtifactPath: options.qc_artifact };
      let variant = variantRecord(db, id);
      if (options.year !== undefined) repo.fillMissingWorkYear(variant.work_id, asId(options.year, "--year"));
      const nextState = { discovered: "evaluated", evaluated: "selected", selected: "encoding", encoding: "qc_passed" };
      while (variant.production_state !== "qc_passed") {
        const next = nextState[variant.production_state];
        if (!next) throw new Error(`cannot adopt variant from production state ${variant.production_state}`);
        variant = repo.transitionProduction(id, next, next === "qc_passed" ? details : {});
      }
      repo.registerNotionTarget(id, {
        workPageId: existingTarget.work_page_id,
        specPageId: existingTarget.spec_page_id,
        episodePageId: existingTarget.episode_page_id,
        expectedFilename: existingTarget.expected_filename,
        clearMediaBlock: true
      });
      if (variant.publication_state === "not_ready") repo.transitionPublication(id, "structure_pending", { adoptedExistingVariant: true });
      output({ status: "adopted", variant: variantRecord(db, id), target: db.prepare("SELECT * FROM notion_targets WHERE variant_id=?").get(id) }, options.json, `adopted variant ${id}`);
    } else if (command === "register-target") {
      const id = asId(requireOption(options, "variant", "--variant"));
      const variant = variantRecord(db, id);
      if (variant.production_state !== "qc_passed") throw new Error("Notion target requires qc_passed production state");
      const target = repo.registerNotionTarget(id, { workPageId: requireOption(options, "work_page", "--work-page"),
        specPageId: requireOption(options, "spec_page", "--spec-page"), episodePageId: options.episode_page });
      if (variant.publication_state === "not_ready") repo.transitionPublication(id, "structure_pending", { targetRegistered: true });
      output(target, options.json, `registered Notion target for variant ${id}`);
    } else if (command === "reconcile-notion") {
      const limit = options.limit === undefined ? 3 : Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 3) throw new Error("--limit must be between 1 and 3");
      const variantIds = (options.variant_id ?? []).map(Number);
      if (variantIds.some(id => !Number.isInteger(id) || id < 1) || variantIds.length > 3) throw new Error("--variant-id must contain at most three positive integers");
      const adapter = await loadNotionAdapter();
      const result = await reconcileDueTargets(repo, adapter, { limit, variantIds, forceAfter429: options["force-after-429"] === true });
      output(result, options.json, `checked=${result.checked} completed=${result.completed} pending=${result.pending} failed=${result.failed}`);
    } else if (command === "migrate-local-data") {
      const queueStates = options.queue_state ?? [];
      const organizerReports = options.organizer_report ?? [];
      if (queueStates.length === 0 && organizerReports.length === 0 && !options.corrections) {
        throw new Error("at least one --queue-state, --organizer-report, or --corrections is required");
      }
      const summary = { inserted: 0, unchanged: 0, changed: 0, missing: 0 };
      for (const file of queueStates) {
        const result = migrateQueueState(repo, JSON.parse(readFileSync(file, "utf8")));
        for (const key of Object.keys(summary)) summary[key] += result.summary[key];
      }
      let targetsRegistered = 0;
      for (const file of organizerReports) {
        targetsRegistered += migrateOrganizerReport(repo, JSON.parse(readFileSync(file, "utf8"))).registered;
      }
      const corrections = options.corrections
        ? applyCorrectionsManifest(repo, JSON.parse(readFileSync(options.corrections, "utf8"))).corrected
        : 0;
      const result = { queueStates: queueStates.length, organizerReports: organizerReports.length, corrections,
        sources: summary, targetsRegistered };
      output(result, options.json, `queue_states=${result.queueStates} targets=${targetsRegistered} corrections=${corrections}`);
    } else if (command === "import-production-manifest") {
      const manifest = JSON.parse(readFileSync(requireOption(options, "production_manifest", "--production-manifest"), "utf8"));
      const result = importProductionManifest(repo, manifest);
      output(result, options.json, `${result.status} variant=${result.variant.id}`);
    } else if (command === "import-production-manifests") {
      const directory = path.resolve(options.manifest_dir ?? ".local-data");
      const limit = options.limit === undefined ? 5 : Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("--limit must be between 1 and 20");
      const candidates = discoverRecentProductionManifests(directory, { limit });
      const results = options["dry-run"]
        ? candidates.map(candidate => ({ status: "would_import", fileName: candidate.fileName, manifest: candidate.manifest }))
        : candidates.map(candidate => ({ fileName: candidate.fileName, ...importProductionManifest(repo, candidate.manifest) }));
      output({ directory, scanned: candidates.length, results }, options.json, `${results.length} production manifest(s) processed`);
    } else throw new Error(`unknown command: ${command}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = /required|must be|exactly one|unknown command|requires qc_passed/.test(error.message) ? 2 : 1;
  } finally { db?.close(); }
}

await main();
