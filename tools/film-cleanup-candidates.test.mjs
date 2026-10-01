import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applySourceCoverageOverride, cleanupReportSections, collectCleanupCandidates, collectManifestMatches, collectSourceCleanupCandidates, enableFailedMoveRetry, latestExpansionDecision, moveCleanupCandidates, recordCleanupMoveFailures, recordMovedSourcePath, recordMovedVariantPath, selectCleanupCandidates } from "./film-cleanup-candidates.mjs";

test("cleanup selection can limit one candidate class without mixing outputs and sources", () => {
  const candidates = [
    { candidate_type: "playable_output", eligible: true, id: "output-1" },
    { candidate_type: "source_input", eligible: true, id: "source-1" },
    { candidate_type: "playable_output", eligible: true, id: "output-2" }
  ];
  assert.deepEqual(
    selectCleanupCandidates(candidates, { candidateType: "source_input", limit: 10 }).map((row) => row.id),
    ["source-1"]
  );
});

test("cleanup selection can target one exact variant or source", () => {
  const candidates = [
    { candidate_type: "playable_output", eligible: true, variantId: 10 },
    { candidate_type: "playable_output", eligible: true, variantId: 11 },
    { candidate_type: "source_input", eligible: true, sourceId: 20 }
  ];
  assert.deepEqual(
    selectCleanupCandidates(candidates, { variantId: 11 }).map((row) => row.variantId),
    [11]
  );
  assert.deepEqual(
    selectCleanupCandidates(candidates, { sourceId: 20 }).map((row) => row.sourceId),
    [20]
  );
});

test("cleanup dry-run sections reflect the exact scoped selection", () => {
  const candidates = [
    { candidate_type: "playable_output", eligible: true, variantId: 10 },
    { candidate_type: "playable_output", eligible: true, variantId: 11 },
    { candidate_type: "source_input", eligible: true, sourceId: 20 }
  ];
  const sections = cleanupReportSections(selectCleanupCandidates(candidates, { variantId: 11 }));
  assert.deepEqual(sections.candidates.map((row) => row.variantId), [11]);
  assert.deepEqual(sections.sourceCandidates, []);
  assert.deepEqual(sections.manifestMatches, []);
});

test("reviewed uncovered source media can waive only the exact coverage-count blocker", () => {
  const candidates = [
    { candidate_type: "source_input", sourceId: 20, eligible: false, reasons: ["source_media_not_fully_covered"] },
    { candidate_type: "source_input", sourceId: 21, eligible: false, reasons: ["linked_variants_not_closed", "source_media_not_fully_covered"] }
  ];
  applySourceCoverageOverride(candidates, { sourceId: 20, reason: "Three subtitle-free extras were reviewed and excluded." });
  assert.equal(candidates[0].eligible, true);
  assert.deepEqual(candidates[0].reasons, []);
  assert.equal(candidates[0].waivedReason, "source_media_not_fully_covered");
  assert.throws(
    () => applySourceCoverageOverride(candidates, { sourceId: 21, reason: "Not enough." }),
    /cannot waive blockers/u
  );
});

function mockDb(rows, websiteEvents = {}) {
  return {
    prepare: (sql) => ({
      all: (...args) => sql.includes("WHERE targets.work_page_id=?")
        ? rows.filter(row => row.work_page_id === args[0]
          && (row.episode_page_id || row.spec_page_id) === args[1]
          && row.media_asset_page_id === args[2]
          && row.media_block_id === args[3])
        : rows,
      get: (variantId) => websiteEvents[variantId] ?? null
    })
  };
}

