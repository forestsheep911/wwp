import assert from "node:assert/strict";
import test from "node:test";
import { classifyLocalMedia, flatSourceSlug, isDeferredRetainedCandidate, isPathWithinRoot, pendingDeletionPath, relatedFlatSources } from "./film-output-ledger-audit.mjs";

test("local output audit classifies playable, QC, and work artifacts", () => {
  assert.equal(classifyLocalMedia("Film.2025.mp4"), "playable_candidate");
  assert.equal(classifyLocalMedia("_qc/Film.subtitle-smoke.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("Film.sample.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("Film.sample.eng.chs.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("The.Wire.S03E09.diagnostic-60s.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("xiheyidainv.1952.subtitle-sync-check-680s.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("Thor.2013.smoke.s19.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("_workflow_tmp/smoke.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("shadow-chronicles.2006.smoke2.720p.h265.eng.chseng.mp4"), "qc_artifact");
  assert.equal(classifyLocalMedia("iron.man.2008.overlaycuda70.mkv"), "qc_artifact");
  assert.equal(classifyLocalMedia("iron.man.2008.thread-ac3.mkv"), "qc_artifact");
  assert.equal(classifyLocalMedia("iron.man.2008.tonemap-simple.mkv"), "qc_artifact");
  assert.equal(classifyLocalMedia("iron.man.2008.proper-no-sub.mkv"), "qc_artifact");
  assert.equal(classifyLocalMedia("Film.full.work.mkv"), "work_intermediate");
});

test("local output audit derives the cleanup tool pending-deletion destination", () => {
  assert.equal(
    pendingDeletionPath("E:\\video_made", { id: 862, output_path: "E:\\video_made\\movie.mp4" }),
    "E:\\待人工删除\\movie.variant-862.mp4"
  );
});

test("local output audit limits missing-path checks to the requested root", () => {
  assert.equal(isPathWithinRoot("E:/video_made/a.mp4", "E:/video_made"), true);
  assert.equal(isPathWithinRoot("E:/待人工删除/a.mp4", "E:/video_made"), false);
  assert.equal(isPathWithinRoot("F:/video_made/a.mp4", "E:/video_made"), false);
});

test("local output audit links flat-source clues without adopting a variant", () => {
  assert.equal(flatSourceSlug("@flat/[森中有林].all.the.good.eyes.2026"), "all.the.good.eyes.2026");
  assert.equal(flatSourceSlug("I:/MAKE/queue/film"), null);
  assert.deepEqual(
    relatedFlatSources("E:\\video_made\\all.the.good.eyes.2026.2160p.mp4", [{ slug: "all.the.good.eyes.2026", id: 177 }]),
    [{ slug: "all.the.good.eyes.2026", id: 177 }]
  );
});

test("local output audit separates deferred retained media from unresolved candidates", () => {
  const item = { exactVariantId: null, classification: "playable_candidate", flatSourceCandidates: [{ qualityState: "deferred" }] };
  assert.equal(isDeferredRetainedCandidate(item), true);
  assert.equal(isDeferredRetainedCandidate({ ...item, flatSourceCandidates: [{ qualityState: "unknown" }] }), false);
});
