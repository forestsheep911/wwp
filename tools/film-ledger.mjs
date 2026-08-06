#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import nodeFetch from "node-fetch";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";
import { importScan } from "./lib/film-ledger-discovery.mjs";
import { createNotionTargetAdapter, reconcileDueTargets } from "./lib/film-ledger-notion.mjs";
import { installNotionDnsOverride } from "./lib/notion-network.mjs";
import { applyCorrectionsManifest, importProductionManifest, migrateOrganizerReport, migrateQueueState } from "./lib/film-ledger-migration.mjs";
import { discoverRecentProductionManifests } from "./lib/film-manifest-reconciliation.mjs";
import { collectCleanupCandidates, collectSourceCleanupCandidates } from "./film-cleanup-candidates.mjs";

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
  const values = new Set(["--db", "--scan", "--stage", "--limit", "--manifest-dir", "--variant", "--variant-id", "--canonical-variant", "--source-id", "--work-id", "--canonical-title", "--expected-current", "--work-type", "--priority-score", "--notion-work-page", "--work-page", "--season-page", "--spec-page", "--episode-page",
    "--probe-path", "--quality-state", "--subtitle-evidence", "--audio-evidence", "--color-risk", "--members",
    "--output-path", "--output-size", "--target-size", "--spec-key", "--output-spec", "--audio-variant", "--subtitle-variant", "--cut-variant", "--probe-path", "--qc-artifact", "--failure-code", "--failure-detail", "--expected-filename", "--media-block-id", "--compact-decision", "--compact-detail",
    "--queue-state", "--organizer-report", "--corrections", "--production-manifest", "--year", "--task", "--next-review-at",
    "--status", "--note", "--actor", "--input-root", "--enabled", "--output-root"]);
  const repeated = new Set(["--queue-state", "--organizer-report", "--variant-id"]);
  const booleans = new Set(["--json", "--pass", "--fail", "--dry-run", "--force-after-429", "--replace-expected-filename"]);
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

