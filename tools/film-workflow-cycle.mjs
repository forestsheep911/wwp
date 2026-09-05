#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { acquireProductionLock } from "./lib/wwp-production-lock.mjs";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { buildProductionModePlan, normalizeProductionMode, PRODUCTION_MODES } from "./lib/wwp-production-mode.mjs";
import {
  buildEnrichmentCampaignReport,
  enqueueEnrichmentWorks,
  readEnrichmentCampaign,
  writeEnrichmentCampaign
} from "./lib/work-enrichment-campaign.mjs";

function parseArgs(argv) {
  const options = {
    limit: 3,
    maxSamples: 3,
    json: false,
    statePath: ".local-data/film-workflow-cycle-state.json",
    // A cycle is a bounded orchestration round, not a file-system poll.
    // Local discovery still runs every invocation; unchanged rounds should
    // not repeatedly re-open the Notion handoff within the same short window.
    // Full Notion/ledger rounds are expensive. A user-reported batch uses
    // --force and bypasses this interval immediately.
    minFullCycleSec: 3600,
    force: false,
    applyCleanup: false,
    enrichmentStatePath: ".local-data/work-enrichment-campaign.json",
    mode: PRODUCTION_MODES.FILM_AND_CURRENT_ENRICHMENT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg === "--max-samples") options.maxSamples = Number(argv[++index]);
    else if (arg === "--state") options.statePath = argv[++index];
    else if (arg === "--min-full-cycle-sec") options.minFullCycleSec = Number(argv[++index]);
    else if (arg === "--force") options.force = true;
    else if (arg === "--apply-cleanup") options.applyCleanup = true;
    else if (arg === "--enrichment-state") options.enrichmentStatePath = argv[++index];
    else if (arg === "--mode") options.mode = normalizeProductionMode(argv[++index]);
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 20) {
    throw new Error("--limit must be an integer between 1 and 20");
  }
  if (!Number.isInteger(options.maxSamples) || options.maxSamples < 1 || options.maxSamples > 20) {
    throw new Error("--max-samples must be an integer between 1 and 20");
  }
  if (!Number.isFinite(options.minFullCycleSec) || options.minFullCycleSec < 0) {
    throw new Error("--min-full-cycle-sec must be zero or a positive number");
  }
  return options;
}

function currentWorkIds(cycle) {
  const lanes = cycle.lanes ?? {};
  const rows = [lanes.intake, lanes.catalogMaintenance, lanes.production, lanes.productionCoverage, lanes.publication]
    .flatMap((lane) => lane ?? []);
  return rows.map((row) => row.work_id ?? row.workId ?? row.ww_work_id ?? row.wwWorkId).filter(Boolean);
}

function currentWorkRefs(cycle, databasePath = ".local-data/wwp-film-workflow.sqlite") {
  const lanes = cycle.lanes ?? {};
  const rows = [lanes.intake, lanes.catalogMaintenance, lanes.production, lanes.productionCoverage, lanes.publication]
    .flatMap((lane) => lane ?? []);
  const refs = rows.map((row) => ({
    ledgerWorkId: row.work_id ?? row.workId,
    externalWorkId: row.ww_work_id ?? row.wwWorkId,
    pageId: row.notion_work_page_id ?? row.work_page_id ?? row.workPageId,
    title: row.canonical_title ?? row.title
  })).filter((row) => row.ledgerWorkId || row.externalWorkId || row.pageId);
  const unique = [...new Map(refs.map((row) => [row.externalWorkId ? `ww:${row.externalWorkId}` : row.pageId ? `notion:${row.pageId}` : `ledger:${row.ledgerWorkId}`, row])).values()];
  const unresolvedIds = unique.filter((row) => row.ledgerWorkId && (!row.pageId || !row.title)).map((row) => Number(row.ledgerWorkId));
  if (unresolvedIds.length === 0) return unique;
  const db = openLedger(databasePath);
  try {
    const placeholders = unresolvedIds.map(() => "?").join(",");
    const ledgerWorks = db.prepare(`SELECT id, canonical_title, notion_work_page_id FROM works WHERE id IN (${placeholders})`)
      .all(...unresolvedIds);
    const byId = new Map(ledgerWorks.map((work) => [Number(work.id), work]));
    return unique.map((row) => {
      const work = byId.get(Number(row.ledgerWorkId));
      return {
        ...row,
        pageId: row.pageId ?? work?.notion_work_page_id ?? null,
        title: row.title ?? work?.canonical_title ?? null
      };
    });
  } finally {
    db.close();
  }
}

