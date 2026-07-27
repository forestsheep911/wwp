import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectCleanupCandidates } from "./film-cleanup-candidates.mjs";

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
