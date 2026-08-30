import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResult } from "@wwpdw/shared";
import { browseCatalogRevision, resolveBrowseOffset } from "./browse-pagination.js";

function result(assetKey: string, updatedAt: string): SearchResult {
  return {
    assetKey,
    title: assetKey,
    source: "test",
    sourceUrl: `https://example.test/${assetKey}`,
    durationLabel: "1h",
    summary: assetKey,
    updatedAt
  };
}

test("catalog revision changes when a newly indexed title enters the browse order", () => {
  const before = [result("a", "2026-08-29T00:00:00.000Z"), result("b", "2026-08-28T00:00:00.000Z")];
  const after = [result("new", "2026-08-30T00:00:00.000Z"), ...before];
  assert.notEqual(browseCatalogRevision(before), browseCatalogRevision(after));
});

test("stale append pagination resets to the first page", () => {
  assert.deepEqual(resolveBrowseOffset({
    requestedOffset: 12,
    requestedRevision: "old",
    currentRevision: "new"
  }), { offset: 0, reset: true });
});

test("matching and legacy pagination keep the requested offset", () => {
  assert.deepEqual(resolveBrowseOffset({
    requestedOffset: 12,
    requestedRevision: "same",
    currentRevision: "same"
  }), { offset: 12, reset: false });
  assert.deepEqual(resolveBrowseOffset({
    requestedOffset: 12,
    currentRevision: "new"
  }), { offset: 12, reset: false });
});
