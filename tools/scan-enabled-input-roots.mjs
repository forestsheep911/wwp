#!/usr/bin/env node
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { openLedger } from "./lib/film-ledger-schema.mjs";

const DEFAULT_DB = path.resolve(".local-data/wwp-film-workflow.sqlite");

function parseArgs(argv) {
  const options = { db: DEFAULT_DB, maxSamples: 3 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--db") options.db = argv[++index];
    else if (arg === "--max-samples") options.maxSamples = Number(argv[++index]);
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(options.maxSamples) || options.maxSamples < 1 || options.maxSamples > 20) {
    throw new Error("--max-samples must be an integer between 1 and 20");
  }
  return options;
}

function statePathFor(root) {
  const key = Buffer.from(root.toLowerCase()).toString("base64url");
  return path.resolve(".local-data", "input-root-state", `${key}.json`);
}

function scanRoot(root, options) {
  const statePath = statePathFor(root);
  mkdirSync(path.dirname(statePath), { recursive: true });
  const result = spawnSync(process.execPath, [
    path.resolve(".codex/plugins/wwp-film-workflow/scripts/watch-input-directory.mjs"),
    "--root", root,
    "--state", statePath,
    "--ledger", options.db,
    "--max-samples", String(options.maxSamples),
    "--once"
  ], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${root}: ${result.stderr || result.stdout}`.trim());
  return JSON.parse(result.stdout);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  options.db = path.resolve(options.db);
  if (!existsSync(options.db)) throw new Error(`Ledger does not exist: ${options.db}`);
  const db = openLedger(options.db);
  let roots;
  try {
    roots = db.prepare("SELECT path FROM input_roots WHERE enabled = 1 ORDER BY id").all().map((row) => row.path);
  } finally {
    db.close();
  }
  const scans = roots.map((root) => {
    try {
      return { root, scan: scanRoot(root, options) };
    } catch (error) {
      return { root, error: error instanceof Error ? error.message : String(error) };
    }
  });
  const output = {
    scannedAt: new Date().toISOString(),
    roots: scans.map(({ root, scan, error }) => error
      ? { root, error }
      : { root: scan.root, entryCount: scan.entryCount, summary: scan.summary, ledger: scan.ledger })
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
