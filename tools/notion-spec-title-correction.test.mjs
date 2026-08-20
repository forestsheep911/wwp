import assert from "node:assert/strict";
import test from "node:test";
import { correctionPlan, parseArgs } from "./notion-spec-title-correction.mjs";

function page(title, parent = "work") {
  return {
    parent: { type: "page_id", page_id: parent },
    properties: { title: { type: "title", title: [{ plain_text: title }] } }
  };
}

test("builds an exact guarded title correction", () => {
  const options = parseArgs([
    "--work-page", "work",
    "--spec-page", "spec",
    "--expected-current", "Old",
    "--title", "New"
  ]);
  assert.deepEqual(correctionPlan(page("Old"), options), {
    workPageId: "work",
    specPageId: "spec",
    titleProperty: "title",
    before: "Old",
    after: "New"
  });
});

test("refuses a stale title or wrong parent", () => {
  const options = parseArgs([
    "--work-page", "work",
    "--spec-page", "spec",
    "--expected-current", "Old",
    "--title", "New"
  ]);
  assert.throws(() => correctionPlan(page("Changed"), options), /current title mismatch/u);
  assert.throws(() => correctionPlan(page("Old", "other"), options), /not a direct child/u);
});
