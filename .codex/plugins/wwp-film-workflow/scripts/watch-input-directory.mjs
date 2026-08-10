#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { importScan } from "../../../../tools/lib/film-ledger-discovery.mjs";
import { createLedgerRepository } from "../../../../tools/lib/film-ledger-repository.mjs";
import { openLedger } from "../../../../tools/lib/film-ledger-schema.mjs";

function usage() {
  console.log(`Usage:
  node scripts/watch-input-directory.mjs --root <input-dir> [--state .local-data/wwp-queue-state.json] [--ledger film-ledger.sqlite] [--once]
  node scripts/watch-input-directory.mjs --root <input-dir> --interval-sec 600 [--max-iterations 0]
  node scripts/watch-input-directory.mjs <input-dir> [state.json] [output.json]

Compares top-level input-directory scan results against a saved state file and
reports new, removed, or materially changed entries. First run creates a
baseline without treating every existing entry as new.
`);
}

function parseArgs(argv) {
  const options = {
    statePath: ".local-data/wwp-input-directory-state.json",
    outputPath: "",
    maxSamples: 3,
    intervalSec: 0,
    maxIterations: 1
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? argv[++index];
    if (name === "--help" || name === "-h") options.help = true;
    else if (name === "--root" || name === "-r") options.root = value();
    else if (name === "--state") options.statePath = value();
    else if (name === "--output") options.outputPath = value();
    else if (name === "--ledger") options.ledgerPath = value();
    else if (name === "--max-samples") options.maxSamples = Number(value());
    else if (name === "--interval-sec") options.intervalSec = Number(value());
    else if (name === "--max-iterations") options.maxIterations = Number(value());
    else if (arg === "--once") {
      options.intervalSec = 0;
      options.maxIterations = 1;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (positional.length > 3) {
    throw new Error(`Too many positional arguments: ${positional.slice(3).join(", ")}`);
  }
  if (!options.root && positional[0]) options.root = positional[0];
  if (positional[1]) options.statePath = positional[1];
  if (positional[2]) options.outputPath = positional[2];
  if (!Number.isFinite(options.maxSamples) || options.maxSamples < 1) {
    throw new Error("--max-samples must be a positive number.");
  }
  if (!Number.isFinite(options.intervalSec) || options.intervalSec < 0) {
    throw new Error("--interval-sec must be zero or a positive number.");
  }
  if (!Number.isFinite(options.maxIterations) || options.maxIterations < 0) {
    throw new Error("--max-iterations must be zero or a positive number.");
  }
  if (options.intervalSec > 0 && options.maxIterations === 1) {
    options.maxIterations = 0;
  }
  return options;
}

function ensureParent(filePath) {
  const parent = path.dirname(path.resolve(filePath));
  mkdirSync(parent, { recursive: true });
}

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function writeJsonAtomic(filePath, payload) {
  ensureParent(filePath);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function runScan(root, maxSamples) {
  const scanScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "scan-input-directory.mjs");
  const tempPath = path.join(tmpdir(), `wwp-scan-${process.pid}-${Date.now()}.json`);
  const result = spawnSync(process.execPath, [
    scanScript,
    "--root",
    root,
    "--output",
    tempPath,
    "--max-samples",
    String(maxSamples)
  ], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`scan failed: ${result.stderr || result.stdout}`);
  }
  try {
    return readJson(tempPath, null);
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      // best effort
    }
  }
}

function signature(entry) {
  return {
    name: entry.name,
    relativePath: entry.relativePath,
    fileCount: entry.fileCount,
    mediaCount: entry.mediaCount,
    subtitleCount: entry.subtitleCount,
    nfoCount: entry.nfoCount,
    totalBytes: entry.totalBytes,
    contentFingerprint: entry.contentFingerprint ?? null,
    latestFileMtime: entry.latestFileMtime ?? null,
    largestMedia: entry.largestMedia?.map((item) => ({
      relativePath: item.relativePath,
      bytes: item.bytes,
      extension: item.extension
    })) ?? [],
    flags: entry.flags
  };
}

function indexEntries(entries = []) {
  return new Map(entries.map((entry) => [entry.relativePath || entry.name, signature(entry)]));
}

function stableString(value) {
  return JSON.stringify(value);
}

function entriesDiffer(before, after) {
  const beforeSamples = before.largestMedia ?? [];
  const afterSamples = after.largestMedia ?? [];
  if (before.contentFingerprint && after.contentFingerprint) {
    return before.contentFingerprint !== after.contentFingerprint;
  }
  // `--max-samples` changes report detail only. Compare the shared prefix so a
  // caller changing that presentation limit cannot create a false intake event.
  const sharedSamples = Math.min(beforeSamples.length, afterSamples.length);
  return stableString({ ...before, largestMedia: beforeSamples.slice(0, sharedSamples) })
    !== stableString({ ...after, largestMedia: afterSamples.slice(0, sharedSamples) });
}

function diffState(previousEntries, currentEntries) {
  const previous = indexEntries(previousEntries);
  const current = indexEntries(currentEntries);
  const added = [];
  const removed = [];
  const changed = [];

  for (const [key, entry] of current.entries()) {
    if (!previous.has(key)) {
      added.push(entry);
      continue;
    }
    const before = previous.get(key);
    if (entriesDiffer(before, entry)) {
      changed.push({ before, after: entry });
    }
  }

  for (const [key, entry] of previous.entries()) {
    if (!current.has(key)) removed.push(entry);
  }

  return { added, removed, changed };
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  if (!options.root) {
    usage();
    process.exitCode = 2;
    return;
  }

  let iteration = 0;
  do {
    iteration += 1;
    const previous = readJson(options.statePath, null);
    const scan = runScan(options.root, options.maxSamples);
    const baseline = !previous;
    const diff = baseline
      ? { added: [], removed: [], changed: [] }
      : diffState(previous.entries, scan.entries);
    let ledger;
    if (options.ledgerPath) {
      const db = openLedger(options.ledgerPath);
      try {
        const repo = createLedgerRepository(db);
        if (process.env.WWP_TEST_FAIL_LEDGER_IMPORT === "1") {
          repo.upsertInputRoot = () => { throw new Error("test ledger import failure"); };
        }
        ledger = importScan(repo, scan).summary;
      } finally {
        db.close();
      }
    }

    const state = {
      root: scan.root,
      scannedAt: scan.scannedAt,
      entryCount: scan.entryCount,
      entries: scan.entries.map(signature)
    };
    writeJsonAtomic(options.statePath, state);

    const payload = {
      root: scan.root,
      scannedAt: scan.scannedAt,
      statePath: options.statePath,
      baseline,
      entryCount: scan.entryCount,
      summary: {
        added: diff.added.length,
        removed: diff.removed.length,
        changed: diff.changed.length
      },
      ...(ledger ? { ledger } : {}),
      added: diff.added,
      removed: diff.removed,
      changed: diff.changed
    };
    if (options.outputPath) writeJsonAtomic(options.outputPath, payload);
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);

    if (options.intervalSec <= 0) break;
    if (options.maxIterations > 0 && iteration >= options.maxIterations) break;
    await sleep(options.intervalSec * 1000);
  } while (true);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
