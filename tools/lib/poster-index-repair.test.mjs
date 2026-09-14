import assert from "node:assert/strict";
import test from "node:test";
import { maintainedPosterFiles, posterOnlyIndexPatch, decodeIndexEntity, ownedPosterFile } from "./poster-index-repair.mjs";
test("only maintained file fields are authoritative, never URL or cover", () => {
  const page = { cover: { external: { url: "cover" } }, properties: { "Poster URL": { type: "url", url: "fallback" }, 海报: { type: "files", files: [{ file: { url: "maintained" } }] }, 其他: { type: "files", files: [{ file: { url: "unrelated" } }] } } };
  assert.deepEqual(maintainedPosterFiles(page), ["maintained"]);
  page.properties.海报.files = [];
  assert.deepEqual(maintainedPosterFiles(page), []);
});
test("poster-only patch preserves current credits, variants and all other metadata", () => {
  const original = { result: { metadata: { credits: ["new credit"], posters: ["old"], posterUrl: "old", work: { media: { trailers: ["keep"] } } }, variants: ["new release"] }, searchText: "keep", sourceUpdatedAt: "keep" };
  const entity = { partitionKey: "movie", rowKey: "key", payload: JSON.stringify(original) };
  const result = decodeIndexEntity(posterOnlyIndexPatch(entity, [], "today"));
  assert.deepEqual(result.result.metadata.credits, ["new credit"]);
  assert.deepEqual(result.result.variants, ["new release"]);
  assert.deepEqual(result.result.metadata.work.media, { trailers: ["keep"], posters: [] });
  assert.equal(result.result.metadata.posterUrl, undefined);
  assert.equal(result.sourceUpdatedAt, "keep");
  assert.equal(result.searchText, "keep");
  assert.equal(entity.payload, JSON.stringify(original));
});
test("chunked payload round trips and old trailing chunks are ignored after shrinking", () => {
  const entity = { partitionKey: "movie", rowKey: "key", payload: JSON.stringify({ result: { metadata: { text: "x".repeat(65000) } } }) };
  const patch = posterOnlyIndexPatch(entity, []);
  assert.equal(patch.payloadChunks, 3);
  assert.equal(decodeIndexEntity(patch).result.metadata.text.length, 65000);
  const small = posterOnlyIndexPatch({ ...entity, payload: JSON.stringify({result:{metadata:{}}}) }, []);
  assert.deepEqual(decodeIndexEntity({ ...patch, ...small }).result.metadata.posters, []);
});
test("content-addressed poster names change on replacement and reject HTML", () => {
  const first = ownedPosterFile("movie", 0, Buffer.from([255,216,255,1]));
  const second = ownedPosterFile("movie", 0, Buffer.from([255,216,255,2]));
  assert.notEqual(first.blobName, second.blobName);
  assert.equal(first.contentType, "image/jpeg");
  assert.throws(() => ownedPosterFile("movie",0,Buffer.from("<html>error</html>")), /invalid image/);
});
