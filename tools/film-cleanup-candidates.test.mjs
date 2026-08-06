import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectCleanupCandidates, collectSourceCleanupCandidates, moveCleanupCandidates } from "./film-cleanup-candidates.mjs";

function mockDb(rows) {
  return { prepare: () => ({ all: () => rows }) };
}

test("cleanup report accepts only sync-ready files with matching ledger size", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-"));
  const filePath = path.join(root, "ready.mp4");
  fs.writeFileSync(filePath, "ready");
  try {
    const rows = [{
      variant_id: 1,
      output_path: filePath,
      output_size_bytes: 5,
      publication_state: "sync_ready",
      canonical_title: "Ready"
    }];
    assert.deepEqual(collectCleanupCandidates(mockDb(rows), root), [{
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
      { variant_id: 2, output_path: inside, output_size_bytes: 99, publication_state: "sync_ready", canonical_title: "Mismatch" },
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

test("cleanup report preserves a sync-ready local file when the work awaits human confirmation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-cleanup-"));
  const filePath = path.join(root, "human-gate.mp4");
  fs.writeFileSync(filePath, "ready");
  try {
    const [candidate] = collectCleanupCandidates(mockDb([{
      variant_id: 4,
      output_path: filePath,
      output_size_bytes: 5,
      publication_state: "sync_ready",
      canonical_title: "Human gate",
      workflow_status: "待人工确认"
    }]), root);
    assert.equal(candidate.eligible, false);
    assert.deepEqual(candidate.reasons, ["human_workflow_gate"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    assert.equal(moved.length, 1);
    assert.equal(fs.existsSync(eligible), false);
    assert.equal(fs.existsSync(moved[0].destination), true);
    assert.equal(fs.existsSync(blocked), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
