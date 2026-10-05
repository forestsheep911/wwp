import assert from "node:assert/strict";
import test from "node:test";
import { correctionPlan, pageIsNestedUnderWork, parseArgs } from "./notion-spec-title-correction.mjs";

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

test("accepts a nested spec only when its Notion block ancestry reaches the exact work page", async () => {
  const options = parseArgs([
    "--work-page", "work",
    "--spec-page", "spec",
    "--expected-current", "Old",
    "--title", "New"
  ]);
  const nestedPage = {
    ...page("Old"),
    parent: { type: "block_id", block_id: "callout" }
  };
  const notion = {
    blocks: {
      async retrieve({ block_id }) {
        assert.equal(block_id, "callout");
        return { parent: { type: "page_id", page_id: "work" } };
      }
    }
  };
  assert.equal(await pageIsNestedUnderWork(notion, nestedPage, "work"), true);
  assert.equal(await pageIsNestedUnderWork(notion, nestedPage, "other-work"), false);
  assert.equal(correctionPlan(nestedPage, { ...options, validatedDescendant: true }).after, "New");
});

test("fixed-IP title correction requires a physical local address", () => {
  assert.throws(() => parseArgs([
    "--work-page", "work", "--spec-page", "spec",
    "--expected-current", "Old", "--title", "New",
    "--resolve-ip", "203.0.113.1"
  ]), /must be used together/u);
  const options = parseArgs([
    "--work-page", "work", "--spec-page", "spec",
    "--expected-current", "Old", "--title", "New",
    "--resolve-ip", "203.0.113.1", "--local-address", "192.168.1.22"
  ]);
  assert.equal(options.resolve_ip, "203.0.113.1");
  assert.equal(options.local_address, "192.168.1.22");
});