test("unscoped cleanup finds staging outputs but never requeues quarantine", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-staging-"));
  try {
    const staging = path.join(root, "external", "ready.mp4");
    const quarantined = path.join(root, "待人工删除", "ready.variant-2.mp4");
    for (const file of [staging, quarantined]) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "ready");
    }
    const rows = [staging, quarantined].map((output_path, index) => ({
      variant_id: index + 1, output_path, output_size_bytes: 5,
      publication_state: "sync_ready", canonical_title: "Ready"
    }));
    const db = mockDb(rows);
    assert.deepEqual(collectCleanupCandidates(db).filter(row => row.eligible).map(row => row.variantId), [1]);
    assert.deepEqual(collectCleanupCandidates(db)[1].reasons, ["already_quarantined"]);
    assert.equal(collectCleanupCandidates(db, path.join(root, "default")).some(row => row.eligible), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("cleanup report accepts only sync-ready files with matching ledger size", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-"));
  const filePath = path.join(root, "ready.mp4");
  fs.writeFileSync(filePath, "ready");
  try {
    const row = {
      variant_id: 1,
      output_path: filePath,
      output_size_bytes: 5,
      publication_state: "sync_ready",
      canonical_title: "Ready",
      workflow_status: "已完成"
    };
    assert.deepEqual(collectCleanupCandidates(mockDb([row]), root), [{
      variantId: 1,
      title: "Ready",
      path: path.resolve(filePath),
      expectedBytes: 5,
      actualBytes: 5,
      eligible: true,
      reasons: []
    }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup report rejects mismatched and outside-root files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-"));
  const inside = path.join(root, "mismatch.mp4");
  const outside = path.join(path.dirname(root), "wwp-cleanup-outside.mp4");
  fs.writeFileSync(inside, "short");
  fs.writeFileSync(outside, "outside");
  try {
    const rows = [
      { variant_id: 2, output_path: inside, output_size_bytes: 99, publication_state: "sync_ready", canonical_title: "Mismatch", workflow_status: "已完成" },
      { variant_id: 3, output_path: outside, output_size_bytes: 7, publication_state: "sync_ready", canonical_title: "Outside" }
    ];
    const report = collectCleanupCandidates(mockDb(rows), root);
    assert.deepEqual(report.map(item => item.reasons), [["size_mismatch"], ["outside_output_root"]]);
    assert.equal(report.every(item => item.eligible === false), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test("cleanup report does not wait for work-page human confirmation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-"));
  const filePath = path.join(root, "human-gate.mp4");
  fs.writeFileSync(filePath, "ready");
  try {
    const row = {
      variant_id: 4,
      output_path: filePath,
      output_size_bytes: 5,
      publication_state: "sync_ready",
      canonical_title: "Human gate",
      workflow_status: "待人工确认"
    };
    const [candidate] = collectCleanupCandidates(mockDb([row]), root);
    assert.equal(candidate.eligible, true);
    assert.deepEqual(candidate.reasons, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup report excludes explicitly named sample artifacts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-sample-"));
  const filePath = path.join(root, "robotech.e01.sample.mp4");
  fs.writeFileSync(filePath, "ready");
  try {
    const row = {
      variant_id: 5,
      output_path: filePath,
      output_size_bytes: 5,
      publication_state: "sync_ready",
      canonical_title: "Sample",
      workflow_status: "已完成"
    };
    const [candidate] = collectCleanupCandidates(mockDb([row]), root);
    assert.equal(candidate.eligible, false);
    assert.deepEqual(candidate.reasons, ["sample_artifact"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("successful upload manifest independently authorizes playable-output quarantine", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-upload-manifest-"));
  const outputRoot = path.join(root, "output");
  fs.mkdirSync(outputRoot);
  const fileName = "uploaded.mp4";
  fs.writeFileSync(path.join(outputRoot, fileName), "ready");
  fs.writeFileSync(path.join(root, "sample-release-manifest.json"), JSON.stringify({
    items: [{ originalFileName: fileName, pageId: "page-1", expectedMediaBlockId: "block-1" }]
  }));
  try {
    const [candidate] = collectManifestMatches(root, outputRoot);
    assert.equal(candidate.eligible, true);
    assert.equal(candidate.mediaBlockId, "block-1");
    const moved = moveCleanupCandidates([{ candidate_type: "uploaded_output", ...candidate }], { quarantineDir: path.join(root, "quarantine") });
    assert.equal(moved.moved.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("source cleanup treats a cancelled planned variant as closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-source-cleanup-"));
  const sourcePath = path.join(root, "source.mkv");
  fs.writeFileSync(sourcePath, "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 12,
      absolute_path: sourcePath,
      relative_path: "source.mkv",
      source_kind: "file",
      canonical_title: "Cancelled plan",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:CLOSED] reviewed and exhausted",
      linked_variant_count: 1,
      sync_ready_count: 0,
      closed_variant_count: 1,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, true);
    assert.equal(candidate.closedVariantCount, 1);
    assert.deepEqual(candidate.reasons, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source cleanup is blocked while a changed-source intake task remains open", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-source-open-intake-"));
  const sourcePath = path.join(root, "source.mkv");
  fs.writeFileSync(sourcePath, "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 130,
      absolute_path: sourcePath,
      relative_path: "source.mkv",
      source_kind: "folder",
      canonical_title: "Changed source",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:CLOSED] 已完成",
      linked_variant_count: 1,
      sync_ready_count: 1,
      closed_variant_count: 1,
      active_variant_count: 0,
      open_intake_task_count: 1
    }]));
    assert.equal(candidate.eligible, false);
    assert.equal(candidate.openIntakeTaskCount, 1);
    assert.deepEqual(candidate.reasons, ["source_intake_task_open"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("flat single-file sources enter cleanup classification with exact media coverage", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-flat-source-cleanup-"));
  const sourcePath = path.join(root, "movie.mkv");
  fs.writeFileSync(sourcePath, "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 122,
      absolute_path: sourcePath,
      relative_path: "@flat/movie.mkv",
      source_kind: "folder",
      canonical_title: "Flat source",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:CLOSED] 已完成现有规格",
      linked_variant_count: 1,
      sync_ready_count: 1,
      closed_variant_count: 1,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, true);
    assert.equal(candidate.mediaFileCount, 1);
    assert.deepEqual(candidate.reasons, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("flat single-file sources remain blocked when linked variants do not cover them", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-flat-source-coverage-"));
  const sourcePath = path.join(root, "movie.mkv");
  fs.writeFileSync(sourcePath, "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 123,
      absolute_path: sourcePath,
      relative_path: "@flat/movie.mkv",
      source_kind: "folder",
      canonical_title: "Flat source",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:CLOSED] 已完成现有规格",
      linked_variant_count: 0,
      sync_ready_count: 0,
      closed_variant_count: 0,
      active_variant_count: 0
    }]));
    assert.equal(candidate, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a recorded quarantine failure blocks automatic source-move retries", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-source-cleanup-failed-move-"));
  const sourcePath = path.join(root, "source.mkv");
  fs.writeFileSync(sourcePath, "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 120,
      absolute_path: sourcePath,
      relative_path: "source.mkv",
      source_kind: "file",
      canonical_title: "Failed move",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:CLOSED] reviewed",
      linked_variant_count: 1,
      sync_ready_count: 1,
      closed_variant_count: 1,
      active_variant_count: 0,
      quarantine_failure_json: JSON.stringify({ errorCode: "EBUSY", error: "file is locked" })
    }]));
    assert.equal(candidate.eligible, false);
    assert.deepEqual(candidate.reasons, ["previous_quarantine_move_failed"]);
    assert.equal(candidate.previousMoveFailure.errorCode, "EBUSY");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an exact retry can clear only a recorded transient lock failure", () => {
  const candidate = {
    candidate_type: "source_input",
    sourceId: 120,
    path: "I:\\queue\\source",
    eligible: false,
    reasons: ["previous_quarantine_move_failed"],
    previousMoveFailure: { path: "i:\\queue\\source", errorCode: "EBUSY" }
  };
  assert.equal(enableFailedMoveRetry(candidate, { sourceId: 120 }), true);
  assert.equal(candidate.eligible, true);
  assert.deepEqual(candidate.reasons, []);
  assert.equal(candidate.retryPreviousMoveFailure.errorCode, "EBUSY");
});

