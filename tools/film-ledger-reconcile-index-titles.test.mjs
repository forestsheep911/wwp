import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openLedger } from "./lib/film-ledger-schema.mjs";
import { createLedgerRepository } from "./lib/film-ledger-repository.mjs";
import {
  collectCorrections, indexTitlesByPageId, latestDoubanProgressByPageId, run,
  safeDoubanProgressCorrection, safeYearSuffixCorrection
} from "./film-ledger-reconcile-index-titles.mjs";

test("accepts only an exact year-suffix addition", () => {
  const work = { id: 1, canonical_title: "Example Film", year: 2025, notion_work_page_id: "page" };
  assert.deepEqual(safeYearSuffixCorrection(work, "Example Film (2025)"), {
    workId: 1, pageId: "page", before: "Example Film", after: "Example Film (2025)", evidence: "exact_year_suffix"
  });
  assert.equal(safeYearSuffixCorrection(work, "Renamed Example Film (2025)"), null);
  assert.equal(safeYearSuffixCorrection(work, "Example Film (2024)"), null);
});

test("accepts a title only with matching terminal Douban progress evidence", () => {
  const work = { id: 2, canonical_title: "Old", year: 2025, notion_work_page_id: "page" };
  const evidence = { pageId: "page", title: "新标题 (2025)", subjectId: "123", status: "updated", recordedAt: "now" };
  assert.deepEqual(safeDoubanProgressCorrection(work, "新标题 (2025)", evidence), {
    workId: 2, pageId: "page", before: "Old", after: "新标题 (2025)", evidence: "douban_progress_exact_title",
    doubanSubjectId: "123", evidenceRecordedAt: "now"
  });
  assert.equal(safeDoubanProgressCorrection(work, "别的标题 (2025)", evidence), null);
  assert.equal(safeDoubanProgressCorrection(work, "新标题 (2025)", { ...evidence, subjectId: "" }), null);
  assert.equal(safeDoubanProgressCorrection(work, "新标题 (2025)", { ...evidence, status: "failed" }), null);
  const latest = latestDoubanProgressByPageId(`${JSON.stringify(evidence)}\n{partial`);
  assert.equal(latest.get("page").subjectId, "123");
});

test("indexes only Notion library work entries", () => {
  const titles = indexTitlesByPageId({ entries: {
    a: { source: "Notion library", sourcePageId: "PAGE-A", title: "A (2025)" },
    b: { source: "Other", sourcePageId: "PAGE-B", title: "B (2025)" }
  } });
  assert.equal(titles.get("page-a"), "A (2025)");
  assert.equal(titles.has("page-b"), false);
});

test("dry-run and apply reconcile a bounded exact page match", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-title-reconcile-"));
  const dbPath = path.join(root, "ledger.sqlite");
  const indexPath = path.join(root, "search-index.json");
  const db = openLedger(dbPath);
  const repo = createLedgerRepository(db);
  const first = repo.ensureWork({ canonicalTitle: "First", year: 2025, notionWorkPageId: "page-first", priorityScore: 90 });
  repo.ensureWork({ canonicalTitle: "Second", year: 2024, notionWorkPageId: "page-second", priorityScore: 80 });
  repo.ensureWork({ canonicalTitle: "Unsafe", year: 2023, notionWorkPageId: "page-unsafe", priorityScore: 70 });
  const document = { entries: {
    first: { source: "Notion library", sourcePageId: "page-first", title: "First (2025)" },
    second: { source: "Notion library", sourcePageId: "page-second", title: "Second (2024)" },
    unsafe: { source: "Notion library", sourcePageId: "page-unsafe", title: "Different (2023)" }
  } };
  fs.writeFileSync(indexPath, JSON.stringify(document));
  assert.equal(collectCorrections(db, document, 1).length, 1);
  db.close();

  const preview = run({ db: dbPath, index: indexPath, doubanProgress: "", limit: 1, apply: false });
  assert.equal(preview.correctionCount, 1);
  assert.equal(preview.corrections[0].workId, first.id);
  const applied = run({ db: dbPath, index: indexPath, doubanProgress: "", limit: 1, apply: true });
  assert.equal(applied.applied.length, 1);

  const verify = openLedger(dbPath);
  assert.equal(verify.prepare("SELECT canonical_title FROM works WHERE id=?").get(first.id).canonical_title, "First (2025)");
  verify.close();
  fs.rmSync(root, { recursive: true, force: true });
});
