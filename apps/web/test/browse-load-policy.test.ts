import assert from "node:assert/strict";
import test from "node:test";

import {
  browseAppendPageLimit,
  browseInitialVisibleCount,
  browseRequestDefaults,
  browseTspdtCatalogLimit
} from "../src/cinema/browse-load-policy";

test("ordinary browse routes request only the visible first shelf", () => {
  assert.equal(browseInitialVisibleCount, 12);
  for (const view of ["newGood", "recent", "popular", "topRated", "mostWatched", "doubanRank", "imdbRank", "rottenRank"] as const) {
    assert.deepEqual(browseRequestDefaults(view, false), { mode: "paged", limit: 12 });
  }
});

test("append requests retain the larger background page", () => {
  assert.equal(browseAppendPageLimit, 100);
  assert.deepEqual(browseRequestDefaults("newGood", true), { mode: "paged", limit: 100 });
  assert.deepEqual(browseRequestDefaults("popular", true), { mode: "paged", limit: 100 });
});

test("lucky and TSPDT retain their special initial request sizes", () => {
  assert.equal(browseTspdtCatalogLimit, 2_000);
  assert.deepEqual(browseRequestDefaults("lucky", false), { mode: "random", limit: 48 });
  assert.deepEqual(browseRequestDefaults("tspdtRank", false), { mode: "paged", limit: 2_000 });
});
