import test from "node:test";
import assert from "node:assert/strict";

import {
  episodeCollectionFileName,
  planEpisodeCollections
} from "./build-series-collections.mjs";

test("planEpisodeCollections groups only consecutive episodes below the target", () => {
  const groups = planEpisodeCollections([
    { episode: 1, bytes: 2_000_000_000 },
    { episode: 2, bytes: 2_000_000_000 },
    { episode: 3, bytes: 1_000_000_000 },
    { episode: 5, bytes: 500_000_000 }
  ], 4_850_000_000, 5_000_000_000);

  assert.deepEqual(groups.map((group) => ({
    start: group.episodeStart,
    end: group.episodeEnd,
    bytes: group.estimatedBytes
  })), [
    { start: 1, end: 2, bytes: 4_000_000_000 },
    { start: 3, end: 3, bytes: 1_000_000_000 },
    { start: 5, end: 5, bytes: 500_000_000 }
  ]);
});

test("planEpisodeCollections fails before producing an over-cap single item", () => {
  assert.throws(
    () => planEpisodeCollections([{ episode: 1, bytes: 5_000_000_001 }]),
    /exceeds max-bytes/
  );
});

test("episodeCollectionFileName carries the inclusive range", () => {
  assert.equal(
    episodeCollectionFileName("Teach.You.a.Lesson", 1, 1, 5),
    "Teach.You.a.Lesson.S01E01-E05.mp4"
  );
});
