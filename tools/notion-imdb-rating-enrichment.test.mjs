import assert from "node:assert/strict";
import test from "node:test";

import { planImdbRatingUpdates } from "./notion-imdb-rating-enrichment.mjs";

function emptyProperty(type) {
  if (type === "number") return { type, number: null };
  if (type === "date") return { type, date: null };
  if (type === "multi_select") return { type, multi_select: [] };
  if (type === "title") return { type, title: [{ plain_text: "The Prosecutor's Proposal Season 1 (2026)", text: { content: "The Prosecutor's Proposal Season 1 (2026)" } }] };
  return { type, rich_text: [] };
}

function filledRichText(value) {
  return { type: "rich_text", rich_text: [{ plain_text: value, text: { content: value } }] };
}

function pageWithProperties(overrides = {}) {
  return {
    id: "page-1",
    properties: {
      Title: emptyProperty("title"),
      "IMDb ID": filledRichText("tt43592244"),
      "IMDB评分": emptyProperty("number"),
      "Metadata Source": { type: "multi_select", multi_select: [{ name: "douban" }] },
      "Developer Memo": emptyProperty("rich_text"),
      "Metadata Updated At": emptyProperty("date"),
      ...overrides
    }
  };
}

test("planImdbRatingUpdates fills missing IMDB评分 from official IMDb fallback result", () => {
  const plan = planImdbRatingUpdates(
    pageWithProperties(),
    { id: "tt43592244", averageRating: 9.1, numVotes: 93, source: "imdb-datasets" },
    { now: "2026-07-10" }
  );

  assert.equal(plan.updates["IMDB评分"].number, 9.1);
  assert.deepEqual(plan.updates["Metadata Source"].multi_select.map((item) => item.name), ["douban", "imdb-datasets"]);
  assert.equal(plan.updates["Metadata Updated At"].date.start, "2026-07-10");
  assert.match(plan.evidenceMemo, /IMDB评分=9.1/);
  assert.match(plan.evidenceMemo, /93 votes/);
});

test("planImdbRatingUpdates does not overwrite existing IMDB评分", () => {
  const plan = planImdbRatingUpdates(
    pageWithProperties({ "IMDB评分": { type: "number", number: 8.8 } }),
    { id: "tt43592244", averageRating: 9.1, numVotes: 93, source: "imdb-datasets" },
    { now: "2026-07-10" }
  );

  assert.deepEqual(plan.updates, {});
  assert.equal(plan.updateFields.length, 0);
});

test("planImdbRatingUpdates skips null or missing IMDb fallback scores", () => {
  const plan = planImdbRatingUpdates(
    pageWithProperties(),
    { id: "tt43592244", averageRating: null, numVotes: null, source: null },
    { now: "2026-07-10" }
  );

  assert.deepEqual(plan.updates, {});
  assert.equal(plan.evidenceMemo, "");
});
