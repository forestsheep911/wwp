import test from "node:test";
import assert from "node:assert/strict";
import { buildCandidates, parseArgs, parseWikidataBindings, propertyText, wikidataNeedsHistoricalReview } from "./notion-company-backfill.mjs";

test("buildCandidates keeps deterministic movie rows with exact IMDb IDs", () => {
  const index = { entries: {
    b: { title: "Series", sourcePageId: "series", sourceUpdatedAt: "2020-01-01", result: { metadata: { kind: "series", imdbId: "tt2222222" } } },
    c: { title: "Later", sourcePageId: "later", sourceUpdatedAt: "2021-01-01", result: { metadata: { kind: "movie", imdbId: "tt3333333" } } },
    a: { title: "Earlier", sourcePageId: "earlier", sourceUpdatedAt: "2019-01-01", result: { metadata: { kind: "movie", externalIds: { imdb: "https://www.imdb.com/title/tt1111111/" } } } }
  } };
  assert.deepEqual(buildCandidates(index, 2).map(({ pageId, imdbId }) => ({ pageId, imdbId })), [
    { pageId: "earlier", imdbId: "tt1111111" },
    { pageId: "later", imdbId: "tt3333333" }
  ]);
});

test("buildCandidates can bound a pilot to recent releases", () => {
  const index = { entries: {
    old: { title: "Old", sourcePageId: "old", result: { metadata: { kind: "movie", imdbId: "tt1111111", year: "1999" } } },
    recent: { title: "Recent", sourcePageId: "recent", result: { metadata: { kind: "movie", imdbId: "tt2222222", year: "2024" } } }
  } };
  assert.deepEqual(buildCandidates(index, 10, 2020).map((item) => item.pageId), ["recent"]);
});

test("parseArgs enforces the shared Notion limiter floor", () => {
  assert.throws(() => parseArgs(["--request-interval-ms", "999"]), /at least 1000/);
  assert.equal(parseArgs(["--limit", "7"]).limit, 7);
});

test("propertyText reads title and rich text", () => {
  assert.equal(propertyText({ type: "title", title: [{ plain_text: "Film" }] }), "Film");
  assert.equal(propertyText({ type: "rich_text", rich_text: [{ plain_text: "Studio" }] }), "Studio");
});

test("parseWikidataBindings groups and deduplicates P272 companies", () => {
  const bindings = [
    { imdb: { value: "tt1234567" }, company: { value: "http://www.wikidata.org/entity/Q1" }, companyLabel: { value: "Company A" } },
    { imdb: { value: "tt1234567" }, company: { value: "http://www.wikidata.org/entity/Q1" }, companyLabel: { value: "Company A" } },
    { imdb: { value: "tt1234567" }, company: { value: "http://www.wikidata.org/entity/Q2" }, companyLabel: { value: "Company B" } }
    ,{ imdb: { value: "tt1234567" }, company: { value: "http://www.wikidata.org/entity/Q3" }, companyLabel: { value: "Q3" } }
  ];
  assert.deepEqual(parseWikidataBindings(bindings).tt1234567.map((company) => company.name), ["Company A", "Company B"]);
});

test("Wikidata-only historical releases stop for credited-name review", () => {
  assert.equal(wikidataNeedsHistoricalReview("1959", ""), true);
  assert.equal(wikidataNeedsHistoricalReview("2021", ""), false);
  assert.equal(wikidataNeedsHistoricalReview("1959", "20th Century Fox"), false);
});
