import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import test from "node:test";

import {
  buildOfficialSearchUrls,
  normalizeStructuredRatingEvidence,
  parseImdbMetascorePage,
  parseMetacriticPage,
  parseRottenTomatoesPage,
  parseWikidataCriticIds
} from "./critic-rating-inspect.mjs";

const execFileAsync = promisify(execFile);

test("parses Rotten Tomatoes media scorecard JSON", () => {
  const html = `
    <media-scorecard-manager>
      <script id="media-scorecard-json" data-json="mediaScorecard" type="application/json">
        {"criticsScore":{"averageRating":"7.90","certified":true,"ratingCount":209,"reviewCount":209,"score":"83","scorePercent":"83%","title":"Tomatometer"}}
      </script>
    </media-scorecard-manager>`;

  assert.deepEqual(parseRottenTomatoesPage(html), {
    score: 83,
    reviewCount: 209,
    averageRating: 7.9,
    certified: true
  });
});

test("parses Rotten Tomatoes official score-board fallback", () => {
  const html = `
    <score-board
      tomatometerscore="83"
      tomatometerstate="certified-fresh"
      tomatometerreviewcount="209">
    </score-board>`;

  assert.deepEqual(parseRottenTomatoesPage(html), {
    score: 83,
    reviewCount: 209,
    certified: true
  });
});

test("parses Rotten Tomatoes official JSON-LD aggregate rating fallback", () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Movie",
        "name": "Zodiac",
        "aggregateRating": {
          "@type": "AggregateRating",
          "name": "Tomatometer",
          "bestRating": "100",
          "ratingValue": "90",
          "reviewCount": "264"
        }
      }
    </script>`;

  assert.deepEqual(parseRottenTomatoesPage(html), {
    score: 90,
    reviewCount: 264
  });
});

test("parses Metacritic global metascore markup", () => {
  const html = `
    <div title="Metascore 73 out of 100" aria-label="Metascore 73 out of 100" data-testid="global-score-value-wrapper">
      <span data-testid="global-score-value">73</span>
    </div>
    <a href="/movie/the-matrix/critic-reviews/">Based on 36 Critic Reviews</a>`;

  assert.deepEqual(parseMetacriticPage(html), {
    score: 73,
    reviewCount: 36
  });
});

test("parses Metacritic legacy metascore markup", () => {
  const html = `
    <span class="metascore_w larger movie positive">73</span>
    <span>based on 36 Critic Reviews</span>`;

  assert.deepEqual(parseMetacriticPage(html), {
    score: 73,
    reviewCount: 36
  });
});

test("parses Metacritic official JSON-LD aggregate rating fallback", () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Movie",
        "name": "Zodiac",
        "aggregateRating": {
          "@type": "AggregateRating",
          "name": "Metascore",
          "bestRating": 100,
          "ratingValue": 79,
          "reviewCount": 40
        }
      }
    </script>`;

  assert.deepEqual(parseMetacriticPage(html), {
    score: 79,
    reviewCount: 40
  });
});

test("parses Metascore from IMDb official page markup", () => {
  const html = `
    <section data-testid="metacritic-score-section">
      <a href="/title/tt0133093/criticreviews/">
        <span aria-label="Metascore 73 out of 100">73</span>
      </a>
    </section>`;

  assert.deepEqual(parseImdbMetascorePage(html), {
    score: 73
  });
});

test("builds official critic-site search URLs from title and year", () => {
  assert.deepEqual(buildOfficialSearchUrls({ title: "The Prosecutor's Proposal", year: 2026 }), {
    rottenTomatoes: "https://www.rottentomatoes.com/search?search=The%20Prosecutor%27s%20Proposal%202026",
    metacritic: "https://www.metacritic.com/search/The%20Prosecutor%27s%20Proposal%202026/"
  });
});

test("parses Wikidata critic external IDs into official page URLs", () => {
  const payload = {
    results: {
      bindings: [
        {
          item: { value: "http://www.wikidata.org/entity/Q202564" },
          itemLabel: { value: "Zodiac" },
          rottenTomatoesId: { value: "m/zodiac" },
          metacriticId: { value: "movie/zodiac" }
        }
      ]
    }
  };

  assert.deepEqual(parseWikidataCriticIds(payload), {
    candidates: [
      {
        item: "http://www.wikidata.org/entity/Q202564",
        label: "Zodiac",
        rottenTomatoesId: "m/zodiac",
        rottenTomatoesUrl: "https://www.rottentomatoes.com/m/zodiac",
        metacriticId: "movie/zodiac",
        metacriticUrl: "https://www.metacritic.com/movie/zodiac"
      }
    ],
    rottenTomatoesUrl: "https://www.rottentomatoes.com/m/zodiac",
    metacriticUrl: "https://www.metacritic.com/movie/zodiac"
  });
});

test("normalizes trusted structured critic rating evidence", () => {
  assert.deepEqual(
    normalizeStructuredRatingEvidence({
      rottenTomatoes: {
        score: "91%",
        reviewCount: "120",
        source: "licensed-source:rt-export",
        url: "https://www.rottentomatoes.com/m/example",
        observedAt: "2026-07-10"
      },
      metascore: {
        score: 74,
        source: "manual-evidence:metacritic-page-check",
        sourceUrl: "https://www.metacritic.com/movie/example"
      }
    }),
    {
      rottenTomatoes: {
        score: 91,
        reviewCount: 120,
        source: "licensed-source:rt-export",
        url: "https://www.rottentomatoes.com/m/example",
        observedAt: "2026-07-10"
      },
      metacritic: {
        score: 74,
        source: "manual-evidence:metacritic-page-check",
        url: "https://www.metacritic.com/movie/example"
      }
    }
  );
});

