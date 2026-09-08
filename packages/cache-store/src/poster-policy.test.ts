import assert from "node:assert/strict";
import test from "node:test";
import type { MoviePoster, SearchResult } from "@wwpdw/shared";
import { AzureCacheStore } from "./azure.js";
import { moviePosterCandidates, posterDownloadCandidates, postersForSync, withMoviePosters } from "./poster-cache.js";

const file: MoviePoster = { source: "notion", origin: "notion-files", url: "https://prod-files-secure.s3.us-west-2.amazonaws.com/a.jpg" };
const cached: MoviePoster = { ...file, source: "blob", blobName: "posters/test/01.jpg", originalUrl: file.url, url: "https://test.blob.core.windows.net/cache/01.jpg" };
const external: MoviePoster = { source: "notion", url: "https://img1.doubanio.com/unmaintained.jpg" };
function result(posters: MoviePoster[]): SearchResult {
  return { assetKey: "test", title: "Test", source: "notion", sourceUrl: "", durationLabel: "", updatedAt: "", summary: "", metadata: { posters, posterUrl: external.url } };
}

// Stub only Azure I/O. Exercise production sync/hydration/cleanup decisions
// without credentials, network calls or deletion of real files.
function store(cache: (poster: MoviePoster) => Promise<MoviePoster> = async () => cached) {
  const instance = Object.create(AzureCacheStore.prototype);
  const pruned: Set<string>[] = [];
  instance.ensureReady = async () => {};
  instance.cacheMoviePoster = async (_key: string, poster: MoviePoster) => cache(poster);
  instance.deleteStalePosterBlobs = async (_key: string, names: Set<string>) => { pruned.push(names); };
  return { instance: instance as AzureCacheStore, pruned };
}

test("legacy URL-only candidates cannot be downloaded or promoted to a new Blob", async () => {
  assert.deepEqual(await posterDownloadCandidates({ poster: external, posters: [external], index: 0 }), []);
  assert.deepEqual(await postersForSync(result([external])), []);
  assert.deepEqual(await postersForSync(result([external]), async () => [file]), [file]);
});

test("a missing Notion poster does not fail sync and clears the displayed poster", async () => {
  const { instance, pruned } = store(async () => { throw new Error("must not download an absent poster"); });
  const output = await instance.cacheMoviePosters(result([]));
  assert.deepEqual(output.metadata?.posters, []);
  assert.equal(output.metadata?.posterUrl, undefined);
  assert.equal(pruned.length, 1);
  assert.equal(pruned[0].size, 0);
});

test("a legacy entry without an authoritative list cannot trigger destructive cleanup", async () => {
  const { instance, pruned } = store();
  const input = result([]);
  delete input.metadata!.posters;
  await instance.cacheMoviePosters(input);
  assert.equal(pruned.length, 0);
  let refreshed = false;
  await instance.cacheMoviePosters(input, { refreshPosters: async () => { refreshed = true; return []; } });
  assert.equal(refreshed, true);
  assert.equal(pruned.length, 1);
});

test("failed source refresh preserves existing storage and is not treated as a source deletion", async () => {
  const { instance, pruned } = store();
  const input = result([cached]);
  input.metadata!.posters![0] = { ...cached, origin: undefined };
  const output = await instance.cacheMoviePosters(input, { refreshPosters: async () => { throw new Error("Notion unavailable"); } });
  assert.equal(output, input);
  assert.equal(pruned.length, 0);
});

test("a failed image download never prunes old Blobs and never reaches the website as an external URL", async () => {
  const { instance, pruned } = store(async poster => poster);
  const output = await instance.cacheMoviePosters(result([file]));
  assert.equal(output.metadata?.posters?.[0].url, file.url, "keep source internally so it can be retried");
  assert.equal(pruned.length, 0);
  const visible = await instance.hydrateMoviePosterUrls(output);
  assert.deepEqual(visible.metadata?.posters, []);
  assert.equal(visible.metadata?.posterUrl, undefined);
});

test("a partial cache failure preserves storage while serving only successful cached files", async () => {
  const second = { ...file, url: `${file.url}?second` };
  const { instance, pruned } = store(async poster => poster === file ? cached : poster);
  const output = await instance.cacheMoviePosters(result([file, second]));
  assert.equal(pruned.length, 0);
  const visible = await instance.hydrateMoviePosterUrls(output);
  assert.equal(visible.metadata?.posters?.length, 1);
  assert.equal(visible.metadata?.posterUrl, "/api/posters/posters%2Ftest%2F01.jpg");
});

test("an exception refreshing a failed download does not abort metadata synchronization or delete old files", async () => {
  const { instance, pruned } = store(async () => { throw new Error("expired URL refresh failed"); });
  const output = await instance.cacheMoviePosters(result([file]));
  assert.equal(output.title, "Test");
  assert.equal(pruned.length, 0);
  assert.deepEqual((await instance.hydrateMoviePosterUrls(output)).metadata?.posters, []);
});

test("a successful complete sync prunes only after all maintained images are cached", async () => {
  const { instance, pruned } = store();
  const output = await instance.cacheMoviePosters(result([file]));
  assert.equal(pruned.length, 1);
  assert.deepEqual([...pruned[0]], [cached.blobName]);
  assert.equal(output.metadata?.posters?.[0].origin, "notion-files");
});

test("an explicit empty poster list overrides stale work-level posters and legacy posterUrl", () => {
  const input = result([]);
  input.metadata!.work = { media: { posters: [cached] } } as NonNullable<SearchResult["metadata"]>["work"];
  assert.deepEqual(moviePosterCandidates(input), []);
  const output = withMoviePosters(input, []);
  assert.deepEqual(output.metadata?.work?.media?.posters, []);
  assert.equal(output.metadata?.posterUrl, undefined);
});

test("replacement images use new Blob names and cannot overwrite a preserved ordinal", async (context) => {
  const uploaded: string[] = [];
  const instance = Object.create(AzureCacheStore.prototype);
  instance.config = { posterMaxBytes: 1024 };
  instance.containerClient = { getBlockBlobClient: (name: string) => ({ uploadData: async () => { uploaded.push(name); } }) };
  let bytes = "first image";
  context.mock.method(globalThis, "fetch", async () => new Response(bytes, { headers: { "Content-Type": "image/jpeg" } }));
  await instance.cacheMoviePosterFromUrl("test", file, 0, file.url);
  bytes = "replacement image";
  await instance.cacheMoviePosterFromUrl("test", file, 0, file.url);
  assert.notEqual(uploaded[0], uploaded[1]);
  assert.match(uploaded[0], /\/01-[a-f0-9]{20}\.jpg$/);
});
