import assert from "node:assert/strict";
import test from "node:test";
import { validateHighlightDraft, type WorkHighlightDraft } from "./work-highlight.js";

const draft: WorkHighlightDraft = {
  workId: "wwm_test",
  snapshotVersion: "snapshot-1",
  generatedAt: "2026-09-05T00:00:00.000Z",
  candidates: [{
    category: "formal-construction", label: "私人档案叙事", reason: "将个人影像档案组织成公共历史。",
    evidenceRefs: ["https://example.test/source"], score: { specificity: 2, viewerValue: 2, concreteness: 2, evidence: 2, wording: 1 },
    confidence: 0.9, status: "draft"
  }]
};

test("accepts a sourced draft above the seven-point gate", () => {
  assert.deepEqual(validateHighlightDraft(draft), { valid: true, errors: [], retained: 1 });
});

test("rejects more than three retained highlights and weak unsupported claims", () => {
  const invalid = structuredClone(draft);
  invalid.candidates = Array.from({ length: 4 }, (_, index) => ({
    ...structuredClone(draft.candidates[0]), label: `标签${index}`, evidenceRefs: [],
    score: { specificity: 1, viewerValue: 1, concreteness: 1, evidence: 0, wording: 1 }
  }));
  const result = validateHighlightDraft(invalid);
  assert.ok(result.errors.includes("retained_limit_exceeded"));
  assert.ok(result.errors.some((error) => error.startsWith("score_below_draft_gate")));
  assert.ok(result.errors.some((error) => error.startsWith("missing_evidence")));
});
