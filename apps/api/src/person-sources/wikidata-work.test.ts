import assert from "node:assert/strict";
import test from "node:test";

import { ProviderRateLimiter } from "./provider-http.js";
import { WikidataWorkCreditsSource } from "./wikidata-work.js";

test("collects complete work relations while resolving people in a bounded batch", async () => {
  const requested: string[] = [];
  const source = new WikidataWorkCreditsSource({
    limiter: new ProviderRateLimiter(0),
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("Special:EntityData")) {
        return Response.json({ entities: { Q1: { claims: {
          P57: [{ mainsnak: { datavalue: { value: { id: "Q10" } } } }],
          P58: [{ mainsnak: { datavalue: { value: { id: "Q10" } } } }],
          P161: [{ mainsnak: { datavalue: { value: { id: "Q20" } } }, qualifiers: { P1545: [{ datavalue: { value: "1" } }] } }]
        } } } });
      }
      return Response.json({ entities: {
        Q10: { labels: { "zh-cn": { value: "导演甲" }, en: { value: "Director A" } }, claims: { P345: [{ mainsnak: { datavalue: { value: "nm0000010" } } }] } },
        Q20: { labels: { en: { value: "Actor B" }, ja: { value: "俳優B" } }, claims: { P4985: [{ mainsnak: { datavalue: { value: "20" } } }] } }
      } });
    }
  });

  const result = await source.fetchWorkCredits("q1");
  assert.equal(requested.length, 2);
  assert.deepEqual(result.credits.map((credit) => [credit.name, credit.department, credit.order]), [
    ["导演甲", "directing", undefined],
    ["导演甲", "writing", undefined],
    ["Actor B", "acting", 1]
  ]);
  assert.deepEqual(result.credits[0].externalIds, { imdb: "nm0000010", wikidata: "Q10" });
  assert.deepEqual(result.credits[2].externalIds, { tmdb: "20", wikidata: "Q20" });
});

test("rejects malformed work ids before requesting", async () => {
  const source = new WikidataWorkCreditsSource({ fetchImpl: async () => { throw new Error("unexpected"); } });
  await assert.rejects(source.fetchWorkCredits("not-a-qid"), /Invalid Wikidata work id/);
});