function loadEnrichmentCampaign(statePath, { limit, inputs = [], source = "saved_campaign" } = {}) {
  let state = readEnrichmentCampaign(statePath);
  let enqueue = { added: [], existing: [] };
  if (inputs.length > 0) {
    enqueue = enqueueEnrichmentWorks(state, inputs, { source });
    state = enqueue.state;
    writeEnrichmentCampaign(statePath, state);
  }
  const report = buildEnrichmentCampaignReport(state, { limit });
  report.statePath = path.resolve(statePath);
  report.enqueued = { added: enqueue.added, existing: enqueue.existing };
  return report;
}

function run(args) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `command failed: ${args.join(" ")}`).trim());
  }
  return JSON.parse(result.stdout);
}

function runOptional(args) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.status !== 0) {
    return { status: "error", error: (result.stderr || result.stdout || `command failed: ${args.join(" ")}`).trim() };
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    return { status: "error", error: `invalid JSON from ${args[0]}: ${error.message}` };
  }
}

function applyCleanupCandidates(root, candidates) {
  const reports = [];
  for (const candidate of candidates) {
    const args = [path.join(root, "film-cleanup-candidates.mjs"), "--candidate-type", candidate.candidate_type];
    if (candidate.candidate_type === "playable_output" && candidate.variantId) {
      args.push("--variant-id", String(candidate.variantId));
    } else if (candidate.candidate_type === "source_input" && candidate.sourceId) {
      args.push("--source-id", String(candidate.sourceId));
    } else {
      reports.push({ status: "error", error: "cleanup candidate is missing its exact ledger identifier", candidate });
      continue;
    }
    reports.push(runOptional([...args, "--apply", "--json"]));
  }
  return {
    status: reports.some((report) => report.status === "error") ? "partial_error" : "ok",
    movePerformed: reports.length > 0,
    moved: reports.flatMap((report) => report.moved ?? []),
    moveFailures: reports.flatMap((report) => report.moveFailures ?? []),
    moveSkipped: reports.flatMap((report) => report.moveSkipped ?? []),
    reports
  };
}

function readState(filePath) {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return {};
  }
}

