import assert from "node:assert/strict";
import test from "node:test";
import { moviePreviewCredits } from "../src/cinema/movie-credits";

function result(metadata: Record<string, unknown>) {
  return {
    assetKey: "movie-1",
    title: "示例电影",
    source: "test",
    sourceUrl: "",
    durationLabel: "2h",
    updatedAt: "2026-01-01T00:00:00.000Z",
    summary: "",
    metadata
  };
}

test("uses structured work credits and keeps acting order", () => {
  const credits = moviePreviewCredits(result({
    work: {
      credits: [
        { name: "演员乙", department: "acting", order: 2 },
        { name: "导演甲", department: "directing" },
        { name: "演员甲", department: "acting", order: 1 },
        { name: "编剧甲", department: "writing" }
      ]
    }
  }));

  assert.deepEqual(credits, {
    directors: ["导演甲"],
    writers: ["编剧甲"],
    cast: ["演员甲", "演员乙"]
  });
});

test("falls back to legacy and OMDb credit fields", () => {
  const credits = moviePreviewCredits(result({
    directors: ["旧导演"],
    people: ["主演甲", "主演乙"],
    external: { omdb: { writers: ["旧编剧"] } }
  }));

  assert.deepEqual(credits, {
    directors: ["旧导演"],
    writers: ["旧编剧"],
    cast: ["主演甲", "主演乙"]
  });
});
