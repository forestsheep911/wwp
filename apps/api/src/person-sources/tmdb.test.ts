import assert from "node:assert/strict";
import test from "node:test";

import { ProviderRateLimiter } from "./provider-http.js";
import { TmdbPersonSource, tmdbCredits } from "./tmdb.js";

test("keeps top billed cast and scoped principal crew", () => {
  const credits = tmdbCredits({
    cast: [
      { id: 1, name: "Lead", character: "A", order: 0 },
      { id: 2, name: "Background", order: 20 }
    ],
    crew: [
      { id: 3, name: "Director", department: "Directing", job: "Director" },
      { id: 4, name: "Writer", department: "Writing", job: "Screenplay" },
      { id: 5, name: "Producer", department: "Production", job: "Producer" },
      { id: 6, name: "Assistant", department: "Production", job: "Production Assistant" }
    ]
  });

  assert.deepEqual(credits.map((credit) => [credit.name, credit.department, credit.job]), [
    ["Lead", "acting", "Actor"],
    ["Director", "directing", "Director"],
    ["Writer", "writing", "Screenplay"],
    ["Producer", "production", "Producer"]
  ]);
  assert.deepEqual(credits[0].externalIds, { tmdb: "1" });
});

test("maps TMDB person details into auditable evidence", async () => {
  const requested: string[] = [];
  const source = new TmdbPersonSource({
    token: "test-token",
    limiter: new ProviderRateLimiter(0),
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    fetchImpl: async (input, init) => {
      requested.push(String(input));
      assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-token");
      return Response.json({
        id: 287,
        name: "Brad Pitt",
        also_known_as: ["布拉德·皮特", "Brad Pitt"],
        biography: "Biography",
        birthday: "1963-12-18",
        profile_path: "/profile.jpg",
        external_ids: { imdb_id: "nm0000093", wikidata_id: "Q35332" }
      });
    }
  });

  const evidence = await source.fetchPersonEvidence("287");
  assert.deepEqual(evidence.externalIds, { tmdb: "287", imdb: "nm0000093", wikidata: "Q35332" });
  assert.deepEqual(evidence.names.map((entry) => entry.value), ["Brad Pitt", "布拉德·皮特"]);
  assert.equal(evidence.biography?.birthDate, "1963-12-18");
  assert.deepEqual(evidence.biography?.texts?.map((entry) => [entry.value, entry.language, entry.source]), [["Biography", "en", "tmdb"]]);
  assert.equal(evidence.images?.[0].url, "https://image.tmdb.org/t/p/original/profile.jpg");
  assert.match(requested[0], /append_to_response=external_ids/);
});

test("requires an explicit TMDB credential", () => {
  assert.throws(() => new TmdbPersonSource({ token: "", apiKey: "" }), /TMDB_API_READ_ACCESS_TOKEN/);
});
