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
          P345: [{ mainsnak: { datavalue: { value: "tt0000001" } } }],
          P4947: [{ mainsnak: { datavalue: { value: "101" } } }],
          P58: [{ mainsnak: { datavalue: { value: { id: "Q10" } } } }],
          P161: [{ mainsnak: { datavalue: { value: { id: "Q20" } } }, qualifiers: { P1545: [{ datavalue: { value: "1" } }] } }],
          P725: [{ mainsnak: { datavalue: { value: { id: "Q30" } } }, qualifiers: { P1545: [{ datavalue: { value: "2" } }] } }]
        } } } });
      }
      return Response.json({ entities: {
        Q10: { labels: { "zh-cn": { value: "导演甲" }, en: { value: "Director A" } }, claims: { P345: [{ mainsnak: { datavalue: { value: "nm0000010" } } }] } },
        Q20: { labels: { en: { value: "Actor B" }, ja: { value: "俳優B" } }, claims: { P4985: [{ mainsnak: { datavalue: { value: "20" } } }] } },
        Q30: { labels: { "zh-cn": { value: "配音员丙" }, en: { value: "Voice Actor C" } }, claims: { P345: [{ mainsnak: { datavalue: { value: "nm0000030" } } }] } }
      } });
    }
  });

  const result = await source.fetchWorkCredits("q1");
  assert.equal(requested.length, 2);
  assert.deepEqual(result.credits.map((credit) => [credit.name, credit.department, credit.order]), [
    ["导演甲", "directing", undefined],
    ["导演甲", "writing", undefined],
    ["Actor B", "acting", 1],
    ["配音员丙", "acting", 2]
  ]);
  assert.deepEqual(result.credits[0].externalIds, { imdb: "nm0000010", wikidata: "Q10" });
  assert.deepEqual(result.credits[2].externalIds, { tmdb: "20", wikidata: "Q20" });
  assert.equal(result.credits[2].job, "Actor");
  assert.equal(result.credits[3].job, "Voice Actor");
  assert.deepEqual(result.credits[3].externalIds, { imdb: "nm0000030", wikidata: "Q30" });
  assert.deepEqual(result.workExternalIds, { wikidata: "Q1", imdb: "tt0000001", tmdb: "101" });
});

test("rejects malformed work ids before requesting", async () => {
  const source = new WikidataWorkCreditsSource({ fetchImpl: async () => { throw new Error("unexpected"); } });
  await assert.rejects(source.fetchWorkCredits("not-a-qid"), /Invalid Wikidata work id/);
});

test("falls back to per-entity data when the people batch endpoint is rate limited", async () => {
  const requested: string[] = [];
  const source = new WikidataWorkCreditsSource({
    limiter: new ProviderRateLimiter(0),
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url.includes("w/api.php")) return new Response(null, { status: 429 });
      if (url.endsWith("/Q1.json")) {
        return Response.json({ entities: { Q1: { claims: {
          P57: [{ mainsnak: { datavalue: { value: { id: "Q10" } } } }]
        } } } });
      }
      const id = url.match(/EntityData\/(Q\d+)\.json$/)?.[1];
      const labels: Record<string, string> = { Q10: "导演甲" };
      return Response.json({ entities: { [id ?? ""]: { labels: { "zh-cn": { value: labels[id ?? ""] } } } } });
    }
  });

  const result = await source.fetchWorkCredits("Q1");
  assert.deepEqual(result.credits.map((credit) => credit.name), ["导演甲"]);
  assert.equal(requested.filter((url) => url.includes("w/api.php")).length, 1);
  assert.equal(requested.some((url) => url.endsWith("/Q10.json")), true);
});
