import assert from "node:assert/strict";
import test from "node:test";

import { planCriticRatingUpdates } from "./notion-critic-rating-enrichment.mjs";

function emptyProperty(type) {
  if (type === "number") return { type, number: null };
  if (type === "date") return { type, date: null };
  if (type === "multi_select") return { type, multi_select: [] };
  if (type === "checkbox") return { type, checkbox: false };
  if (type === "url") return { type, url: null };
  if (type === "title") return { type, title: [{ plain_text: "Zodiac (2007)", text: { content: "Zodiac (2007)" } }] };
  return { type, rich_text: [] };
}

function filledRichText(value) {
  return { type: "rich_text", rich_text: [{ plain_text: value, text: { content: value } }] };
}

function pageWithProperties(overrides = {}) {
  return {
    id: "page-1",
    url: "https://notion.example/page-1",
    properties: {
      Title: emptyProperty("title"),
      "IMDb ID": filledRichText("tt0443706"),
      "Release Year": { type: "number", number: 2007 },
      "IMDB评分": emptyProperty("number"),
      Metascore: emptyProperty("number"),
      "烂番茄新鲜度": emptyProperty("number"),
      "Metadata Source": { type: "multi_select", multi_select: [{ name: "omdb" }] },
      "Developer Memo": emptyProperty("rich_text"),
      "Metadata Updated At": emptyProperty("date"),
      ...overrides
    }
  };
}

test("planCriticRatingUpdates fills missing Rotten Tomatoes and Metascore from verified fallback results", () => {
  const plan = planCriticRatingUpdates(
    pageWithProperties(),
    {
      rottenTomatoes: {
        score: 90,
        reviewCount: 267,
        source: "rotten-tomatoes-page",
        url: "https://www.rottentomatoes.com/m/zodiac"
      },
      metacritic: {
        score: 79,
        reviewCount: 40,
        source: "metacritic-page",
        url: "https://www.metacritic.com/movie/zodiac"
      }
    },
    { now: "2026-07-09" }
  );

  assert.equal(plan.updates["烂番茄新鲜度"].number, 90);
  assert.equal(plan.updates.Metascore.number, 79);
  assert.deepEqual(plan.updates["Metadata Source"].multi_select.map((item) => item.name), [
    "omdb",
    "rotten-tomatoes-page",
    "metacritic-page"
  ]);
  assert.equal(plan.updates["Metadata Updated At"].date.start, "2026-07-09");
  assert.match(plan.evidenceMemo, /rotten-tomatoes-page/);
  assert.match(plan.evidenceMemo, /metacritic-page/);
});

test("planCriticRatingUpdates does not overwrite existing critic scores", () => {
  const plan = planCriticRatingUpdates(
    pageWithProperties({
      Metascore: { type: "number", number: 80 },
      "烂番茄新鲜度": { type: "number", number: 91 }
    }),
    {
      rottenTomatoes: { score: 90, source: "rotten-tomatoes-page" },
      metacritic: { score: 79, source: "metacritic-page" }
    },
    { now: "2026-07-09" }
  );

  assert.equal(plan.updates["烂番茄新鲜度"], undefined);
  assert.equal(plan.updates.Metascore, undefined);
  assert.equal(plan.updateFields.length, 0);
});

test("planCriticRatingUpdates treats search URLs as discovery only", () => {
  const plan = planCriticRatingUpdates(
    pageWithProperties(),
    {
      officialSearch: {
        rottenTomatoes: "https://www.rottentomatoes.com/search?search=Zodiac%202007",
        metacritic: "https://www.metacritic.com/search/Zodiac%202007/"
      }
    },
    { now: "2026-07-09" }
  );

  assert.deepEqual(plan.updates, {});
  assert.deepEqual(plan.discoveryOnly, true);
});

test("planCriticRatingUpdates skips null critic scores", () => {
  const plan = planCriticRatingUpdates(
    pageWithProperties(),
    {
      rottenTomatoes: { score: null, source: null },
      metacritic: { score: null, source: null }
    },
    { now: "2026-07-10" }
  );

  assert.deepEqual(plan.updates, {});
  assert.equal(plan.updateFields.length, 0);
});

test("planCriticRatingUpdates preserves licensed and manual critic sources", () => {
  const plan = planCriticRatingUpdates(
    pageWithProperties(),
    {
      rottenTomatoes: {
        score: 88,
        source: "licensed-source:rt-export",
        url: "https://www.rottentomatoes.com/m/example"
      },
      metacritic: {
        score: 71,
        source: "manual-evidence:metacritic-page-check",
        url: "https://www.metacritic.com/movie/example"
      }
    },
    { now: "2026-07-10" }
  );

  assert.deepEqual(plan.updates["Metadata Source"].multi_select.map((item) => item.name), [
    "omdb",
    "licensed-source:rt-export",
    "manual-evidence:metacritic-page-check"
  ]);
  assert.match(plan.evidenceMemo, /licensed-source:rt-export/);
  assert.match(plan.evidenceMemo, /manual-evidence:metacritic-page-check/);
});
