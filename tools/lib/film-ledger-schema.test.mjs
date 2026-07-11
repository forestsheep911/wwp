import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
      "scheduler_state"
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
