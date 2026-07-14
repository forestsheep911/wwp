import assert from "node:assert/strict";
import test from "node:test";

import { browseResponseIsCurrent, shouldLoadBrowseRoute } from "../src/cinema/browse-state";

test("shouldLoadBrowseRoute does not repeat a route that is already loading", () => {
  assert.equal(shouldLoadBrowseRoute("movie:recent", "movie:recent"), false);
  assert.equal(shouldLoadBrowseRoute("movie:recent", "tv:recent"), true);
});

test("browseResponseIsCurrent rejects an older response for the same route", () => {
  assert.equal(browseResponseIsCurrent({ id: 2, key: "movie:recent" }, { id: 1, key: "movie:recent" }), false);
  assert.equal(browseResponseIsCurrent({ id: 2, key: "movie:recent" }, { id: 2, key: "movie:recent" }), true);
  assert.equal(browseResponseIsCurrent({ id: 2, key: "tv:recent" }, { id: 2, key: "movie:recent" }), false);
});
