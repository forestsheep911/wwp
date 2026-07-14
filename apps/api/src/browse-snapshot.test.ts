import assert from "node:assert/strict";
import test from "node:test";

import { BrowseSnapshotCache } from "./browse-snapshot";

test("BrowseSnapshotCache reuses a fresh snapshot and expires it deterministically", () => {
  const cache = new BrowseSnapshotCache<string>(1_000);
  cache.set("movie:recent", ["a", "b"], 10_000);

  assert.deepEqual(cache.get("movie:recent", 10_999), ["a", "b"]);
  assert.equal(cache.get("movie:recent", 11_001), undefined);
});