function writeState(filePath, state) {
  mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function scanChanged(scan) {
  return (scan.roots ?? []).some((root) =>
    (root.summary?.added ?? 0) > 0
    || (root.summary?.changed ?? 0) > 0
    || (root.summary?.removed ?? 0) > 0
  );
}

function buildSummary(scan, cycle) {
  const roots = scan.roots ?? [];
  const laneRows = cycle.lanes ?? {};
  const newlyDiscoveredSources = roots.reduce((total, root) => total + (root.summary?.added ?? 0), 0);
  const changedSources = roots.reduce((total, root) => total + (root.summary?.changed ?? 0), 0);
  const intakeCandidates = (laneRows.intake ?? []).length;
  const metadataCandidates = (laneRows.catalogMaintenance ?? []).length;
  const productionCandidates = (laneRows.production ?? []).length;
  const seriesCoverageGaps = (laneRows.productionCoverage ?? []).length;
  const publicationPending = (laneRows.publication ?? []).length;
  const cleanupCandidates = (laneRows.cleanup ?? []).length;
  const sourceDisposition = cycle.sourceDisposition ?? {};
  const residualSources = sourceDisposition.residualSourceCount ?? 0;
  const humanConfirmations = sourceDisposition.needsHumanConfirmation ?? 0;
  const cleanupMoveFailures = sourceDisposition.cleanupMoveFailed ?? 0;
  const scheduledReviews = sourceDisposition.scheduledReview ?? 0;
  const unselectedSources = (laneRows.production ?? []).filter((row) => row.candidate_type === "source_selection").length;
  return {
    rootCount: roots.length,
    scannedEntries: roots.reduce((total, root) => total + (root.entryCount ?? 0), 0),
    newlyDiscoveredSources,
    changedSources,
    removedSources: roots.reduce((total, root) => total + (root.summary?.removed ?? 0), 0),
    intakeCandidates,
    metadataCandidates,
    productionCandidates,
    seriesCoverageGaps,
    publicationPending,
    cleanupCandidates,
    residualSources,
    humanConfirmations,
    cleanupMoveFailures,
    scheduledReviews,
    sourceDisposition: sourceDisposition.byDisposition ?? {},
    registeredSourcesNeedingProductionReview: unselectedSources,
    discoveryMessage: newlyDiscoveredSources || changedSources
      ? `本轮发现 ${newlyDiscoveredSources} 个新输入、${changedSources} 个变化输入`
      : `本轮未发现文件新增或变化（这不等于无片）；输入队列仍登记 ${roots.reduce((total, root) => total + (root.entryCount ?? 0), 0)} 条，已登记条目的制作、发布和资料补齐继续按各自队列推进`,
    workMessage: [
      intakeCandidates && `待识别 ${intakeCandidates}`,
      metadataCandidates && `待补资料 ${metadataCandidates}`,
      productionCandidates && `待制作 ${productionCandidates}`,
      seriesCoverageGaps && `剧集规格覆盖缺口 ${seriesCoverageGaps}`,
      publicationPending && `待发布闭环 ${publicationPending}`,
      cleanupCandidates && `待清理 ${cleanupCandidates}`
    ].filter(Boolean).join("；") || (residualSources ? `当前无到期执行项，但输入目录仍有 ${residualSources} 个残留条目` : "当前没有待推进工作"),
    residualMessage: residualSources
      ? `输入目录残留 ${residualSources}：当前可推进 ${sourceDisposition.actionableNow ?? 0}，待人工确认 ${humanConfirmations}，移动失败 ${cleanupMoveFailures}，未到复核时间 ${scheduledReviews}。每项原因见 cycle.lanes.sourceFollowup。`
      : "输入目录没有仍受流程管理的残留源条目",
    hasWorkBeyondNewDiscovery: [
      laneRows.intake,
      laneRows.catalogMaintenance,
      laneRows.production,
      laneRows.productionCoverage,
      laneRows.publication,
      laneRows.cleanup
    ].some((lane) => (lane ?? []).length > 0) || (sourceDisposition.actionableNow ?? 0) > 0 || humanConfirmations > 0
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const lock = acquireProductionLock({ owner: "film-workflow-cycle", mode: options.mode });
  try {
    return runMain(options, lock);
  } finally {
    lock.release();
  }
}

function runMain(options, lock) {
  const root = path.resolve("tools");
  if (options.mode === PRODUCTION_MODES.PEOPLE_ONLY || options.mode === PRODUCTION_MODES.ENRICHMENT_ONLY) {
    const enrichmentOnly = options.mode === PRODUCTION_MODES.ENRICHMENT_ONLY;
    const enrichmentCampaign = enrichmentOnly
      ? loadEnrichmentCampaign(options.enrichmentStatePath, { limit: options.limit })
      : null;
    const campaignWorkIds = enrichmentCampaign
      ? [...enrichmentCampaign.due, ...enrichmentCampaign.waitingForHuman, ...enrichmentCampaign.blocked, ...enrichmentCampaign.scheduledReviews]
          .map((work) => work.externalWorkId ?? work.pageId ?? work.ledgerWorkId)
          .filter(Boolean)
      : [];
    const result = {
      startedAt: new Date().toISOString(),
      orchestration: {
        ...buildProductionModePlan(options.mode, campaignWorkIds),
        lockPath: lock.path,
        concurrencyPolicy: enrichmentOnly
          ? "影视、人物、荣誉与看点网络阶段共享排他锁；资料补全模式按基础资料、人物、荣誉、看点顺序恢复已保存的 campaign，不启动影视扫描。"
          : "影视与人物网络阶段共享排他锁；人物模式仅恢复已保存的人物 campaign，不启动影视扫描。"
      },
      scan: { skipped: true, reason: enrichmentOnly ? "enrichment_only_mode" : "people_only_mode" },
      enrichmentCampaign,
      summary: enrichmentOnly
        ? {
            discoveryMessage: "资料补全模式未扫描影视输入目录。",
            workMessage: enrichmentCampaign.summary.total
              ? `已恢复资料补全批次：当前可推进 ${enrichmentCampaign.summary.actionableNow}，待人工确认 ${enrichmentCampaign.summary.waitingForHuman}，阻塞 ${enrichmentCampaign.summary.blocked}，定时复核 ${enrichmentCampaign.summary.scheduledReview}，已完成 ${enrichmentCampaign.summary.completed}。具体下一步见 enrichmentCampaign。`
              : "当前没有已保存的资料补全批次；需要先从影视本轮或历史补全清单加入作品。",
            hasWorkBeyondNewDiscovery: enrichmentCampaign.summary.actionableNow > 0
              || enrichmentCampaign.summary.waitingForHuman > 0
              || enrichmentCampaign.summary.blocked > 0
              || enrichmentCampaign.summary.scheduledReview > 0
          }
        : {
            discoveryMessage: "人物专做模式未扫描影视输入目录。",
            workMessage: "恢复已保存的人物 campaign；具体候选、配额和阻塞项由 people-cycle-state.json 报告。"
          }
    };
    process.stdout.write(`${options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const scan = run([path.join(root, "scan-enabled-input-roots.mjs"), "--max-samples", String(options.maxSamples), "--json"]);
  const state = readState(options.statePath);
  const now = Date.now();
  const lastFullCycleAt = Date.parse(state.lastFullCycleAt ?? "") || 0;
  const changed = scanChanged(scan);
  const cooldownActive = !options.force
    && !changed
    && lastFullCycleAt > 0
    && now - lastFullCycleAt < options.minFullCycleSec * 1000;
  const handoff = cooldownActive
    ? { skipped: true, reason: "unchanged_scan_cooldown", lastFullCycleAt: state.lastFullCycleAt, minFullCycleSec: options.minFullCycleSec, rows: [] }
    : run([path.join(root, "notion-workflow-handoff.mjs"), "scan", "--limit", String(Math.min(options.limit, 3)), "--json"]);
  const metadataTaskSync = cooldownActive
    ? { status: "skipped", reason: "unchanged_scan_cooldown" }
    : runOptional([path.join(root, "notion-metadata-task-sync.mjs"), "--limit", String(Math.min(options.limit, 3)), "--apply", "--json"]);
  let cycle = run([path.join(root, "film-ledger.mjs"), "cycle", "--limit", String(options.limit), "--json"]);
  const cleanupExecution = options.applyCleanup && (cycle.lanes?.cleanup ?? []).length > 0
    ? applyCleanupCandidates(root, cycle.lanes.cleanup)
    : {
        status: "skipped",
        reason: options.applyCleanup ? "no_cleanup_candidates" : "apply_cleanup_not_requested"
      };
  if (options.applyCleanup && cleanupExecution.movePerformed) {
    cycle = run([path.join(root, "film-ledger.mjs"), "cycle", "--limit", String(options.limit), "--json"]);
  }
  const enrichmentCampaign = options.mode === PRODUCTION_MODES.FILM_AND_CURRENT_ENRICHMENT
    ? loadEnrichmentCampaign(options.enrichmentStatePath, {
        limit: options.limit,
        inputs: currentWorkRefs(cycle),
        source: "current_film_batch"
      })
    : null;
  const fullCycleAt = cooldownActive ? state.lastFullCycleAt : new Date(now).toISOString();
  const nextFullCycleAt = cooldownActive
    ? new Date(lastFullCycleAt + options.minFullCycleSec * 1000).toISOString()
    : new Date(now + options.minFullCycleSec * 1000).toISOString();
  writeState(options.statePath, {
    lastScanAt: new Date(now).toISOString(),
    lastFullCycleAt: fullCycleAt,
    lastScanChanged: changed,
    lastHandoffSkipped: cooldownActive
  });
  const summary = buildSummary(scan, cycle);
  summary.cleanupExecution = {
    requested: options.applyCleanup,
    status: cleanupExecution.status,
    moved: cleanupExecution.moved?.length ?? 0,
    failed: cleanupExecution.moveFailures?.length ?? 0,
    skipped: cleanupExecution.moveSkipped?.length ?? 0,
    reason: cleanupExecution.reason ?? null
  };
  if (enrichmentCampaign) {
    summary.enrichment = enrichmentCampaign.summary;
    summary.enrichmentMessage = enrichmentCampaign.summary.total
      ? `资料补全批次：当前可推进 ${enrichmentCampaign.summary.actionableNow}，待人工确认 ${enrichmentCampaign.summary.waitingForHuman}，阻塞 ${enrichmentCampaign.summary.blocked}，定时复核 ${enrichmentCampaign.summary.scheduledReview}，已完成 ${enrichmentCampaign.summary.completed}。`
      : "本轮没有可加入资料补全批次的作品。";
    summary.hasWorkBeyondNewDiscovery = summary.hasWorkBeyondNewDiscovery
      || enrichmentCampaign.summary.actionableNow > 0
      || enrichmentCampaign.summary.waitingForHuman > 0
      || enrichmentCampaign.summary.blocked > 0;
  }
  const result = {
    startedAt: new Date().toISOString(),
    orchestration: {
      ...buildProductionModePlan(options.mode, currentWorkIds(cycle)),
      lockPath: lock.path,
      concurrencyPolicy: options.mode === PRODUCTION_MODES.FILM_AND_CURRENT_ENRICHMENT
        ? "先完成本轮影视的稳定检查点，再按基础资料、人物、荣誉、看点串行处理本批作品；所有网络阶段禁止并行。"
        : "先完成本轮影视的稳定检查点，再处理本批影视人物；两条网络阶段禁止并行。"
    },
    cadence: {
      mode: "bounded_round",
      minFullCycleSec: options.minFullCycleSec,
      fullCycleSkipped: cooldownActive,
      nextFullCycleAt,
      localScanRunsEveryInvocation: true,
      repeatPolicy: "每次调用都扫描本地输入；只有完整 Notion/账本轮次受最短间隔限制。发现文件变化、用户报告新批次或使用 --force 时立即执行完整轮次。"
    },
    summary,
    scan,
    handoff,
    metadataTaskSync,
    cleanupExecution,
    enrichmentCampaign,
    cycle
  };
  process.stdout.write(`${options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