function listCleanupQueue(db, outputRoot = "E:\\video_made", limit) {
  const rows = [
    ...collectCleanupCandidates(db, outputRoot).map((row) => ({ candidate_type: "playable_output", ...row })),
    ...collectSourceCleanupCandidates(db).map((row) => ({ candidate_type: "source_input", ...row }))
  ];
  rows.sort((left, right) => Number(right.eligible) - Number(left.eligible)
    || String(left.title ?? "").localeCompare(String(right.title ?? ""))
    || String(left.path ?? "").localeCompare(String(right.path ?? "")));
  return limit === undefined ? rows : rows.slice(0, Number(limit));
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
  const localAddress = process.env.NOTION_API_LOCAL_ADDRESS;
  const clientOptions = { auth };
  if (localAddress) {
    clientOptions.fetch = nodeFetch;
    clientOptions.agent = new https.Agent({ keepAlive: true, localAddress });
  }
  return createNotionTargetAdapter(new Client(clientOptions));
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
    else if (command === "configure-input-root") {
      const root = requireOption(options, "input_root", "--input-root");
      if (!new Set(["true", "false"]).has(options.enabled)) throw new Error("--enabled must be true|false");
      output(repo.setInputRootEnabled(root, options.enabled === "true"), options.json);
    }
    else if (command === "discover") {
      const scan = JSON.parse(readFileSync(requireOption(options, "scan", "--scan"), "utf8"));
      const result = importScan(repo, scan);
      output(result, options.json, `inserted=${result.summary.inserted} changed=${result.summary.changed} missing=${result.summary.missing}`);
    } else if (command === "next") {
      const stage = requireOption(options, "stage", "--stage");
      if (!new Set(["production", "publication", "cleanup"]).has(stage)) throw new Error("--stage must be production|publication|cleanup");
      const rows = stage === "production" ? repo.listProductionQueue({ limit: options.limit }) : stage === "cleanup" ? listCleanupQueue(db, options.output_root, options.limit) : repo.listPublicationCandidates({ limit: options.limit });
      output(rows, options.json, `${rows.length} ${stage} candidate(s)`);
    } else if (command === "cycle") {
      const limit = options.limit === undefined ? 3 : Number(options.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("--limit must be between 1 and 20");
      const refreshedIntake = repo.refreshDueIntakeTasks({ limit });
      const refreshedMetadata = repo.refreshDueMetadataTasks({ limit });
      const workflowTasks = repo.getWorkflowTaskSummary();
      const result = {
        refreshedIntakeTasks: refreshedIntake.map(task => task.id),
        refreshedMetadataTasks: refreshedMetadata.map(task => task.id),
        status: repo.getStatusSummary(),
        lanes: {
          collaboration: repo.listWorkHandoffs({ limit: Math.min(limit, 3) }),
          intake: repo.listWorkflowTasks({ taskType: "intake", limit }),
          catalogMaintenance: repo.listWorkflowTasks({ taskType: "metadata_backfill", limit }),
          production: repo.listProductionQueue({ limit }),
          publication: repo.listPublicationCandidates({ limit }),
          cleanup: listCleanupQueue(db, options.output_root).filter((row) => row.eligible).slice(0, limit)
        },
        workflowTasks
      };
      output(result, options.json, `intake=${result.lanes.intake.length} catalog=${result.lanes.catalogMaintenance.length} production=${result.lanes.production.length} publication=${result.lanes.publication.length} cleanup=${result.lanes.cleanup.length}`);
    } else if (command === "queue") {
      const stage = requireOption(options, "stage", "--stage");
      if (stage === "intake") output(repo.listWorkflowTasks({ taskType: "intake", limit: options.limit }), options.json);
      else if (stage === "metadata" || stage === "catalog") output(repo.listWorkflowTasks({ taskType: "metadata_backfill", limit: options.limit }), options.json);
      else if (stage === "production") output(repo.listProductionQueue({ limit: options.limit }), options.json);
      else if (stage === "publication") output(repo.listPublicationCandidates({ limit: options.limit }), options.json);
      else if (stage === "cleanup") output(listCleanupQueue(db, options.output_root, options.limit), options.json);
      else if (stage === "handoff" || stage === "collaboration") output(repo.listWorkHandoffs({ limit: options.limit }), options.json);
      else throw new Error("--stage must be handoff|collaboration|intake|metadata|catalog|production|publication|cleanup");
    } else if (command === "task-status") {
      output(repo.getWorkflowTaskSummary(), options.json);
    } else if (command === "complete-task") {
      const id = asId(requireOption(options, "task", "--task"), "--task");
      output(repo.transitionWorkflowTask(id, "done", { reason: options.failure_detail }), options.json, `completed workflow task ${id}`);
    } else if (command === "schedule-metadata") {
      const workId = asId(requireOption(options, "work_id", "--work-id"), "--work-id");
      output(repo.requeueMetadataTask(workId, {
        reason: options.failure_detail ?? "Work-level metadata maintenance requested",
        nextRunAt: options.next_review_at,
        priorityScore: options.priority_score == null ? undefined : Number(options.priority_score)
      }), options.json, `scheduled metadata maintenance for work ${workId}`);
    } else if (command === "schedule-intake") {
      const sourceId = asId(requireOption(options, "source_id", "--source-id"), "--source-id");
      output(repo.requeueIntakeTask(sourceId, {
        reason: options.failure_detail ?? "Source needs intake review",
        priorityScore: options.priority_score == null ? undefined : Number(options.priority_score)
      }), options.json, `scheduled intake review for source ${sourceId}`);
    } else if (command === "set-handoff") {
      const workId = asId(requireOption(options, "work_id", "--work-id"), "--work-id");
      const actor = options.actor ?? "ai";
      const result = repo.recordWorkHandoff(workId, {
        status: requireOption(options, "status", "--status"),
        note: options.note,
        actor
      }, { enforceTransition: actor === "ai" });
      output(result, options.json, `work ${workId}: ${result.row.workflow_status}`);
    } else if (command === "start-production") {
      const id = asId(requireOption(options, "variant", "--variant"));
      const variant = variantRecord(db, id);
      if (variant.production_state !== "selected") throw new Error("production start requires selected state");
      output(repo.transitionProduction(id, "encoding", { failureDetail: options.failure_detail ?? "Encoding started" }), options.json, `variant ${id}: encoding`);
    } else if (command === "retry-production") {
      const id = asId(requireOption(options, "variant", "--variant"));
      const variant = variantRecord(db, id);
      if (!["qc_failed", "deferred"].includes(variant.production_state)) {
        throw new Error("production retry requires qc_failed or deferred state");
      }
      output(repo.transitionProduction(id, "selected", { failureDetail: options.failure_detail ?? "Production retry selected" }), options.json, `variant ${id}: selected`);
    } else if (command === "retire-variant") {
      const id = asId(requireOption(options, "variant", "--variant"));
      const variant = variantRecord(db, id);
      if (!["qc_passed", "deferred", "rejected"].includes(variant.production_state)) {
        throw new Error("variant retirement requires qc_passed, deferred, or rejected state");
      }
      if (variant.publication_state === "sync_ready") {
        throw new Error("variant retirement refuses to cancel an already sync-ready publication");
      }
      const failureDetail = requireOption(options, "failure_detail", "--failure-detail");
      if (variant.production_state !== "rejected") {
        repo.transitionProduction(id, "rejected", {
          failureCode: options.failure_code ?? "publication_cancelled",
          failureDetail
        });
      }
      const retired = repo.transitionPublication(id, "cancelled", {
        failureCode: options.failure_code ?? "publication_cancelled",
        failureDetail
      });
      output(retired, options.json, `variant ${id}: rejected and publication cancelled`);
    } else if (command === "route-intake") {
      const sourceId = asId(requireOption(options, "source_id", "--source-id"), "--source-id");
      const canonicalTitle = requireOption(options, "canonical_title", "--canonical-title");
      const year = asId(requireOption(options, "year", "--year"), "--year");
      const workType = options.work_type ?? "movie";
      if (!new Set(["movie", "series"]).has(workType)) throw new Error("--work-type must be movie|series");
      if (options.notion_work_page && /^(placeholder|todo|tbd|null|undefined)$/i.test(options.notion_work_page.trim())) {
        throw new Error("--notion-work-page must be an actual Notion page ID, not a placeholder");
      }
      const work = repo.ensureWork({ canonicalTitle, year, workType, notionWorkPageId: options.notion_work_page,
        priorityScore: options.priority_score == null ? undefined : Number(options.priority_score), scopeState: "catalogued" });
      const source = repo.bindSourceToWork(sourceId, work.id, { reason: options.failure_detail });
      output({ work, source }, options.json, `routed source ${sourceId} to work ${work.id}`);
    } else if (command === "rename-work") {
      const workId = asId(requireOption(options, "work_id", "--work-id"), "--work-id");
      const canonicalTitle = requireOption(options, "canonical_title", "--canonical-title");
      const work = repo.renameWork(workId, canonicalTitle, { expectedCurrent: options.expected_current });
      output(work, options.json, `renamed work ${workId}: ${work.canonical_title}`);
    } else if (command === "select-variant") {
      const workId = asId(requireOption(options, "work_id", "--work-id"), "--work-id");
      const sourceId = asId(requireOption(options, "source_id", "--source-id"), "--source-id");
      const source = db.prepare("SELECT work_id FROM sources WHERE id=?").get(sourceId);
      if (!source) throw new Error(`source not found: ${sourceId}`);
      if (source.work_id !== workId) throw new Error(`source ${sourceId} belongs to work ${source.work_id}, not work ${workId}`);
      const work = db.prepare("SELECT work_type FROM works WHERE id=?").get(workId);
      if (!work) throw new Error(`work not found: ${workId}`);
      const compactDecision = options.compact_decision;
      const compactDetail = options.compact_detail?.trim();
      if (work.work_type === "movie") {
        if (!new Set(["compact_exists", "compact_selected", "compact_deferred"]).has(compactDecision)) {
          throw new Error("movie select-variant requires --compact-decision compact_exists|compact_selected|compact_deferred");
        }
        if (!compactDetail) throw new Error("movie select-variant requires --compact-detail with the verified coverage or deferral reason");
      }
      const compactDecisionDetail = compactDecision
        ? `Compact coverage decision: ${compactDecision}; ${compactDetail ?? "no detail supplied"}`
        : "";
      const variant = repo.ensureVariant({
        workId,
        sourceId,
        specKey: requireOption(options, "spec_key", "--spec-key"),
        displayTitle: requireOption(options, "output_spec", "--output-spec"),
        outputPath: requireOption(options, "output_path", "--output-path"),
        targetSizeBytes: options.target_size == null ? undefined : asId(options.target_size, "--target-size"),
        audioVariant: options.audio_variant ?? "unknown",
        subtitleVariant: options.subtitle_variant ?? "unknown",
        cutVariant: options.cut_variant ?? "theatrical"
      });
      let selected = variant;
      if (selected.production_state === "discovered") selected = repo.transitionProduction(selected.id, "evaluated", {
        failureDetail: ["Source evidence accepted and variant selected for production", compactDecisionDetail].filter(Boolean).join(". ")
      });
      if (selected.production_state === "evaluated") selected = repo.transitionProduction(selected.id, "selected", {
        failureDetail: ["Production target and destination structure prepared", compactDecisionDetail].filter(Boolean).join(". ")
      });
      if (!["selected", "qc_passed"].includes(selected.production_state)) {
        throw new Error(`select-variant requires discovered, evaluated, selected, or qc_passed state; current=${selected.production_state}`);
      }
      output(selected, options.json, `selected variant ${selected.id}`);
    } else if (command === "merge-variant") {
      const duplicateId = asId(requireOption(options, "variant", "--variant"));
      const canonicalId = asId(requireOption(options, "canonical_variant", "--canonical-variant"), "--canonical-variant");
      const variant = repo.mergeDuplicateVariant(duplicateId, canonicalId);
      output(variant, options.json, `merged variant ${duplicateId} into ${canonicalId}`);
    } else if (command === "update-source") {
      const sourceId = asId(requireOption(options, "source_id", "--source-id"), "--source-id");
      const parseJsonOption = (key) => options[key] == null ? undefined : JSON.parse(options[key]);
      const source = repo.updateSourceEvidence(sourceId, {
        probePath: options.probe_path,
        qualityState: options.quality_state,
        subtitleEvidence: parseJsonOption("subtitle_evidence"),
        audioEvidence: parseJsonOption("audio_evidence"),
        colorRisk: options.color_risk,
        reason: options.failure_detail
      });
      output(source, options.json, `updated source ${sourceId} evidence`);
    } else if (command === "attach-variant-source") {
      const variantId = asId(requireOption(options, "variant", "--variant"));
      const sourceId = asId(requireOption(options, "source_id", "--source-id"), "--source-id");
      const variant = repo.attachVariantSource(variantId, sourceId, { reason: options.failure_detail });
      output(variant, options.json, `attached variant ${variantId} to source ${sourceId}`);
    } else if (command === "correct-variant-source") {
      const variantId = asId(requireOption(options, "variant", "--variant"));
      const sourceId = asId(requireOption(options, "source_id", "--source-id"), "--source-id");
      const variant = repo.correctVariantSource(variantId, sourceId, { reason: options.failure_detail });
      output(variant, options.json, `corrected variant ${variantId} source to ${sourceId}`);
    } else if (command === "split-source") {
      const sourceId = asId(requireOption(options, "source_id", "--source-id"), "--source-id");
      const membersPath = requireOption(options, "members", "--members");
      const members = JSON.parse(readFileSync(membersPath, "utf8"));
      const result = repo.splitSourceCollection(sourceId, members, { reason: options.failure_detail });
      output(result, options.json, `split source ${sourceId} into ${result.members.length} member source(s)`);
    } else if (command === "defer-task") {
      const id = asId(requireOption(options, "task", "--task"), "--task");
      output(repo.transitionWorkflowTask(id, "deferred", { reason: options.failure_detail, nextRunAt: options.next_review_at }), options.json, `deferred workflow task ${id}`);
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
      const workflowTasks = repo.getWorkflowTaskSummary();
      result.workflowTasks = workflowTasks;
      result.queues = {
        collaboration: repo.listWorkHandoffs({ limit: 3 }).length,
        intake: workflowTasks["intake:pending"] ?? 0,
        metadata: workflowTasks["metadata_backfill:pending"] ?? 0,
        production: repo.listProductionQueue({ limit: 50 }).length,
        publication: repo.listPublicationCandidates({ limit: 20 }).length,
        cleanup: listCleanupQueue(db, options.output_root).filter((row) => row.eligible).length
      };
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
    } else if (command === "refresh-production-evidence") {
      const id = asId(requireOption(options, "variant", "--variant"));
      const row = repo.refreshProductionEvidence(id, {
        outputPath: options.output_path,
        outputSizeBytes: options.output_size == null ? undefined : asId(options.output_size, "--output-size"),
        probePath: options.probe_path,
        qcArtifactPath: options.qc_artifact
      });
      output(row, options.json, `refreshed production evidence for variant ${id}`);
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
      if (!["selected", "encoding", "qc_passed"].includes(variant.production_state)) {
        throw new Error("Notion target requires selected, encoding, or qc_passed production state");
      }
      const target = repo.registerNotionTarget(id, { workPageId: requireOption(options, "work_page", "--work-page"),
        seasonPageId: options.season_page,
        specPageId: requireOption(options, "spec_page", "--spec-page"), episodePageId: options.episode_page,
        expectedFilename: options.expected_filename, mediaBlockId: options.media_block_id,
        replaceExpectedFilename: options.replace_expected_filename === true });
      if (variant.publication_state === "not_ready") repo.transitionPublication(id, "structure_pending", { targetRegistered: true });
      output(target, options.json, `registered Notion target for variant ${id}`);
    } else if (command === "reset-notion-target") {
      const id = asId(requireOption(options, "variant", "--variant"));
      const target = repo.resetNotionTargetEvidence(id, { reason: options.failure_detail });
      output(target, options.json, `reset stale Notion evidence for variant ${id}`);
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
