import assert from "node:assert/strict";
import test from "node:test";
import type { SearchResult } from "@wwpdw/shared";
import { preserveIndexedPersonCredits } from "./person-credit-index-merge.js";

function result(credits: NonNullable<SearchResult["metadata"]>["credits"]): SearchResult {
  return {
    assetKey: "asset-1",
    title: "作品",
    source: "notion",
    sourceUrl: "https://example.test",
    durationLabel: "1h",
    updatedAt: "2026-08-21T00:00:00.000Z",
    summary: "",
    metadata: {
      credits,
      work: {
        workId: "work-1",
        kind: "movie",
        titles: [{ title: "作品", kind: "primary", source: "notion" }],
        credits,
        updatedAt: "2026-08-21T00:00:00.000Z"
      }
    }
  };
}

test("Notion refresh preserves linked and expanded person credits", () => {
  const existing = result([
    {
      personId: "person_5f47c349-7b9d-437c-b2a0-e1aec2a68cbb",
      name: "彼得·法雷里",
      originalName: "Peter Farrelly",
      department: "directing",
      job: "Director",
      source: "wikidata",
      externalIds: { wikidata: "Q1368300", imdb: "nm0268380" }
    },
    { name: "扩展演员", department: "acting", source: "wikidata" }
  ]);
  const incoming = result([
    { name: "Peter Farrelly", department: "directing", job: "Director", order: 0, source: "notion" },
    { name: "Notion 新演员", department: "acting", order: 1, source: "notion" }
  ]);

  const merged = preserveIndexedPersonCredits(incoming, existing);
  assert.equal(merged.metadata?.credits?.length, 2);
  assert.equal(merged.metadata?.credits?.[0].personId, "person_5f47c349-7b9d-437c-b2a0-e1aec2a68cbb");
  assert.equal(merged.metadata?.credits?.[1].name, "扩展演员");
  assert.deepEqual(merged.metadata?.work?.credits, merged.metadata?.credits);
});

test("an enriched incoming credit merges only through a stable identity", () => {
  const existing = result([{
    personId: "person_5f47c349-7b9d-437c-b2a0-e1aec2a68cbb",
    name: "彼得·法雷里",
    department: "directing",
    source: "wikidata",
    externalIds: { wikidata: "Q1368300" }
  }]);
  const incoming = result([{
    name: "Peter Farrelly",
    department: "directing",
    order: 0,
    source: "tmdb",
    externalIds: { wikidata: "Q1368300" }
  }]);

  const merged = preserveIndexedPersonCredits(incoming, existing);
  assert.equal(merged.metadata?.credits?.length, 1);
  assert.equal(merged.metadata?.credits?.[0].personId, "person_5f47c349-7b9d-437c-b2a0-e1aec2a68cbb");
  assert.equal(merged.metadata?.credits?.[0].order, 0);
});

test("plain Notion credits remain replaceable before person enrichment", () => {
  const existing = result([{ name: "旧演员", department: "acting", source: "notion" }]);
  const incoming = result([{ name: "新演员", department: "acting", source: "notion" }]);
  const merged = preserveIndexedPersonCredits(incoming, existing);
  assert.deepEqual(merged.metadata?.credits, incoming.metadata?.credits);
});
