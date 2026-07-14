import assert from "node:assert/strict";
import test from "node:test";

import {
  criticPageHintsFromProperties,
  inspectOptionsFromPage,
  planCriticRatingUpdates
} from "./notion-critic-rating-enrichment.mjs";

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

test("planCriticRatingUpdates treats official search candidates as discovery only", () => {
  const plan = planCriticRatingUpdates(
    pageWithProperties(),
    {
      searchDiscovery: {
        source: "official-search-pages",
        rottenTomatoes: {
          candidates: [
            {
              title: "Zodiac",
              year: 2007,
              url: "https://www.rottentomatoes.com/m/zodiac",
              mediaType: "movie"
            }
          ]
        },
        metacritic: {
          candidates: [
            {
              title: "Zodiac",
              year: 2007,
              url: "https://www.metacritic.com/movie/zodiac",
              mediaType: "movie"
            }
          ]
        }
      }
    },
    { now: "2026-07-10" }
  );

  assert.deepEqual(plan.updates, {});
  assert.deepEqual(plan.discoveryOnly, true);
});

test("planCriticRatingUpdates treats generic official URL hints as discovery only", () => {
  const plan = planCriticRatingUpdates(
    pageWithProperties(),
    {
      urlHints: {
        source: "generic-official-url-hints",
        rottenTomatoes: {
          candidates: [
            {
              url: "https://www.rottentomatoes.com/m/zodiac",
              mediaType: "movie"
            }
          ]
        }
      }
    },
    { now: "2026-07-10" }
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

test("planCriticRatingUpdates appends evidence to existing Developer Memo", () => {
  const plan = planCriticRatingUpdates(
    pageWithProperties({
      "Developer Memo": filledRichText("Created from queue scan; keep hidden until playable media is verified.")
    }),
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
    { now: "2026-07-10" }
  );

  const memo = plan.updates["Developer Memo"].rich_text.map((item) => item.text.content).join("");
  assert.match(memo, /Created from queue scan/);
  assert.match(memo, /https:\/\/www\.rottentomatoes\.com\/m\/zodiac/);
  assert.match(memo, /https:\/\/www\.metacritic\.com\/movie\/zodiac/);
});

test("criticPageHintsFromProperties reuses official critic URLs from Notion text", () => {
  const hints = criticPageHintsFromProperties(
    pageWithProperties({
      "Developer Memo": filledRichText(
        "Critic rating fallback: 烂番茄新鲜度=90 (rotten-tomatoes-page, https://www.rottentomatoes.com/m/zodiac/reviews); Metascore=79 (metacritic-page, https://www.metacritic.com/movie/zodiac/critic-reviews/)"
      )
    }).properties
  );

  assert.equal(hints.rottenUrl, "https://www.rottentomatoes.com/m/zodiac");
  assert.equal(hints.metacriticUrl, "https://www.metacritic.com/movie/zodiac");
});

test("criticPageHintsFromProperties ignores search pages and mirrors", () => {
  const hints = criticPageHintsFromProperties(
    pageWithProperties({
      "Developer Memo": filledRichText(
        "https://www.rottentomatoes.com/search?search=Zodiac https://example.com/movie/zodiac https://www.metacritic.com/search/Zodiac/"
      )
    }).properties
  );

  assert.deepEqual(hints, {});
});

test("inspectOptionsFromPage passes source URLs when saved HTML paths are used", () => {
  const options = inspectOptionsFromPage(
    {
      rottenUrl: "C:\\tmp\\rt.html",
      metacriticUrl: "C:\\tmp\\mc.html"
    },
    pageWithProperties({
      "Developer Memo": filledRichText(
        "RT https://www.rottentomatoes.com/m/zodiac/reviews MC https://www.metacritic.com/movie/zodiac/critic-reviews/"
      )
    })
  );

  assert.equal(options.rottenUrl, "C:\\tmp\\rt.html");
  assert.equal(options.metacriticUrl, "C:\\tmp\\mc.html");
  assert.equal(options.rottenSourceUrl, "https://www.rottentomatoes.com/m/zodiac");
  assert.equal(options.metacriticSourceUrl, "https://www.metacritic.com/movie/zodiac");
});

test("inspectOptionsFromPage passes official search discovery options", () => {
  const options = inspectOptionsFromPage(
    {
      discoverSearch: true,
      rottenSearchUrl: "C:\\tmp\\rt-search.html",
      metacriticSearchUrl: "C:\\tmp\\mc-search.html"
    },
    pageWithProperties()
  );

  assert.equal(options.discoverSearch, true);
  assert.equal(options.rottenSearchUrl, "C:\\tmp\\rt-search.html");
  assert.equal(options.metacriticSearchUrl, "C:\\tmp\\mc-search.html");
});

test("inspectOptionsFromPage passes generic URL hint discovery input", () => {
  const options = inspectOptionsFromPage(
    {
      urlHints: "C:\\tmp\\search-results.html"
    },
    pageWithProperties()
  );

  assert.equal(options.urlHints, "C:\\tmp\\search-results.html");
});

test("inspectOptionsFromPage includes title and year for official search discovery even when IMDb ID exists", () => {
  const options = inspectOptionsFromPage(
    {
      discoverSearch: true
    },
    pageWithProperties({
      "English Title": filledRichText("The Prosecutor's Proposal"),
      "Release Year": { type: "number", number: 2026 }
    })
  );

  assert.equal(options.imdbId, "tt0443706");
  assert.equal(options.discoverSearch, true);
  assert.equal(options.title, "The Prosecutor's Proposal");
  assert.equal(options.year, "2026");
});

test("inspectOptionsFromPage only infers a title year from the terminal parenthesized year", () => {
  for (const [title, expected] of [
    ["2046 (2004)", "2004"],
    ["2001太空漫游 2001: A Space Odyssey (1968)", "1968"],
    ["银翼杀手2049 Blade Runner 2049 (2017)", "2017"],
    ["1917", undefined],
  ]) {
    const page = pageWithProperties({
      Title: { type: "title", title: [{ plain_text: title, text: { content: title } }] },
      "Release Year": emptyProperty("number"),
    });
    const options = inspectOptionsFromPage({ discoverSearch: true }, page);
    assert.equal(options.year, expected, title);
  }
});
