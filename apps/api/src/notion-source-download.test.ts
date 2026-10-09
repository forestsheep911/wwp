import assert from "node:assert/strict";
import test from "node:test";
import { NotionSearchSource } from "./notion-source.js";

test("API-uploaded attachment references fall back to the official block URL", async () => {
  const blockId = "3f220ac1-2f0a-8170-b1ee-c58ed890eb2e";
  const spaceId = "84e1d4ff-7133-47d5-ae3b-9d0c38b7fd94";
  const rawUrl = `https://prod-files-secure.s3.us-west-2.amazonaws.com/${spaceId}/file/movie.mp4?X-Amz-Signature=test`;
  const originalFetch = globalThis.fetch;
  let blockReads = 0;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    url: "attachment:file-id:movie.mp4", fileName: "movie.mp4"
  }), { status: 200 })) as typeof fetch;
  try {
    const source = new NotionSearchSource();
    const internals = source as unknown as {
      notion: { blocks: { retrieve: (input: { block_id: string }) => Promise<unknown> } };
    };
    internals.notion.blocks.retrieve = async ({ block_id }) => {
      assert.equal(block_id, blockId);
      blockReads += 1;
      return { id: blockId, type: "video", video: { type: "file", file: { url: rawUrl }, caption: [] } };
    };
    const result = await source.refreshAsset({
      assetKey: "test-video", sourcePageId: "test-page", mediaBlockId: blockId
    });
    assert.ok(result);
    const download = new URL(result.sourceUrl);
    assert.equal(decodeURIComponent(download.pathname.slice("/signed/".length)), rawUrl);
    assert.equal(download.searchParams.get("spaceId"), spaceId);
    assert.equal(download.searchParams.get("id"), blockId);
    assert.equal(blockReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
