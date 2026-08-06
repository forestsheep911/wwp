import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serverSource = readFileSync(new URL("./server.ts", import.meta.url), "utf8");

test("domestic playback returns the direct OSS signed URL", () => {
  const domesticResponse = serverSource.match(
    /const signed = aliyunOssStorage\.createSignedUrl\(job\.objectKey\);[\s\S]*?sendJson\(response, 200, \{[\s\S]*?\n    \}\);/,
  )?.[0];

  assert.ok(domesticResponse);
  assert.match(domesticResponse, /playbackUrl: signed\.url/);
  assert.doesNotMatch(domesticResponse, /playbackUrl: `\/api\/oss-playback\//);
});
