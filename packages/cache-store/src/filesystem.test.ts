import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { SearchResult } from "@wwpdw/shared";
import { FilesystemCacheStore } from "./filesystem.js";

function mp4Box(type: string, payload = Buffer.alloc(0)) {
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, "ascii");
  payload.copy(result, 8);
  return result;
}

test("filesystem cache downloads media, survives a second store instance, and deletes cleanly", async () => {
  const media = Buffer.concat([
    mp4Box("ftyp", Buffer.from("isom")),
    mp4Box("moov"),
    mp4Box("mdat", Buffer.alloc(128 * 1024, 7))
  ]);
  const poster = Buffer.from("ffd8ffe000104a464946", "hex");
  const server = createServer((request, response) => {
    if (request.url === "/poster.jpg") {
      response.writeHead(200, {
        "Content-Length": poster.length,
        "Content-Type": "image/jpeg"
      });
      response.end(poster);
      return;
    }
    const match = request.headers.range?.match(/^bytes=(\d+)-$/);
    const start = match ? Number(match[1]) : 0;
    if (start >= media.length) {
      response.writeHead(416, { "Content-Range": `bytes */${media.length}` });
      response.end();
      return;
    }
    const payload = media.subarray(start);
    const headers: Record<string, string | number> = {
      "Accept-Ranges": "bytes",
      "Content-Length": payload.length,
      "Content-Type": "video/mp4"
    };
    if (start) headers["Content-Range"] = `bytes ${start}-${media.length - 1}/${media.length}`;
    response.writeHead(start ? 206 : 200, headers);
    response.end(payload);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");

  const root = await mkdtemp(path.join(tmpdir(), "wwpdw-filesystem-cache-"));
  const store = new FilesystemCacheStore(root);
  let reopened: FilesystemCacheStore | undefined;
  try {
    const result: SearchResult = {
      assetKey: "filesystem-smoke",
      title: "Filesystem smoke video",
      source: "test",
      sourceUrl: `http://127.0.0.1:${address.port}/video.mp4`,
      durationLabel: "test",
      updatedAt: new Date().toISOString(),
      summary: "Filesystem cache test."
    };
    const ensured = await store.ensureCache(result);
    ensured.job.resolve = {
      kind: "direct_file",
      layer: "rule",
      confidence: 1,
      observedAt: new Date().toISOString(),
      url: result.sourceUrl
    };
    await store.saveJob(ensured.job);
    const asset = await store.finalizeReadyAsset(ensured.job);

    assert.equal(asset.status, "ready");
    assert.equal(asset.media?.contentLength, media.length);
    assert.equal(asset.media?.mp4?.status, "faststart");
    const localFile = await store.getMediaFile(result.assetKey);
    assert(localFile);
    assert.deepEqual(await readFile(localFile.absolutePath), media);
    assert.equal((await store.getPlayback(result.assetKey))?.playbackUrl, "/api/media/filesystem-smoke");

    const withPoster = await store.hydrateMoviePosterUrls({
      ...result,
      metadata: {
        posters: [{
          url: `http://127.0.0.1:${address.port}/poster.jpg`,
          source: "external"
        }]
      }
    });
    const localPosterUrl = withPoster.metadata?.posters?.[0]?.url;
    assert.match(localPosterUrl ?? "", /^\/api\/posters\/[a-f0-9]{32}$/);
    const posterKey = localPosterUrl?.split("/").at(-1);
    assert(posterKey);
    const localPoster = await store.getPosterFile(posterKey);
    assert(localPoster);
    assert.equal(localPoster.contentType, "image/jpeg");
    assert.deepEqual(await readFile(localPoster.absolutePath), poster);

    reopened = new FilesystemCacheStore(root);
    assert.equal((await reopened.getAsset(result.assetKey))?.status, "ready");
    assert.equal((await reopened.getMediaFile(result.assetKey))?.contentLength, media.length);

    const deleted = await reopened.deleteCacheEntry({ assetKey: result.assetKey });
    assert.equal(deleted.deletedAsset, true);
    assert.equal(deleted.deletedJob, true);
    assert.equal(deleted.deletedBlob, true);
    assert.equal(await reopened.getMediaFile(result.assetKey), undefined);
  } finally {
    reopened?.close();
    store.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
    await rm(root, { recursive: true, force: true });
  }
});
