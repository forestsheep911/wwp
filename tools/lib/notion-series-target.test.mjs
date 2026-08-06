import test from "node:test";
import assert from "node:assert/strict";
import { assertEpisodeTargetIsEmpty } from "./notion-series-target.mjs";

test("series uploader rejects an episode that already has an unnamed video", () => {
  assert.throws(
    () => assertEpisodeTargetIsEmpty({ id: "episode-01", videoCount: 1 }),
    /already contains 1 video block.*unnamed Notion video blocks cannot be safely deduplicated/i
  );
});

test("series uploader accepts an empty episode target", () => {
  assert.doesNotThrow(() => assertEpisodeTargetIsEmpty({ id: "episode-01", videoCount: 0 }));
});
