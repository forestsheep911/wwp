import assert from "node:assert/strict";
import test from "node:test";
import { browseFilterGenres, emptyBrowseFilter, filterBrowseResults, ratingForResult, yearForResult, type BrowseFilterState } from "../src/cinema/browse-filter";

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

test("filters by decade and the same 100-point composite rating shown on cards", () => {
  const filter: BrowseFilterState = { ...emptyBrowseFilter, decade: "2020s", rating: "90" };
  assert.equal(filterBrowseResults([result({ ratings: [{ label: "IMDb", value: "9.2" }] })], filter).length, 1);
  assert.equal(filterBrowseResults([result({ ratings: [{ label: "IMDb", value: "6.4" }] })], filter).length, 0);
  assert.equal(filterBrowseResults([result({ year: "1998", ratings: [{ label: "IMDb", value: "9.2" }] })], filter).length, 0);
});

test("splits twentieth-century results into explicit decades", () => {
  const nineties: BrowseFilterState = { ...emptyBrowseFilter, decade: "1990s" };
  const pre1950: BrowseFilterState = { ...emptyBrowseFilter, decade: "pre1950" };
  assert.equal(filterBrowseResults([result({ year: "1998" })], nineties).length, 1);
  assert.equal(filterBrowseResults([result({ year: "1989" })], nineties).length, 0);
  assert.equal(filterBrowseResults([result({ year: "1949" })], pre1950).length, 1);
  assert.equal(filterBrowseResults([result({ year: "1950" })], pre1950).length, 0);
});

test("public prepared uses shared catalog cache instead of personal tracked state", () => {
  const filter: BrowseFilterState = { ...emptyBrowseFilter, availability: "publicPrepared" };
  assert.equal(filterBrowseResults([result()], filter).length, 0);
  assert.equal(filterBrowseResults([{ ...result(), cache: { status: "ready" } as never }], filter).length, 1);
});

test("genre choices are complete and use AND semantics within the row", () => {
  const items = Array.from({ length: 14 }, (_, index) => result({ genres: [`题材${index + 1}`] }));
  assert.equal(browseFilterGenres(items).length, 14);
  const filter: BrowseFilterState = { ...emptyBrowseFilter, genres: ["喜剧", "科幻"] };
  assert.equal(filterBrowseResults([result({ genres: ["喜剧", "科幻", "剧情"] })], filter).length, 1);
  assert.equal(filterBrowseResults([result({ genres: ["科幻"] })], filter).length, 0);
  assert.equal(filterBrowseResults([result({ genres: ["剧情"] })], filter).length, 0);
});

test("kind adds a second-level media type filter", () => {
  const filter: BrowseFilterState = { ...emptyBrowseFilter, kind: "movie" };
  assert.equal(filterBrowseResults([result({ kind: "movie" })], filter).length, 1);
  assert.equal(filterBrowseResults([result({ kind: "series" })], filter).length, 0);
});
