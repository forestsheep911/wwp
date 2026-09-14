import assert from "node:assert/strict";
import test from "node:test";
import type { MoviePoster, SearchResult } from "@wwpdw/shared";
import { prepareIndexedAssetRefresh } from "./indexed-asset-refresh.js";

const base = "https://prod-files-secure.s3.us-west-2.amazonaws.com/work/poster.jpg";
function result(posters: MoviePoster[]): SearchResult {
  return { assetKey: "notion-page-test", title: "Test", source: "notion", sourceUrl: "", summary: "", durationLabel: "", updatedAt: "2026-09-13", metadata: { posters, posterUrl: posters[0]?.url } };
}
const cached: MoviePoster = { source: "blob", origin: "notion-files", url: "/api/posters/posters%2Ftest%2F01.jpg", blobName: "posters/test/01.jpg", originalUrl: `${base}?signature=old` };

test("metadata refresh preserves matching Blob across a new Notion signature before caching", async () => {
  const existing = result([cached]);
  existing.metadata!.credits = [{ name: "Director", department: "directing", personId: "person-1" }];
  const incoming = result([{ source: "notion", origin: "notion-files", url: `${base}?signature=new` }]);
  let called = false;
  const refreshed = await prepareIndexedAssetRefresh(incoming, { getResult: async () => existing }, { cacheMoviePosters: async r => { called = true; assert.equal(r.metadata?.posters?.[0]?.blobName, cached.blobName); return r; } });
  assert.equal(called, true);
  assert.equal(refreshed.metadata?.credits?.[0]?.personId, "person-1");
  assert.equal(incoming.metadata?.posters?.[0]?.source, "notion");
});

test("replacement image goes through cache instead of keeping the old Blob", async () => {
  const fresh: MoviePoster = { source: "notion", origin: "notion-files", url: `${base}/replacement.jpg` };
  await prepareIndexedAssetRefresh(result([fresh]), { getResult: async () => result([cached]) }, { cacheMoviePosters: async r => { assert.deepEqual(r.metadata?.posters, [fresh]); return r; } });
});

test("missing maintained poster remains empty, without a legacy URL fallback", async () => {
  const incoming = result([]);
  incoming.metadata!.posterUrl = "https://img1.doubanio.com/legacy.jpg";
  const output = await prepareIndexedAssetRefresh(incoming, { getResult: async () => result([cached]) }, { cacheMoviePosters: async r => r });
  assert.deepEqual(output.metadata?.posters, []);
  assert.equal(output.metadata?.posterUrl, undefined);
});

test("first-time index entry also caches its maintained poster and forwards refresh callback", async () => {
  const incoming = result([{ source: "notion", origin: "notion-files", url: base }]);
  const refreshPosters = async () => incoming.metadata?.posters;
  await prepareIndexedAssetRefresh(incoming, { getResult: async () => undefined }, { cacheMoviePosters: async (r, options) => { assert.equal(options?.refreshPosters, refreshPosters); return r; } }, { refreshPosters });
});

test("failed cache preparation is not silently published as successful", async () => {
  await assert.rejects(prepareIndexedAssetRefresh(result([]), { getResult: async () => undefined }, { cacheMoviePosters: async () => { throw new Error("storage unavailable"); } }), /storage unavailable/);
});
