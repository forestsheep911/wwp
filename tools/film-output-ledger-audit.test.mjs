import assert from "node:assert/strict";
import test from "node:test";
import { classifyLocalMedia, flatSourceSlug, pendingDeletionPath, relatedFlatSources } from "./film-output-ledger-audit.mjs";

test("local output audit classifies playable, QC, and work artifacts", () => {
  assert.equal(classifyLocalMedia("Film.2025.mp4"), "playable_candidate");
  assert.equal(classifyLocalMedia("_qc/Film.subtitle-smoke.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("Film.sample.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("The.Wire.S03E09.diagnostic-60s.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("Film.full.work.mkv"), "work_intermediate");
});

test("local output audit derives the cleanup tool pending-deletion destination", () => {
  assert.equal(
    pendingDeletionPath("E:\\video_made", { id: 862, output_path: "E:\\video_made\\movie.mp4" }),
    "E:\\待人工删除\\movie.variant-862.mp4"
  );
});

test("local output audit links flat-source clues without adopting a variant", () => {
  assert.equal(flatSourceSlug("@flat/[森中有林].all.the.good.eyes.2026"), "all.the.good.eyes.2026");
  assert.equal(flatSourceSlug("I:/MAKE/queue/film"), null);
  assert.deepEqual(
    relatedFlatSources("E:\\video_made\\all.the.good.eyes.2026.2160p.mp4", [{ slug: "all.the.good.eyes.2026", id: 177 }]),
    [{ slug: "all.the.good.eyes.2026", id: 177 }]
  );
});
