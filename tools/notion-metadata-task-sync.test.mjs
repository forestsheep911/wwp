import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { metadataReadbackDecision, notionPageMissing } from "./notion-metadata-task-sync.mjs";

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

test("metadata task sync distinguishes deleted pages from other failures", () => {
  assert.equal(notionPageMissing({ code: "object_not_found", status: 404 }), true);
  assert.equal(notionPageMissing(new Error("Could not find page with ID: abc")), true);
  assert.equal(notionPageMissing({ code: "rate_limited", status: 429 }), false);
  assert.equal(notionPageMissing(new Error("fetch failed")), false);
});

test("metadata task sync keeps a shared one-request-per-second read interval", () => {
  const source = fs.readFileSync(new URL("./notion-metadata-task-sync.mjs", import.meta.url), "utf8");
  assert.match(source, /delayMs: 1000/u);
  assert.match(source, /options\.delayMs < 1000/u);
  assert.match(source, /setTimeout\(resolve, options\.delayMs\)/u);
});
