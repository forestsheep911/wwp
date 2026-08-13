import assert from "node:assert/strict";
import test from "node:test";

import { ProviderRateLimiter } from "./provider-http.js";
import { WikidataPersonSource } from "./wikidata.js";

test("maps multilingual labels and stable crosswalk ids", async () => {
  const source = new WikidataPersonSource({
    limiter: new ProviderRateLimiter(0),
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    fetchImpl: async (_input, init) => {
      assert.match((init?.headers as Record<string, string>)["User-Agent"], /WWPDW-People/);
      return Response.json({ entities: { Q35332: {
        labels: { "zh-cn": { value: "布拉德·皮特" }, en: { value: "Brad Pitt" } },
        aliases: { en: [{ value: "William Bradley Pitt" }] },
        descriptions: { "zh-cn": { value: "美国演员" }, en: { value: "American actor" } },
        claims: {
          P31: [{ mainsnak: { datavalue: { value: { value: "Q5" } } } }],
          P345: [{ mainsnak: { datavalue: { value: "nm0000093" } } }],
          P4985: [{ mainsnak: { datavalue: { value: "287" } } }],
          P569: [{ mainsnak: { datavalue: { value: { time: "+1963-12-18T00:00:00Z" } } } }],
          P18: [{ mainsnak: { datavalue: { value: "Brad Pitt 2019.jpg" } } }]
        }
      } } });
    }
  });

  const evidence = await source.fetchPersonEvidence("q35332");
  assert.deepEqual(evidence.externalIds, { tmdb: "287", imdb: "nm0000093", wikidata: "Q35332" });
  assert.deepEqual(evidence.names.map((entry) => [entry.value, entry.language]), [
    ["布拉德·皮特", "zh-cn"],
    ["Brad Pitt", "en"],
    ["William Bradley Pitt", "en"]
  ]);
  assert.equal(evidence.biography?.birthDate, "1963-12-18");
  assert.deepEqual(evidence.biography?.texts?.map((entry) => [entry.value, entry.language, entry.source]), [
    ["美国演员", "zh-cn", "wikidata"],
    ["American actor", "en", "wikidata"]
  ]);
  assert.match(evidence.images?.[0].url ?? "", /Brad%20Pitt%202019\.jpg/);
});

test("rejects malformed entity ids before making a request", async () => {
  const source = new WikidataPersonSource({ fetchImpl: async () => { throw new Error("unexpected"); } });
  await assert.rejects(source.fetchPersonEvidence("not-a-qid"), /Invalid Wikidata/);
});

test("derives simplified Chinese display values while preserving traditional Wikidata evidence", async () => {
  const source = new WikidataPersonSource({
    limiter: new ProviderRateLimiter(0),
    now: () => new Date("2026-08-10T00:00:00.000Z"),
    fetchImpl: async () => Response.json({ entities: { Q740758: {
      labels: { zh: { value: "是枝裕和" }, en: { value: "Hirokazu Koreeda" } },
      descriptions: { zh: { value: "日本電影導演、製片人、編劇" }, en: { value: "Japanese film director" } },
      claims: { P31: [{ mainsnak: { datavalue: { value: { value: "Q5" } } } }] }
    } } })
  });

  const evidence = await source.fetchPersonEvidence("Q740758");
  assert.deepEqual(evidence.biography?.texts?.map((entry) => [entry.value, entry.language]), [
    ["日本电影导演、制片人、编剧", "zh-hans"],
    ["日本電影導演、製片人、編劇", "zh"],
    ["Japanese film director", "en"]
  ]);
});

test("derives a simplified canonical Chinese name without discarding the original form", async () => {
  const source = new WikidataPersonSource({
    limiter: new ProviderRateLimiter(0),
    fetchImpl: async () => Response.json({ entities: { Q940531: {
      labels: { zh: { value: "阿部寬" }, en: { value: "Hiroshi Abe" } },
      claims: { P31: [{ mainsnak: { datavalue: { value: { value: "Q5" } } } }] }
    } } })
  });

  const evidence = await source.fetchPersonEvidence("Q940531");
  assert.deepEqual(evidence.names.map((entry) => [entry.value, entry.language, entry.kind]), [
    ["阿部宽", "zh-hans", "display"],
    ["阿部寬", "zh", "alternate"],
    ["Hiroshi Abe", "en", "display"]
  ]);
});

test("does not invent a month or day for a year-only Wikidata date", async () => {
  const source = new WikidataPersonSource({
    limiter: new ProviderRateLimiter(0),
    fetchImpl: async () => Response.json({ entities: { Q1: {
      labels: { en: { value: "A Person" } },
      claims: {
        P31: [{ mainsnak: { datavalue: { value: { value: "Q5" } } } }],
        P569: [{ mainsnak: { datavalue: { value: { time: "+1940-00-00T00:00:00Z" } } } }]
      }
    } } })
  });

  const evidence = await source.fetchPersonEvidence("Q1");
  assert.equal(evidence.biography?.birthDate, undefined);
});

test("rejects an entity explicitly classified as non-human", async () => {
  const source = new WikidataPersonSource({
    limiter: new ProviderRateLimiter(0),
    fetchImpl: async () => Response.json({ entities: { Q1: {
      labels: { en: { value: "A music duo" } },
      claims: { P31: [{ mainsnak: { datavalue: { value: { value: "Q215380" } } } }] }
    } } })
  });
  await assert.rejects(source.fetchPersonEvidence("Q1"), /not a human/);
});
