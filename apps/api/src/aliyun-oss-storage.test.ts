import assert from "node:assert/strict";
import test from "node:test";

import { AliyunOssStorage } from "./aliyun-oss-storage.js";

test("OSS storage signs only objects under the configured preparation prefix", () => {
  let signed = "";
  let expires = 0;
  const storage = new AliyunOssStorage({
    objectPrefix: "wwpdw/prepared",
    signedUrlMinutes: 720,
    client: {
      async delete() { return {} as never; },
      async head() { return {} as never; },
      async listParts() { return { parts: [] } as never; },
      async listUploads() { return { uploads: [] } as never; },
      signatureUrl(objectKey, options) {
        signed = objectKey;
        expires = Number(options?.expires);
        return "https://signed.example/video";
      }
    }
  });
  assert.equal(storage.createSignedUrl("wwpdw/prepared/a.mp4").url, "https://signed.example/video");
  assert.equal(signed, "wwpdw/prepared/a.mp4");
  assert.equal(expires, 6 * 60 * 60);
  assert.throws(() => storage.createSignedUrl("wwpdw/poc/a.mp4"), /outside/);
});

test("OSS storage reports durable multipart bytes from the newest matching upload", async () => {
  const storage = new AliyunOssStorage({
    objectPrefix: "wwpdw/prepared",
    client: {
      async delete() { return {} as never; },
      async head() { return {} as never; },
      async listUploads() {
        return {
          uploads: [
            { name: "wwpdw/prepared/a.mp4", uploadId: "old", initiated: "2026-01-01T00:00:00Z" },
            { name: "wwpdw/prepared/a.mp4", uploadId: "new", initiated: "2026-01-02T00:00:00Z" },
            { name: "wwpdw/prepared/another.mp4", uploadId: "other", initiated: "2026-01-03T00:00:00Z" }
          ]
        } as never;
      },
      async listParts(_name, uploadId) {
        assert.equal(uploadId, "new");
        return {
          parts: [
            { PartNumber: "1", Size: "67108864", LastModified: "2026-01-02T00:01:00Z" },
            { PartNumber: "2", Size: "67108864", LastModified: "2026-01-02T00:02:00Z" }
          ]
        } as never;
      },
      signatureUrl() { return "https://signed.example/video"; }
    }
  });
  assert.deepEqual(await storage.multipartProgress("wwpdw/prepared/a.mp4"), {
    transferredBytes: 134217728,
    partCount: 2,
    lastProgressAt: "2026-01-02T00:02:00Z"
  });
});
