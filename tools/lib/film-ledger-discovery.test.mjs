import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("fingerprint changes when a copied directory gains content with preserved mtimes", () => {
  const original = entry({ contentFingerprint: "before" });
  assert.notEqual(fingerprintEntry(original), fingerprintEntry({ ...original, contentFingerprint: "after" }));
});

test("importScan upgrades legacy fingerprints without reopening every source", () => {
  const f = fixture();
  try {
    const payload = { root: "X:\\queue", scannedAt: "2026-07-12T00:00:00.000Z", entries: [entry()] };
    importScan(f.repo, payload);
    const source = f.db.prepare("SELECT id FROM sources").get();
    const oldMaterial = {
      relativePath: payload.entries[0].relativePath,
      fileCount: payload.entries[0].fileCount,
      mediaCount: payload.entries[0].mediaCount,
      subtitleCount: payload.entries[0].subtitleCount,
      nfoCount: payload.entries[0].nfoCount,
      totalBytes: payload.entries[0].totalBytes,
      largestMedia: payload.entries[0].largestMedia,
      flags: payload.entries[0].flags
    };
    f.db.prepare("UPDATE sources SET fingerprint=? WHERE id=?").run(createHash("sha256").update(JSON.stringify(oldMaterial)).digest("hex"), source.id);
    const result = importScan(f.repo, { ...payload, entries: [{ ...payload.entries[0], latestFileMtime: "2026-07-12T01:00:00.000Z" }] });
    assert.equal(result.summary.unchanged, 1);
    assert.equal(f.db.prepare("SELECT status FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`).status, "pending");
  } finally { f.close(); }
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
    f.repo.updateSourceEvidence(source.id, {
      qualityState: "bluray_1080p_h264",
      subtitleEvidence: { internalProbeState: "completed", chineseCandidate: true },
      audioEvidence: { audioTrackCount: 2 },
      colorRisk: "low"
    });
    importScan(f.repo, payload);
    const preserved = f.db.prepare("SELECT * FROM sources").get();
    assert.equal(preserved.quality_state, "bluray_1080p_h264");
    assert.deepEqual(JSON.parse(preserved.subtitle_evidence), { internalProbeState: "completed", chineseCandidate: true });
    assert.deepEqual(JSON.parse(preserved.audio_evidence), { audioTrackCount: 2 });
    assert.equal(preserved.color_risk, "low");
    f.repo.updateSourceEvidence(source.id, {
      subtitleEvidence: {
        codec: "hdmv_pgs_subtitle",
        verifiedChinese: false,
        observedLanguages: ["English", "Persian"],
        productionGate: "defer_until_chinese_track_is_visually_verified"
      }
    });
    importScan(f.repo, payload);
    const preservedManualEvidence = f.db.prepare("SELECT * FROM sources").get();
    assert.deepEqual(JSON.parse(preservedManualEvidence.subtitle_evidence), {
      codec: "hdmv_pgs_subtitle",
      verifiedChinese: false,
      observedLanguages: ["English", "Persian"],
      productionGate: "defer_until_chinese_track_is_visually_verified"
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

test("importScan creates an intake task for a first-seen source", () => {
  const f = fixture();
  try {
    const result = importScan(f.repo, {
      root: "X:\\queue",
      scannedAt: "2026-07-12T00:00:00.000Z",
      entries: [entry({ relativePath: "New.Movie.2026" })]
    });
    assert.equal(result.summary.inserted, 1);
    const source = f.db.prepare("SELECT id FROM sources WHERE relative_path=?").get("New.Movie.2026");
    const task = f.db.prepare("SELECT status, reason FROM workflow_tasks WHERE task_key=?").get(`intake:source:${source.id}`);
    assert.equal(task.status, "pending");
    assert.match(task.reason, /New source discovered/u);
  } finally { f.close(); }
});

test("importScan marks a synthetic flat source missing when its derived path is absent", () => {
  const f = fixture();
  const root = mkdtempSync(path.join(tmpdir(), "wwp-flat-source-"));
  try {
    const result = importScan(f.repo, {
      root,
      entries: [entry({
        relativePath: "@flat/removed-title",
        absolutePath: root,
        mediaCount: 1
      })]
    });
    const source = f.db.prepare("SELECT absolute_path, missing FROM sources WHERE relative_path=?")
      .get("@flat/removed-title");
    assert.equal(result.summary.missing, 1);
    assert.match(source.absolute_path.replaceAll("\\", "/"), /@flat\/removed-title$/u);
    assert.equal(source.missing, 1);
    assert.equal(f.repo.listProductionSourceCandidates({ limit: 9 }).length, 0);
  } finally {
    f.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("importScan retires an old synthetic flat source even when the input root still exists", () => {
  const f = fixture();
  const root = mkdtempSync(path.join(tmpdir(), "wwp-stale-flat-"));
  try {
    const inputRoot = f.repo.upsertInputRoot(root);
    const work = f.repo.ensureWork({ canonicalTitle: "Stale Flat", year: 2025 });
    const source = f.repo.upsertDiscoveredSource({
      inputRootId: inputRoot.id,
      workId: work.id,
      relativePath: "@flat/removed-title",
      absolutePath: root,
      fingerprint: "stale-flat",
      sourceKind: "folder"
    });
    const result = importScan(f.repo, { root, entries: [] });
    assert.equal(result.summary.missing, 1);
    assert.equal(f.db.prepare("SELECT missing FROM sources WHERE id=?").get(source.id).missing, 1);
    assert.equal(f.repo.listProductionSourceCandidates({ limit: 9 }).length, 0);
  } finally {
    f.close();
    rmSync(root, { recursive: true, force: true });
  }
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

test("importScan classifies subtitle-only directories as companion bundles", () => {
  const f = fixture();
  try {
    importScan(f.repo, {
      root: "X:\\queue",
      entries: [entry({
        name: "Example.Series.Subtitles",
        relativePath: "Example.Series.Subtitles",
        fileCount: 12,
        mediaCount: 0,
        subtitleCount: 12,
        totalBytes: 2048,
        largestMedia: [],
        flags: { looksSeries: true, looksDv: false, looksHdr: false }
      })]
    });
    assert.equal(f.db.prepare("SELECT source_kind FROM sources").get().source_kind, "subtitle_bundle");
  } finally { f.close(); }
});

test("importScan does not mark an existing collection member missing", () => {
  const f = fixture();
  const root = mkdtempSync(path.join(tmpdir(), "wwp-scan-root-"));
  try {
    const member = path.join(root, "Collection", "member.mkv");
    mkdirSync(path.dirname(member), { recursive: true });
    writeFileSync(member, "fixture");
    const sourceEntry = entry({
      name: "Collection",
      relativePath: "Collection",
      fileCount: 1,
      mediaCount: 1,
      largestMedia: [{ relativePath: "Collection\\member.mkv", bytes: 7, extension: ".mkv" }]
    });
    const memberSource = f.repo.upsertDiscoveredSource({
      inputRootId: f.repo.upsertInputRoot(root).id,
      relativePath: "Collection\\member.mkv",
      absolutePath: member,
      fingerprint: "member",
      sourceKind: "collection_member",
      missing: true
    });
    const result = importScan(f.repo, { root, entries: [sourceEntry] });
    assert.equal(result.summary.missing, 0);
    assert.equal(f.db.prepare("SELECT missing FROM sources WHERE id=?").get(memberSource.id).missing, 0);
  } finally {
    f.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("importScan does not reopen a resolved collection parent when a bound member is removed for cleanup", () => {
  const f = fixture();
  const root = mkdtempSync(path.join(tmpdir(), "wwp-scan-collection-cleanup-"));
  try {
    const member = path.join(root, "Collection", "member.mkv");
    mkdirSync(path.dirname(member), { recursive: true });
    writeFileSync(member, "fixture");
    const collection = entry({
      name: "Collection",
      relativePath: "Collection",
      fileCount: 1,
      mediaCount: 1,
      totalBytes: 7,
      largestMedia: [{ relativePath: "Collection\\member.mkv", bytes: 7, extension: ".mkv" }]
    });
    importScan(f.repo, { root, entries: [collection] });
    const parent = f.db.prepare("SELECT * FROM sources WHERE relative_path='Collection'").get();
    const child = f.repo.upsertDiscoveredSource({
      inputRootId: parent.input_root_id,
      relativePath: "Collection\\member.mkv",
      absolutePath: member,
      fingerprint: "member",
      sourceKind: "collection_member",
      missing: false
    });
    const work = f.repo.ensureWork({ canonicalTitle: "Resolved Movie", year: 2026, workType: "movie" });
    f.repo.bindSourceToWork(child.id, work.id);
    f.repo.transitionWorkflowTask(
      f.db.prepare("SELECT id FROM workflow_tasks WHERE task_key=?").get(`intake:source:${parent.id}`).id,
      "done",
      { reason: "Collection members resolved" }
    );

    rmSync(member);
    importScan(f.repo, {
      root,
      entries: [{ ...collection, fileCount: 0, mediaCount: 0, totalBytes: 0, largestMedia: [] }]
    });

    const parentTask = f.db.prepare("SELECT status FROM workflow_tasks WHERE task_key=?").get(`intake:source:${parent.id}`);
    assert.equal(parentTask.status, "done");
  } finally {
    f.close();
    rmSync(root, { recursive: true, force: true });
  }
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