test("rejects structured critic rating evidence without a trusted source label", () => {
  assert.throws(
    () => normalizeStructuredRatingEvidence({ rottenTomatoes: { score: 91, source: "search-snippet" } }),
    /requires source/
  );
});

test("CLI reads local official-page HTML fixtures", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wwp-critic-ratings-"));
  try {
    const rtFixture = path.join(dir, "rt.html");
    const mcFixture = path.join(dir, "mc.html");
    await writeFile(rtFixture, `<script id="media-scorecard-json" type="application/json">{"criticsScore":{"score":"83","reviewCount":209,"averageRating":"7.90","certified":true}}</script>`, "utf8");
    await writeFile(mcFixture, `<div title="Metascore 73 out of 100" aria-label="Metascore 73 out of 100"><span data-testid="global-score-value">73</span></div><a>Based on 36 Critic Reviews</a>`, "utf8");

    const script = path.resolve(".codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "--rotten-url",
      rtFixture,
      "--metacritic-url",
      mcFixture
    ]);

    assert.deepEqual(JSON.parse(stdout), {
      rottenTomatoes: {
        score: 83,
        reviewCount: 209,
        averageRating: 7.9,
        certified: true,
        source: "rotten-tomatoes-page"
      },
      metacritic: {
        score: 73,
        reviewCount: 36,
        source: "metacritic-page"
      }
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("CLI reads trusted structured critic rating evidence JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wwp-critic-ratings-"));
  try {
    const evidenceFixture = path.join(dir, "ratings.json");
    await writeFile(
      evidenceFixture,
      JSON.stringify({
        rottenTomatoes: {
          score: 88,
          reviewCount: 90,
          source: "licensed-source:rt-export",
          url: "https://www.rottentomatoes.com/m/example"
        },
        metacritic: {
          score: 71,
          source: "manual-evidence:metacritic-page-check",
          url: "https://www.metacritic.com/movie/example"
        }
      }),
      "utf8"
    );

    const script = path.resolve(".codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "--ratings-json",
      evidenceFixture
    ]);

    assert.deepEqual(JSON.parse(stdout), {
      rottenTomatoes: {
        score: 88,
        reviewCount: 90,
        source: "licensed-source:rt-export",
        url: "https://www.rottentomatoes.com/m/example"
      },
      metacritic: {
        score: 71,
        source: "manual-evidence:metacritic-page-check",
        url: "https://www.metacritic.com/movie/example"
      }
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("CLI reads IMDb official-page Metascore fallback from local HTML", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wwp-critic-ratings-"));
  try {
    const imdbFixture = path.join(dir, "imdb.html");
    await writeFile(imdbFixture, `<span aria-label="Metascore 73 out of 100">73</span>`, "utf8");

    const script = path.resolve(".codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "--imdb-url",
      imdbFixture
    ]);

    assert.deepEqual(JSON.parse(stdout), {
      metacritic: {
        score: 73,
        source: "imdb-page-metascore"
      }
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("CLI can emit official search URLs when critic IDs are missing", async () => {
  const script = path.resolve(".codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs");
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    "--title",
    "Zodiac",
    "--year",
    "2007",
    "--search-only"
  ]);

  assert.deepEqual(JSON.parse(stdout), {
    officialSearch: {
      rottenTomatoes: "https://www.rottentomatoes.com/search?search=Zodiac%202007",
      metacritic: "https://www.metacritic.com/search/Zodiac%202007/"
    }
  });
});

test("CLI can discover official critic page URLs from saved Wikidata JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wwp-critic-ratings-"));
  try {
    const wikidataFixture = path.join(dir, "wikidata.json");
    await writeFile(
      wikidataFixture,
      JSON.stringify({
        results: {
          bindings: [
            {
              item: { value: "http://www.wikidata.org/entity/Q202564" },
              itemLabel: { value: "Zodiac" },
              rottenTomatoesId: { value: "m/zodiac" },
              metacriticId: { value: "movie/zodiac" }
            }
          ]
        }
      }),
      "utf8"
    );

    const script = path.resolve(".codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs");
    const { stdout } = await execFileAsync(process.execPath, [
      script,
      "--wikidata-json",
      wikidataFixture,
      "--discover-only"
    ]);

    assert.deepEqual(JSON.parse(stdout), {
      discovery: {
        source: "wikidata-json",
        candidates: [
          {
            item: "http://www.wikidata.org/entity/Q202564",
            label: "Zodiac",
            rottenTomatoesId: "m/zodiac",
            rottenTomatoesUrl: "https://www.rottentomatoes.com/m/zodiac",
            metacriticId: "movie/zodiac",
            metacriticUrl: "https://www.metacritic.com/movie/zodiac"
          }
        ],
        rottenTomatoesUrl: "https://www.rottentomatoes.com/m/zodiac",
        metacriticUrl: "https://www.metacritic.com/movie/zodiac"
      }
    });
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
