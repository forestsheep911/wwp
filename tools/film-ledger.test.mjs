import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cli = path.resolve("tools/film-ledger.mjs");
function run(args, cwd) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" }); }

test("CLI initializes and reports a clean JSON status", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    assert.equal(run(["--db", db, "init"], dir).status, 0);
    const result = run(["--db", db, "status", "--json"], dir);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { production: {}, publication: {}, totals: { variants: 0, syncReady: 0 }, queues: { production: 0, publication: 0 } });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI discovery imports scan JSON and rejects invalid contracts", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const scan = path.join(dir, "scan.json");
    writeFileSync(scan, JSON.stringify({ root: "X:\\queue", scannedAt: "2026-07-12T00:00:00.000Z", entries: [] }));
    assert.equal(run(["--db", db, "discover", "--scan", scan, "--json"], dir).status, 0);
    const bad = run(["--db", db, "next", "--stage", "other"], dir);
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /production\|publication/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI supports the default database and emits clean JSON", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-default-"));
  try {
    const init = run(["init", "--json"], dir);
    assert.equal(init.status, 0, init.stderr);
    assert.deepEqual(Object.keys(JSON.parse(init.stdout)).sort(), ["database", "initialized"]);
    assert.equal(existsSync(path.join(dir, ".local-data", "wwp-film-workflow.sqlite")), true);
    assert.equal(init.stdout.trim().split("\n").length, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI next, show, record-qc, and register-target cover the ledger workflow", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-workflow-"));
  try {
    const dbPath = path.join(dir, "ledger.sqlite");
    const { openLedger } = await import("./lib/film-ledger-schema.mjs");
    const { createLedgerRepository } = await import("./lib/film-ledger-repository.mjs");
    const db = openLedger(dbPath);
    const repo = createLedgerRepository(db);
    const work = repo.ensureWork({ canonicalTitle: "Example", year: 2025, workType: "movie" });
    const variant = repo.ensureVariant({ workId: work.id, specKey: "main", displayTitle: "Example" });
    repo.transitionProduction(variant.id, "evaluated");
    repo.transitionProduction(variant.id, "selected");
    repo.transitionProduction(variant.id, "encoding");
    db.close();

    const next = run(["--db", dbPath, "next", "--stage", "production", "--limit", "1", "--json"], dir);
    assert.equal(next.status, 0, next.stderr);
    assert.equal(JSON.parse(next.stdout)[0].id, variant.id);

    const qc = run(["--db", dbPath, "record-qc", "--variant", String(variant.id), "--pass", "--output-path", "out.mp4", "--output-size", "1000", "--json"], dir);
    assert.equal(qc.status, 0, qc.stderr);
    assert.equal(JSON.parse(qc.stdout).production_state, "qc_passed");

    const target = run(["--db", dbPath, "register-target", "--variant", String(variant.id), "--work-page", "work", "--spec-page", "spec", "--episode-page", "episode", "--json"], dir);
    assert.equal(target.status, 0, target.stderr);
    assert.equal(JSON.parse(target.stdout).episode_page_id, "episode");

    const show = run(["--db", dbPath, "show", "--variant", String(variant.id), "--json"], dir);
    assert.equal(show.status, 0, show.stderr);
    const shown = JSON.parse(show.stdout);
    assert.equal(shown.variant.publication_state, "structure_pending");
    assert.equal(shown.target.spec_page_id, "spec");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CLI reconcile-notion enforces a maximum of three before loading an adapter", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-cli-reconcile-"));
  try {
    const db = path.join(dir, "ledger.sqlite");
    const result = run(["--db", db, "reconcile-notion", "--limit", "4", "--json"], dir);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--limit must be between 1 and 3/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
