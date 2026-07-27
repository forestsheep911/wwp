import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openLedger } from "./film-ledger-schema.mjs";
import { createLedgerRepository } from "./film-ledger-repository.mjs";
import { fingerprintEntry, importScan } from "./film-ledger-discovery.mjs";

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-discovery-"));
  const db = openLedger(path.join(dir, "ledger.sqlite"));
  return { db, repo: createLedgerRepository(db), close() { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

function entry(overrides = {}) {
  return { name: "Example.Movie.2025", relativePath: "Example.Movie.2025", fileCount: 2, mediaCount: 1,
    subtitleCount: 1, nfoCount: 0, totalBytes: 1000,
    largestMedia: [{ relativePath: "Example.Movie.2025\\movie.mkv", bytes: 900, extension: ".mkv" }],
    subtitleHints: ["chs"], flags: { looksSeries: false, looksDv: false, looksHdr: false }, ...overrides };
}

test("fingerprint includes stable material fields but ignores scan hints", () => {
  const original = entry();
  assert.equal(fingerprintEntry(original), fingerprintEntry({ ...original, name: "renamed", subtitleHints: ["cht"], warnings: ["x"] }));
  assert.notEqual(fingerprintEntry(original), fingerprintEntry({ ...original, totalBytes: 1200 }));
});

test("fingerprint uses fixed media evidence instead of the display sample count", () => {
  const original = entry({
    fingerprintMedia: [{ relativePath: "Example.Movie.2025\\movie.mkv", bytes: 900, extension: ".mkv" }]
  });
  assert.equal(fingerprintEntry(original), fingerprintEntry({
    ...original,
    largestMedia: [
      ...original.largestMedia,
      { relativePath: "Example.Movie.2025\\sample.m2ts", bytes: 100, extension: ".m2ts" }
    ]
  }));
});

test("importScan is idempotent, reopens changed evidence, marks missing, and never creates works", () => {
  const f = fixture();
  try {
    const payload = { root: "X:\\queue", scannedAt: "2026-07-12T00:00:00.000Z", entries: [entry()] };
    assert.deepEqual(importScan(f.repo, payload).summary, { inserted: 1, unchanged: 0, changed: 0, missing: 0 });
    assert.deepEqual(importScan(f.repo, payload).summary, { inserted: 0, unchanged: 1, changed: 0, missing: 0 });
    const source = f.db.prepare("SELECT * FROM sources").get();
    assert.deepEqual(JSON.parse(source.subtitle_evidence), {
      externalCount: 1,
      externalHints: ["chs"],
      internalProbeState: "not_run"
    });
    const work = f.repo.ensureWork({ canonicalTitle: "Example Movie", year: 2025, workType: "movie" });
    f.repo.bindSourceToWork(source.id, work.id);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`).status, "done");
    payload.entries[0].totalBytes = 1200;
    assert.deepEqual(importScan(f.repo, payload).summary, { inserted: 0, unchanged: 0, changed: 1, missing: 0 });
    const changedTask = f.db.prepare("SELECT * FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`);
    assert.equal(changedTask.status, "pending");
    assert.equal(changedTask.work_id, work.id);
    assert.match(changedTask.reason, /Source contents changed/u);
    assert.equal(f.db.prepare("SELECT count(*) count FROM works").get().count, 1);
    assert.deepEqual(importScan(f.repo, { ...payload, entries: [] }).summary, { inserted: 0, unchanged: 0, changed: 0, missing: 1 });
    assert.equal(f.db.prepare("SELECT missing FROM sources").get().missing, 1);
    assert.deepEqual(importScan(f.repo, payload).summary, { inserted: 0, unchanged: 0, changed: 1, missing: 0 });
    assert.equal(f.db.prepare("SELECT missing FROM sources").get().missing, 0);
  } finally { f.close(); }
});

test("importScan counts duplicate scan entries deterministically", () => {
  const f = fixture();
  try {
    const duplicate = entry();
    const result = importScan(f.repo, {
      root: "X:\\queue",
      scannedAt: "2026-07-12T00:00:00.000Z",
      entries: [duplicate, { ...duplicate }]
    });
    assert.deepEqual(result.summary, { inserted: 1, unchanged: 1, changed: 0, missing: 0 });
    assert.equal(f.db.prepare("SELECT count(*) count FROM sources").get().count, 1);
  } finally { f.close(); }
});

test("Windows input roots normalize drive case and trailing separators while POSIX remains case-sensitive", () => {
  const f = fixture();
  try {
    importScan(f.repo, { root: "X:\\Queue\\", entries: [entry()] });
    importScan(f.repo, { root: "x:\\queue", entries: [entry()] });
    importScan(f.repo, { root: "/Media/Queue/", entries: [entry({ relativePath: "Upper" })] });
    importScan(f.repo, { root: "/media/queue", entries: [entry({ relativePath: "Lower" })] });
    assert.equal(f.db.prepare("SELECT count(*) count FROM input_roots").get().count, 3);
  } finally { f.close(); }
});
