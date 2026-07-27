import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openLedger, SCHEMA_VERSION, withTransaction } from "./film-ledger-schema.mjs";

test("openLedger creates the complete versioned schema", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-ledger-schema-"));
  try {
    const db = openLedger(path.join(dir, "ledger.sqlite"));
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((row) => row.name);

    for (const name of [
      "input_roots",
      "works",
      "sources",
      "variants",
      "notion_targets",
      "events",
      "scheduler_state",
      "workflow_tasks"
    ]) {
      assert.ok(tables.includes(name), `missing table ${name}`);
    }

    assert.equal(db.prepare("SELECT version FROM schema_meta").get().version, SCHEMA_VERSION);
    assert.equal(db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openLedger migrates existing v1 work and unbound source records into workflow tasks", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-ledger-migration-"));
  const file = path.join(dir, "ledger.sqlite");
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE schema_meta (version INTEGER NOT NULL);
      INSERT INTO schema_meta VALUES (1);
      CREATE TABLE works (id INTEGER PRIMARY KEY, priority_score REAL NOT NULL DEFAULT 0);
      CREATE TABLE sources (id INTEGER PRIMARY KEY, work_id INTEGER, missing INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE variants (id INTEGER PRIMARY KEY, work_id INTEGER);
      INSERT INTO works VALUES (7, 80);
      INSERT INTO sources VALUES (8, NULL, 0);
    `);
    legacy.close();

    const db = openLedger(file);
    assert.equal(db.prepare("SELECT version FROM schema_meta").get().version, SCHEMA_VERSION);
    assert.equal(db.prepare("SELECT status FROM workflow_tasks WHERE task_key='metadata:work:7'").get().status, "pending");
    assert.equal(db.prepare("SELECT status FROM workflow_tasks WHERE task_key='intake:source:8'").get().status, "pending");
    const workColumns = db.prepare("PRAGMA table_info(works)").all().map((row) => row.name);
    assert.ok(workColumns.includes("workflow_status"));
    assert.ok(workColumns.includes("workflow_note"));
    assert.ok(workColumns.includes("workflow_status_observed_at"));
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("openLedger migrates v2 works to workflow handoff fields", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-ledger-v2-migration-"));
  const file = path.join(dir, "ledger.sqlite");
  let db;
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE schema_meta (version INTEGER NOT NULL);
      INSERT INTO schema_meta VALUES (2);
      CREATE TABLE works (
        id INTEGER PRIMARY KEY,
        canonical_title TEXT NOT NULL,
        year INTEGER,
        work_type TEXT NOT NULL DEFAULT 'movie',
        notion_work_page_id TEXT UNIQUE,
        priority_score REAL NOT NULL DEFAULT 0,
        scope_state TEXT NOT NULL DEFAULT 'candidate',
        next_review_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO works VALUES (1, 'Example', 2025, 'movie', 'page-1', 10, 'catalogued', NULL, 'now', 'now');
    `);
    legacy.close();

    db = openLedger(file);
    assert.equal(db.prepare("SELECT version FROM schema_meta").get().version, SCHEMA_VERSION);
    const row = db.prepare("SELECT workflow_status, workflow_note, workflow_status_observed_at FROM works WHERE id=1").get();
    assert.deepEqual({ ...row }, { workflow_status: null, workflow_note: null, workflow_status_observed_at: null });
    assert.throws(() => db.prepare("UPDATE works SET workflow_status='invalid' WHERE id=1").run());
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("withTransaction commits successful work and rolls back failures", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-ledger-transaction-"));
  try {
    const db = openLedger(path.join(dir, "ledger.sqlite"));

    const result = withTransaction(db, () => {
      db.prepare("INSERT INTO scheduler_state (key, value, updated_at) VALUES (?, ?, ?)")
        .run("committed", "yes", "2026-07-12T00:00:00.000Z");
      return 42;
    });
    assert.equal(result, 42);

    assert.throws(() => {
      withTransaction(db, () => {
        db.prepare("INSERT INTO scheduler_state (key, value, updated_at) VALUES (?, ?, ?)")
          .run("rolled-back", "yes", "2026-07-12T00:00:00.000Z");
        throw new Error("stop");
      });
    }, /stop/);

    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM scheduler_state").get().count, 1);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
