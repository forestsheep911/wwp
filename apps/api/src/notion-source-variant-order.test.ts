import assert from "node:assert/strict";
import test from "node:test";

import type { MediaVariant } from "@wwpdw/shared";
import { postersFromProperties, sortMediaAssetVariants } from "./notion-source.js";

function episodeVariant(episodeNumber: number): MediaVariant {
  return {
    assetKey: `episode-${episodeNumber}`,
    label: `Episode ${episodeNumber}`,
    sourceUrl: `https://example.com/${episodeNumber}.mp4`,
    kind: "video",
    summary: "",
    metadata: {
      episodeNumber,
      sourceLabel: "1080p 繁 0.44G"
    }
  };
}

test("Media Assets variants are ordered by episode before applying a display limit", () => {
  const variants = [103, 110, 1, 102, 2].map(episodeVariant);

  assert.deepEqual(
    sortMediaAssetVariants(variants)
      .slice(0, 3)
      .map((variant) => variant.metadata?.episodeNumber),
    [1, 2, 102]
  );
});

test("an explicit poster property takes precedence over a legacy page cover", () => {
  const posters = postersFromProperties(
    { cover: { type: "external", external: { url: "https://example.com/wrong-cover.jpg" } } },
    {
      "海报": {
        type: "files",
        files: [{ type: "external", external: { url: "https://example.com/correct-poster.jpg" } }]
      },
      "Poster URL": { type: "url", url: "https://example.com/correct-poster-source.jpg" }
    }
  );

  assert.deepEqual(posters.map((poster) => poster.url), [
    "https://example.com/correct-poster.jpg",
    "https://example.com/correct-poster-source.jpg",
    "https://example.com/wrong-cover.jpg"
  ]);
});
