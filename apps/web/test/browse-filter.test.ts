import assert from "node:assert/strict";
import test from "node:test";
import { emptyBrowseFilter, filterBrowseResults, ratingForResult, yearForResult, type BrowseFilterState } from "../src/cinema/browse-filter";

const result = (overrides: Record<string, unknown> = {}) => ({
  assetKey: "movie-1",
  title: "示例电影",
  source: "test",
  sourceUrl: "",
  durationLabel: "2h",
  updatedAt: "2026-01-01T00:00:00.000Z",
  summary: "",
  metadata: {
    year: "2021",
    genres: ["剧情"],
    ratings: [{ label: "IMDb", value: "8.2" }],
    ...overrides
  },
  variants: [{ assetKey: "movie-1", label: "1080p", sourceUrl: "", kind: "video", summary: "", metadata: {
    availability: "playable",
    subtitleLanguages: ["简体中文"]
  } }]
});

test("reads the normalized year and strongest rating", () => {
  const item = result();
  assert.equal(yearForResult(item), 2021);
  assert.equal(ratingForResult(item), 8.2);
});

test("filters by decade, rating, and subtitle availability", () => {
  const filter: BrowseFilterState = { ...emptyBrowseFilter, decade: "2020s", rating: "8", availability: "subtitle" };
  assert.equal(filterBrowseResults([result()], filter, new Map()).length, 1);
  assert.equal(filterBrowseResults([result({ year: "1998" })], filter, new Map()).length, 0);
});

test("prepared filter uses tracked cache state", () => {
  const filter: BrowseFilterState = { ...emptyBrowseFilter, availability: "prepared" };
  const item = result();
  assert.equal(filterBrowseResults([item], filter, new Map()).length, 0);
  assert.equal(filterBrowseResults([item], filter, new Map([[item.assetKey, { job: { assetKey: item.assetKey } } as never]])).length, 1);
});
