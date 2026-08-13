import test from "node:test";
import assert from "node:assert/strict";
import { metadataReadbackDecision } from "./notion-metadata-task-sync.mjs";

function page(properties) {
  return { properties };
}

test("metadata task sync completes only an exact verified readback", () => {
  assert.equal(metadataReadbackDecision(page({
    "Metadata Status": { type: "select", select: { name: "verified" } },
    "Needs Review": { type: "checkbox", checkbox: false },
    "Human Issue": { type: "rich_text", rich_text: [] },
    "AI Issue": { type: "rich_text", rich_text: [] }
  })).verified, true);
});

test("metadata task sync preserves a page with an unresolved AI issue", () => {
  const decision = metadataReadbackDecision(page({
    "Metadata Status": { type: "select", select: { name: "partial" } },
    "Needs Review": { type: "checkbox", checkbox: true },
    "Human Issue": { type: "rich_text", rich_text: [] },
    "AI Issue": { type: "rich_text", rich_text: [{ plain_text: "缺集" }] }
  }));
  assert.equal(decision.verified, false);
  assert.equal(decision.aiIssue, "缺集");
});
