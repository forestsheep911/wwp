import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResult } from "@wwpdw/shared";
import { explicitBrowseKind, resultMatchesBrowseChannel } from "./browse-channel";

function result(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    assetKey: "fallout-s02",
    title: "辐射 第二季 Fallout Season 2 (2025)",
    source: "notion",
    sourceUrl: "https://example.test/fallout-s02",
    metadata: {
      kind: "series",
      type: "TV Series",
      work: { kind: "series" }
    },
    ...overrides
  } as SearchResult;
}

test("explicit TV series metadata never enters the movie browse channel", () => {
  const fallout = result();
  assert.equal(explicitBrowseKind(fallout), "tv");
  assert.equal(resultMatchesBrowseChannel(fallout, "tv"), true);
  assert.equal(resultMatchesBrowseChannel(fallout, "movie"), false);
});

test("a typed series wins over movie-like title text", () => {
  const series = result({ title: "Movie Night: Example Season 2" });
  assert.equal(resultMatchesBrowseChannel(series, "tv"), true);
  assert.equal(resultMatchesBrowseChannel(series, "movie"), false);
});
