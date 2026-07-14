import assert from "node:assert/strict";
import test from "node:test";

import { browseCacheKey, browseCacheTtlMs, isFreshBrowseCacheEntry } from "../src/cinema/browse-cache";

test("browse cache entries expire after the configured TTL", () => {
  const now = 1_000_000;
  assert.equal(isFreshBrowseCacheEntry({ savedAt: now - browseCacheTtlMs, value: { value: 1 } }, now), true);
  assert.equal(isFreshBrowseCacheEntry({ savedAt: now - browseCacheTtlMs - 1, value: { value: 1 } }, now), false);
});

test("browse cache keys remain isolated by member and view", () => {
  assert.notEqual(
    browseCacheKey("member:one", "movie", "recent"),
    browseCacheKey("member:two", "movie", "recent")
  );
  assert.notEqual(
    browseCacheKey("member:one", "movie", "recent"),
    browseCacheKey("member:one", "movie", "topRated")
  );
});