test("a failed-move retry does not bypass any other source cleanup blocker", () => {
  const candidate = {
    candidate_type: "source_input",
    sourceId: 120,
    path: "I:\\queue\\source",
    eligible: false,
    reasons: ["previous_quarantine_move_failed", "source_expansion_open"],
    previousMoveFailure: { path: "I:\\queue\\source", errorCode: "EPERM" }
  };
  assert.equal(enableFailedMoveRetry(candidate, { sourceId: 120 }), false);
  assert.equal(candidate.eligible, false);
  assert.deepEqual(candidate.reasons, ["previous_quarantine_move_failed", "source_expansion_open"]);
});

test("a failed-move retry rejects mismatched paths and non-lock errors", () => {
  const base = {
    candidate_type: "source_input",
    sourceId: 120,
    path: "I:\\queue\\source",
    eligible: false,
    reasons: ["previous_quarantine_move_failed"]
  };
  assert.throws(() => enableFailedMoveRetry({
    ...base,
    previousMoveFailure: { path: "I:\\queue\\other", errorCode: "EBUSY" }
  }, { sourceId: 120 }), /no longer matches/u);
  assert.throws(() => enableFailedMoveRetry({
    ...base,
    previousMoveFailure: { path: "I:\\queue\\source", errorCode: "EACCES" }
  }, { sourceId: 120 }), /not a retryable lock error/u);
});

