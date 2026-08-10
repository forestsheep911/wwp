#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

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
    force: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--limit") options.limit = Number(argv[++index]);
    else if (arg === "--max-samples") options.maxSamples = Number(argv[++index]);
    else if (arg === "--state") options.statePath = argv[++index];
    else if (arg === "--min-full-cycle-sec") options.minFullCycleSec = Number(argv[++index]);
    else if (arg === "--force") options.force = true;
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

function run(args) {
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `command failed: ${args.join(" ")}`).trim());
  }
  return JSON.parse(result.stdout);
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
  const publicationPending = (laneRows.publication ?? []).length;
  const cleanupCandidates = (laneRows.cleanup ?? []).length;
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
    publicationPending,
    cleanupCandidates,
    registeredSourcesNeedingProductionReview: unselectedSources,
    discoveryMessage: newlyDiscoveredSources || changedSources
      ? `本轮发现 ${newlyDiscoveredSources} 个新输入、${changedSources} 个变化输入`
      : `本轮未发现文件新增或变化（这不等于无片）；输入队列仍登记 ${roots.reduce((total, root) => total + (root.entryCount ?? 0), 0)} 条，已登记条目的制作、发布和资料补齐继续按各自队列推进`,
    workMessage: [
      intakeCandidates && `待识别 ${intakeCandidates}`,
      metadataCandidates && `待补资料 ${metadataCandidates}`,
      productionCandidates && `待制作 ${productionCandidates}`,
      publicationPending && `待发布闭环 ${publicationPending}`,
      cleanupCandidates && `待清理 ${cleanupCandidates}`
    ].filter(Boolean).join("；") || "当前没有待推进工作",
    hasWorkBeyondNewDiscovery: [
      laneRows.intake,
      laneRows.catalogMaintenance,
      laneRows.production,
      laneRows.publication,
      laneRows.cleanup
    ].some((lane) => (lane ?? []).length > 0)
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = path.resolve("tools");
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
  const cycle = run([path.join(root, "film-ledger.mjs"), "cycle", "--limit", String(options.limit), "--json"]);
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
  const result = {
    startedAt: new Date().toISOString(),
    cadence: {
      mode: "bounded_round",
      minFullCycleSec: options.minFullCycleSec,
      fullCycleSkipped: cooldownActive,
      nextFullCycleAt,
      localScanRunsEveryInvocation: true,
      repeatPolicy: "每次调用都扫描本地输入；只有完整 Notion/账本轮次受最短间隔限制。发现文件变化、用户报告新批次或使用 --force 时立即执行完整轮次。"
    },
    summary: buildSummary(scan, cycle),
    scan,
    handoff,
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
