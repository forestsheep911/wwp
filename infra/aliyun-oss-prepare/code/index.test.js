"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { __test } = require("./index.js");

test("rejects source URLs and object keys outside the preparation boundary", () => {
  process.env.ALIYUN_OSS_OBJECT_PREFIX = "wwpdw/prepared";
  assert.throws(
    () => __test.parseEvent({ jobId: "j1", sourceUrl: "http://example.test/a.mp4", objectKey: "wwpdw/prepared/a.mp4" }),
    /HTTPS/
  );
  assert.throws(
    () => __test.parseEvent({ jobId: "j1", sourceUrl: "https://example.test/a.mp4", objectKey: "wwpdw/poc/a.mp4" }),
    /outside/
  );
});

test("uses a range probe when HEAD does not reveal source size", async () => {
  const calls = [];
  const fetchImpl = async (_url, init = {}) => {
    calls.push(init);
    if (init.method === "HEAD") return new Response(null, { status: 405 });
    return new Response(new Uint8Array([0]), {
      status: 206,
      headers: {
        "content-range": "bytes 0-0/123456",
        "content-type": "video/mp4"
      }
    });
  };
  const result = await __test.inspectSource("https://example.test/a.mp4", undefined, fetchImpl);
  assert.deepEqual(result, {
    contentLength: 123456,
    contentType: "video/mp4",
    rangeSupported: true
  });
  assert.equal(calls[1].headers.Range, "bytes=0-0");
});

test("returns an existing OSS object without starting multipart upload", async () => {
  const client = {
    async head() {
      return { res: { headers: { "content-length": "50", etag: "etag-1" } } };
    },
    async initMultipartUpload() {
      assert.fail("multipart upload should not start");
    }
  };
  const result = await __test.copyToOss(
    { jobId: "j1", objectKey: "wwpdw/prepared/a.mp4", sourceUrl: "https://example.test/a.mp4" },
    { contentLength: 50, contentType: "video/mp4", rangeSupported: true },
    client,
    async () => assert.fail("source should not be requested")
  );
  assert.deepEqual(result, { alreadyReady: true, contentLength: 50, etag: "etag-1" });
});
