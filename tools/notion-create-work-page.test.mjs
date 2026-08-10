import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";
import { ledgerWorkForOptions, parseArgs } from "./notion-create-work-page.mjs";

test("work page creation requires a ledger work identity", () => {
  assert.throws(() => parseArgs(["--title", "Example"]), /--work-id is required/);
});

test("ledger work type is authoritative over a conflicting CLI type", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-work-page-"));
  const dbPath = path.join(dir, "ledger.sqlite");
  const db = openLedger(dbPath);
  const repo = createLedgerRepository(db);
  const work = repo.ensureWork({ canonicalTitle: "Example Series", year: 2026, workType: "series" });
  db.close();
  try {
    assert.throws(() => ledgerWorkForOptions({ db: dbPath, workId: work.id, type: "movie" }), /conflicts with ledger work_type=series/);
    assert.equal(ledgerWorkForOptions({ db: dbPath, workId: work.id }).work_type, "series");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
