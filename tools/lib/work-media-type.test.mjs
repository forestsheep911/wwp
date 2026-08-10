import test from "node:test";
import assert from "node:assert/strict";
import { compareNotionMediaType, expectedNotionMediaType } from "./work-media-type.mjs";

test("ledger work type maps to the exact Notion media type", () => {
  assert.equal(expectedNotionMediaType("movie"), "Movie");
  assert.equal(expectedNotionMediaType("series"), "TV Series");
  assert.throws(() => expectedNotionMediaType("episode"), /Unsupported ledger work type/);
});

test("media type comparison fails closed for missing or mismatched values", () => {
  assert.deepEqual(compareNotionMediaType("series", "Movie"), {
    expected: "TV Series",
    actual: "Movie",
    matches: false
  });
  assert.deepEqual(compareNotionMediaType("movie", null), {
    expected: "Movie",
    actual: null,
    matches: false
  });
});