test("source coverage count ignores sample media files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-source-sample-count-"));
  const sourcePath = path.join(root, "source");
  fs.mkdirSync(sourcePath);
  fs.writeFileSync(path.join(sourcePath, "movie.mkv"), "movie");
  fs.writeFileSync(path.join(sourcePath, "movie.Sample.mkv"), "sample");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 13,
      absolute_path: sourcePath,
      relative_path: "source",
      source_kind: "folder",
      canonical_title: "Sample exclusion",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:CLOSED] reviewed and exhausted",
      linked_variant_count: 1,
      sync_ready_count: 1,
      closed_variant_count: 1,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, true);
    assert.equal(candidate.mediaFileCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source coverage treats an optical disc layout as one content unit", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-source-disc-count-"));
  const sourcePath = path.join(root, "disc");
  fs.mkdirSync(path.join(sourcePath, "BDMV", "STREAM"), { recursive: true });
  fs.writeFileSync(path.join(sourcePath, "BDMV", "STREAM", "00000.m2ts"), "feature");
  fs.writeFileSync(path.join(sourcePath, "BDMV", "STREAM", "00001.m2ts"), "extra");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 14,
      absolute_path: sourcePath,
      relative_path: "disc",
      source_kind: "folder",
      canonical_title: "Disc layout",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:CLOSED] reviewed and exhausted",
      linked_variant_count: 1,
      sync_ready_count: 1,
      closed_variant_count: 1,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, true);
    assert.equal(candidate.mediaFileCount, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("empty unbound directories are reversible cleanup candidates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-empty-unbound-source-"));
  const sourcePath = path.join(root, "empty-source");
  fs.mkdirSync(sourcePath);
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 15,
      work_id: null,
      absolute_path: sourcePath,
      relative_path: "empty-source",
      source_kind: "folder",
      canonical_title: null,
      workflow_status: null,
      workflow_note: null,
      linked_variant_count: 0,
      sync_ready_count: 0,
      closed_variant_count: 0,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, true);
    assert.equal(candidate.isDirectory, true);
    assert.equal(candidate.mediaFileCount, 0);
    assert.deepEqual(candidate.reasons, ["empty_unbound_directory"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("empty bound source directories are reversible cleanup candidates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-empty-bound-source-"));
  const sourcePath = path.join(root, "empty-season");
  fs.mkdirSync(sourcePath);
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 16,
      work_id: 232,
      absolute_path: sourcePath,
      relative_path: "empty-season",
      source_kind: "season_member",
      canonical_title: "Empty season",
      workflow_status: "待 AI 处理",
      workflow_note: null,
      linked_variant_count: 0,
      sync_ready_count: 0,
      closed_variant_count: 0,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, true);
    assert.deepEqual(candidate.reasons, ["empty_source_directory"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unlinked non-empty sources are not cleanup candidates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-unlinked-source-"));
  const sourcePath = path.join(root, "source.mkv");
  fs.writeFileSync(sourcePath, "source");
  try {
    const candidates = collectSourceCleanupCandidates(mockDb([{
      source_id: 17,
      work_id: 232,
      absolute_path: sourcePath,
      relative_path: "source.mkv",
      source_kind: "file",
      canonical_title: "Unlinked source",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:CLOSED] reviewed",
      linked_variant_count: 0,
      sync_ready_count: 0,
      closed_variant_count: 0,
      active_variant_count: 0
    }]));
    assert.deepEqual(candidates, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a zero-variant duplicate source is cleanup eligible only after expansion closes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-zero-variant-duplicate-"));
  const sourcePath = path.join(root, "duplicate-source");
  fs.mkdirSync(sourcePath);
  fs.writeFileSync(path.join(sourcePath, "episode01.mkv"), "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 18,
      work_id: 232,
      absolute_path: sourcePath,
      relative_path: "duplicate-source",
      source_kind: "duplicate_source",
      canonical_title: "Covered duplicate",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:CLOSED] existing released specification covers this duplicate source",
      linked_variant_count: 0,
      sync_ready_count: 0,
      closed_variant_count: 0,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, true);
    assert.equal(candidate.linkedVariantCount, 0);
    assert.equal(candidate.mediaFileCount, 1);
    assert.deepEqual(candidate.reasons, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a zero-variant duplicate source remains blocked while expansion is open", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-zero-variant-open-"));
  const sourcePath = path.join(root, "duplicate-source");
  fs.mkdirSync(sourcePath);
  fs.writeFileSync(path.join(sourcePath, "episode01.mkv"), "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 19,
      work_id: 232,
      absolute_path: sourcePath,
      relative_path: "duplicate-source",
      source_kind: "duplicate_source",
      canonical_title: "Open duplicate",
      workflow_status: "AI 处理中",
      workflow_note: "[规格扩展:OPEN] compare another audio track",
      linked_variant_count: 0,
      sync_ready_count: 0,
      closed_variant_count: 0,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, false);
    assert.deepEqual(candidate.reasons, ["source_expansion_open"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source cleanup remains blocked while the work has an open expansion marker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-source-expansion-"));
  const sourcePath = path.join(root, "source.mkv");
  fs.writeFileSync(sourcePath, "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 13,
      absolute_path: sourcePath,
      relative_path: "source.mkv",
      source_kind: "file",
      canonical_title: "Open expansion",
      workflow_status: "待 AI 处理",
      workflow_note: "[规格扩展:OPEN] 待补充台配版本",
      linked_variant_count: 1,
      sync_ready_count: 1,
      closed_variant_count: 1,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, false);
    assert.deepEqual(candidate.reasons, ["source_expansion_open"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source cleanup requires an explicit closed expansion marker", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-source-expansion-unresolved-"));
  const sourcePath = path.join(root, "source.mkv");
  fs.writeFileSync(sourcePath, "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 16,
      absolute_path: sourcePath,
      relative_path: "source.mkv",
      source_kind: "file",
      canonical_title: "Legacy unresolved expansion",
      workflow_status: "已完成",
      workflow_note: "旧流程没有规格扩展结论",
      linked_variant_count: 1,
      sync_ready_count: 1,
      closed_variant_count: 1,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, false);
    assert.deepEqual(candidate.reasons, ["source_expansion_unresolved"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source cleanup uses the latest expansion marker rather than any historical OPEN", () => {
  assert.equal(latestExpansionDecision("[规格扩展:OPEN] 待做\n[规格扩展:CLOSED] 已覆盖"), "CLOSED");
  assert.equal(latestExpansionDecision("[规格扩展:CLOSED] 曾关闭\n[规格扩展:OPEN] 新源进入"), "OPEN");
  assert.equal(latestExpansionDecision("【规格扩展:OPEN】 仍保留法语音轨\n【规格扩展:CLOSED】 可安全归档"), "CLOSED");
  assert.equal(latestExpansionDecision("[规格扩展:CLOSED] 旧结论\n【规格扩展：OPEN】 新源重新进入"), "OPEN");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-source-latest-expansion-"));
  const sourcePath = path.join(root, "source.mkv");
  fs.writeFileSync(sourcePath, "source");
  try {
    const [candidate] = collectSourceCleanupCandidates(mockDb([{
      source_id: 15,
      absolute_path: sourcePath,
      relative_path: "source.mkv",
      source_kind: "file",
      canonical_title: "Closed after review",
      workflow_status: "已完成",
      workflow_note: "[规格扩展:OPEN] 待核验\n[规格扩展:CLOSED] 已由新源完整覆盖",
      linked_variant_count: 1,
      sync_ready_count: 0,
      closed_variant_count: 1,
      active_variant_count: 0
    }]));
    assert.equal(candidate.eligible, true);
    assert.deepEqual(candidate.reasons, []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("source cleanup ignores a source already moved outside its enabled input root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-source-quarantine-"));
  const sourcePath = path.join(root, "quarantine", "source.mkv");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
  fs.writeFileSync(sourcePath, "source");
  try {
    assert.deepEqual(collectSourceCleanupCandidates(mockDb([{
      source_id: 14,
      absolute_path: sourcePath,
      input_root_path: path.join(root, "input"),
      relative_path: "source.mkv",
      source_kind: "file",
      canonical_title: "Quarantined source",
      workflow_status: "已完成",
      linked_variant_count: 1,
      sync_ready_count: 1,
      closed_variant_count: 1,
      active_variant_count: 0
    }])), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("cleanup move quarantines only eligible candidates without deleting them", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-move-"));
  const quarantine = path.join(root, "quarantine");
  const eligible = path.join(root, "ready.mp4");
  const blocked = path.join(root, "blocked.mp4");
  fs.writeFileSync(eligible, "ready");
  fs.writeFileSync(blocked, "blocked");
  try {
    const moved = moveCleanupCandidates([
      { candidate_type: "playable_output", variantId: 5, path: eligible, eligible: true },
      { candidate_type: "playable_output", variantId: 6, path: blocked, eligible: false }
    ], { quarantineDir: quarantine });
    assert.equal(moved.moved.length, 1);
    assert.equal(moved.failed.length, 0);
    assert.equal(fs.existsSync(eligible), false);
    assert.equal(fs.existsSync(moved.moved[0].destination), true);
    assert.equal(fs.existsSync(blocked), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("cleanup move preserves a dotted directory basename before the ledger suffix", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-dotted-dir-"));
  const quarantine = path.join(root, "quarantine");
  const source = path.join(root, "Movie.2025.BluRay.7.1-Group");
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, "disc.iso"), "disc");
  try {
    const result = moveCleanupCandidates([{
      candidate_type: "source_input",
      sourceId: 1032,
      path: source,
      isDirectory: true,
      eligible: true
    }], { quarantineDir: quarantine });
    assert.equal(result.failed.length, 0);
    assert.equal(path.basename(result.moved[0].destination), "Movie.2025.BluRay.7.1-Group.source-1032");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup move records a locked candidate and continues", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-failure-"));
  const quarantine = path.join(root, "quarantine");
  const eligible = path.join(root, "ready.mp4");
  fs.writeFileSync(eligible, "ready");
  try {
    const result = moveCleanupCandidates([
      { candidate_type: "playable_output", variantId: 7, path: path.join(root, "missing.mp4"), eligible: true },
      { candidate_type: "playable_output", variantId: 8, path: eligible, eligible: true }
    ], { quarantineDir: quarantine });
    assert.equal(result.failed.length, 1);
    assert.equal(result.moved.length, 1);
    assert.equal(fs.existsSync(result.moved[0].destination), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("cleanup move resumes a non-conflicting partially moved source directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-partial-"));
  const source = path.join(root, "input", "source");
  const quarantine = path.join(root, "quarantine");
  const partial = path.join(quarantine, "source.source-43");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(partial, { recursive: true });
  fs.writeFileSync(path.join(source, "movie.mkv"), "video");
  fs.writeFileSync(path.join(partial, "cover.jpg"), "cover");
  try {
    const result = moveCleanupCandidates([{
      candidate_type: "source_input",
      sourceId: 43,
      path: source,
      isDirectory: true,
      eligible: true
    }], { quarantineDir: quarantine });
    assert.equal(result.failed.length, 0);
    assert.equal(result.moved.length, 1);
    assert.equal(result.moved[0].destination, partial);
    assert.equal(fs.existsSync(source), false);
    assert.equal(fs.readFileSync(path.join(partial, "movie.mkv"), "utf8"), "video");
    assert.equal(fs.readFileSync(path.join(partial, "cover.jpg"), "utf8"), "cover");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup move rejects a partially moved directory with path conflicts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-conflict-"));
  const source = path.join(root, "input", "source");
  const quarantine = path.join(root, "quarantine");
  const partial = path.join(quarantine, "source.source-43");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(partial, { recursive: true });
  fs.writeFileSync(path.join(source, "movie.mkv"), "new");
  fs.writeFileSync(path.join(partial, "movie.mkv"), "old");
  try {
    const result = moveCleanupCandidates([{
      candidate_type: "source_input",
      sourceId: 43,
      path: source,
      isDirectory: true,
      eligible: true
    }], { quarantineDir: quarantine });
    assert.equal(result.moved.length, 0);
    assert.equal(result.failed.length, 1);
    assert.match(result.failed[0].error, /conflicting entries/u);
    assert.equal(fs.readFileSync(path.join(source, "movie.mkv"), "utf8"), "new");
    assert.equal(fs.readFileSync(path.join(partial, "movie.mkv"), "utf8"), "old");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cleanup move skips duplicate logical records for one physical path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-duplicate-"));
  const quarantine = path.join(root, "quarantine");
  const source = path.join(root, "shared.mkv");
  fs.writeFileSync(source, "shared");
  try {
    const result = moveCleanupCandidates([
      { candidate_type: "source_input", sourceId: 10, path: source, eligible: true },
      { candidate_type: "source_input", sourceId: 11, path: source, eligible: true }
    ], { quarantineDir: quarantine });
    assert.equal(result.moved.length, 1);
    assert.equal(result.failed.length, 0);
    assert.deepEqual(result.skipped, [{ candidateType: "source_input", path: source, reason: "duplicate_physical_path" }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("quarantined playable output updates ledger path and records an event", () => {
  const calls = [];
  const db = { prepare: (sql) => ({ run: (...args) => calls.push({ sql, args }) }) };
  const moved = [{ candidateType: "playable_output", variantId: 42, path: "E:\\video_made\\ready.mp4", destination: "E:\\待人工删除\\ready.variant-42.mp4" }];
  recordMovedVariantPath(db, moved, "2026-08-26T00:00:00.000Z");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[0], "E:\\待人工删除\\ready.variant-42.mp4");
  assert.equal(calls[0].args[2], 42);
  assert.equal(calls[1].args[2], "output_quarantined");
  assert.equal(moved[0].ledgerUpdated, true);
});

test("quarantined source updates ledger path and records an event", () => {
  const calls = [];
  const db = { prepare: (sql) => ({ all: () => [{ id: 43 }], run: (...args) => calls.push({ sql, args }) }) };
  const moved = [{ candidateType: "source_input", sourceId: 43, path: "I:\\MAKE\\queue\\source", destination: "I:\\待人工删除\\source.source-43" }];
  recordMovedSourcePath(db, moved, "2026-08-26T00:00:00.000Z");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].args[0], "I:\\待人工删除\\source.source-43");
  assert.equal(calls[0].args[2], 43);
  assert.equal(calls[1].args[2], "source_quarantined");
  assert.equal(moved[0].ledgerUpdated, true);
});

test("quarantined source updates ledger paths for aliased physical sources", () => {
  const calls = [];
  const db = { prepare: (sql) => ({ all: () => [{ id: 43 }, { id: 44 }], run: (...args) => calls.push({ sql, args }) }) };
  const moved = [{ candidateType: "source_input", sourceId: 43, path: "I:\\MAKE\\queue\\shared", destination: "I:\\待人工删除\\shared.source-43" }];
  recordMovedSourcePath(db, moved, "2026-08-26T00:00:00.000Z");
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.filter((call) => call.args[0] === "I:\\待人工删除\\shared.source-43").map((call) => call.args[2]), [43, 44]);
  assert.deepEqual(calls.filter((call) => call.args[2] === "source_quarantined").map((call) => call.args[1]), [43, 44]);
  assert.equal(moved[0].ledgerUpdated, true);
});

test("failed source quarantine records the blocker for later cycle reporting", () => {
  const calls = [];
  const db = { prepare: () => ({ run: (...args) => calls.push(args) }) };
  const failed = [{ candidateType: "source_input", sourceId: 43, variantId: null, path: "I:\\MAKE\\queue\\source", errorCode: "EPERM", error: "file is in use" }];
  recordCleanupMoveFailures(db, failed, "2026-08-29T00:00:00.000Z");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "source");
  assert.equal(calls[0][1], 43);
  assert.equal(calls[0][2], "source_quarantine_failed");
  assert.equal(failed[0].ledgerRecorded, true);
});
