import assert from "node:assert/strict";
import test from "node:test";

import type { MoviePoster } from "@wwpdw/shared";
import { posterDownloadCandidates, posterRequestHeaders } from "./poster-cache.js";

test("posterDownloadCandidates retries a refreshed Notion file URL before external URLs", async () => {
  const original: MoviePoster = {
    url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/stale.jpg",
    originalUrl: "https://prod-files-secure.s3.us-west-2.amazonaws.com/stale.jpg",
    source: "notion"
  };
  const external: MoviePoster = {
    url: "https://img9.doubanio.com/view/photo/l/public/p123.jpg",
    originalUrl: "https://img9.doubanio.com/view/photo/l/public/p123.jpg",
    source: "notion"
  };

  const candidates = await posterDownloadCandidates({
    poster: original,
    index: 0,
    posters: [original, external],
    refreshPosters: async () => [
      {
        ...original,
        url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/fresh.jpg",
        originalUrl: "https://prod-files-secure.s3.us-west-2.amazonaws.com/fresh.jpg"
      },
      external
    ]
  });

  assert.deepEqual(candidates.map((candidate) => candidate.url), [
    "https://prod-files-secure.s3.us-west-2.amazonaws.com/stale.jpg",
    "https://prod-files-secure.s3.us-west-2.amazonaws.com/fresh.jpg"
  ]);
});

test("posterRequestHeaders adds a Douban referer for Douban poster downloads", () => {
  const headers = posterRequestHeaders("https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2564153546");

  assert.equal(headers.Referer, "https://movie.douban.com/");
  assert.match(headers["User-Agent"], /wwpdw-poster-cache/);
});

test("posterRequestHeaders does not spoof referer for non-Douban poster downloads", () => {
  const headers = posterRequestHeaders("https://example.com/poster.jpg");

  assert.equal(headers.Referer, undefined);
});
