import assert from "node:assert/strict";
import test from "node:test";

import type { MoviePoster, SearchResult } from "@wwpdw/shared";
import { mergeCachedPosters } from "./poster-refresh.js";

const assetKey = "notion-page-backrooms";

function result(posters: MoviePoster[]): SearchResult {
  return {
    assetKey,
    title: "后室 Backrooms (2026)",
    source: "notion",
    sourceUrl: "https://example.com/movie.mp4",
    durationLabel: "",
    updatedAt: "2026-08-30T00:00:00.000Z",
    summary: "",
    metadata: {
      posterUrl: posters[0]?.url,
      posters
    }
  };
}

test("Notion signature refresh preserves the matching cached Blob poster", () => {
  const path = "https://prod-files-secure.s3.us-west-2.amazonaws.com/work/backrooms.jpg";
  const cached: MoviePoster = {
    url: `${path}?X-Amz-Date=20260829T230000Z&X-Amz-Signature=old`,
    originalUrl: `${path}?X-Amz-Date=20260829T230000Z&X-Amz-Signature=old`,
    source: "blob",
    blobName: "posters/notion-page-backrooms/01.jpg"
  };
  const fresh: MoviePoster = {
    url: `${path}?X-Amz-Date=20260830T080000Z&X-Amz-Signature=new`,
    originalUrl: `${path}?X-Amz-Date=20260830T080000Z&X-Amz-Signature=new`,
    source: "notion"
  };

  const merged = mergeCachedPosters(result([cached]), result([fresh]));

  assert.equal(merged.metadata?.posters?.[0]?.source, "blob");
  assert.equal(merged.metadata?.posters?.[0]?.blobName, cached.blobName);
  assert.equal(merged.metadata?.posterUrl, cached.url);
});

test("a replaced Notion file does not reuse an unrelated cached poster", () => {
  const cached: MoviePoster = {
    url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/work/old.jpg?signature=old",
    originalUrl: "https://prod-files-secure.s3.us-west-2.amazonaws.com/work/old.jpg?signature=old",
    source: "blob",
    blobName: "posters/notion-page-backrooms/01.jpg"
  };
  const fresh: MoviePoster = {
    url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/work/new.jpg?signature=new",
    source: "notion"
  };

  const merged = mergeCachedPosters(result([cached]), result([fresh]));

  assert.equal(merged.metadata?.posters?.[0]?.source, "notion");
  assert.equal(merged.metadata?.posters?.[0]?.url, fresh.url);
});
