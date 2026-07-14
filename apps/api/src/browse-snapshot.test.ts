import assert from "node:assert/strict";
import test from "node:test";

import { BrowseSnapshotCache, defaultBrowseSnapshotTtlMs } from "./browse-snapshot";

test("browse snapshots survive a normal login and browsing session", () => {
  assert.equal(defaultBrowseSnapshotTtlMs, 10 * 60 * 1000);
});

test("BrowseSnapshotCache reuses a fresh snapshot and expires it deterministically", () => {
  const cache = new BrowseSnapshotCache<string>(1_000);
  cache.set("movie:recent", ["a", "b"], 10_000);

  assert.deepEqual(cache.get("movie:recent", 10_999), ["a", "b"]);
  assert.equal(cache.get("movie:recent", 11_001), undefined);
});

test("BrowseSnapshotCache deduplicates a cold snapshot load", async () => {
  const cache = new BrowseSnapshotCache<string>(1_000);
  let loads = 0;
  const load = () => cache.getOrLoad("all", async () => {
    loads += 1;
    return ["a", "b"];
  }, 10_000);

  const [first, second] = await Promise.all([load(), load()]);
  assert.deepEqual(first, ["a", "b"]);
  assert.deepEqual(second, ["a", "b"]);
  assert.equal(loads, 1);
});
