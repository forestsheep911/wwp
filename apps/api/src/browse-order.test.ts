import assert from "node:assert/strict";
import test from "node:test";

import type { SearchResult } from "@wwpdw/shared";
import { stableBrowseTie } from "./browse-order";

function result(assetKey: string): SearchResult {
  return {
    assetKey,
    title: assetKey,
    source: "test",
    sourceUrl: `https://example.local/${assetKey}`,
    durationLabel: "",
    updatedAt: "2026-07-14T00:00:00.000Z",
    summary: ""
  };
}

test("stableBrowseTie orders otherwise equal browse rows by assetKey", () => {
  assert.deepEqual(
    [result("work-c"), result("work-a"), result("work-b")].sort(stableBrowseTie).map((item) => item.assetKey),
    ["work-a", "work-b", "work-c"]
  );
});
