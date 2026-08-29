import test from "node:test";
import assert from "node:assert/strict";
import { archiveEmptySpecDecision } from "./notion-archive-empty-spec-page.mjs";

function page(overrides = {}) {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    archived: false,
    in_trash: false,
    parent: { type: "page_id", page_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
    properties: { title: { type: "title", title: [{ plain_text: "Film English 4.3GB" }] } },
    ...overrides
  };
}

const expected = { parentPageId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", expectedTitle: "Film English 4.3GB" };

test("archives only an exact empty spec page", () => {
  assert.deepEqual(archiveEmptySpecDecision(page(), [], expected), {
    action: "archive", observedTitle: "Film English 4.3GB", childCount: 0
  });
});

test("rejects the wrong title, parent, or any child block", () => {
  assert.throws(() => archiveEmptySpecDecision(page(), [], { ...expected, expectedTitle: "Other" }), /title mismatch/u);
  assert.throws(() => archiveEmptySpecDecision(page(), [], { ...expected, parentPageId: "cccccccccccccccccccccccccccccccc" }), /parent mismatch/u);
  assert.throws(() => archiveEmptySpecDecision(page(), [{ id: "block", type: "video" }], expected), /not empty/u);
});

test("already archived pages are idempotent", () => {
  assert.equal(archiveEmptySpecDecision(page({ archived: true }), [], expected).action, "already_archived");
});
