import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";
import { canReuseIdentityMatch, ledgerWorkForOptions, parseArgs } from "./notion-create-work-page.mjs";

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

function titlePage(title) {
  return { properties: { Title: { type: "title", title: [{ plain_text: title }] } } };
}

test("series identity matching does not merge different seasons sharing one IMDb ID", () => {
  assert.equal(canReuseIdentityMatch(titlePage("广告狂人 第一季 Mad Men Season 1 (2007)"), {
    type: "series", title: "广告狂人 第二季 Mad Men Season 2 (2008)"
  }), false);
  assert.equal(canReuseIdentityMatch(titlePage("广告狂人 第二季 Mad Men Season 2 (2008)"), {
    type: "series", title: "Mad Men Season 2"
  }), true);
  assert.equal(canReuseIdentityMatch(titlePage("Mad Men (2007)"), {
    type: "series", title: "广告狂人 Mad Men (2007)"
  }), true);
});
