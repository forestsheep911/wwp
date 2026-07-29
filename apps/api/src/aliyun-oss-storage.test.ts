import assert from "node:assert/strict";
import test from "node:test";

import { AliyunOssStorage } from "./aliyun-oss-storage.js";

test("OSS storage signs only objects under the configured preparation prefix", () => {
  let signed = "";
  const storage = new AliyunOssStorage({
    objectPrefix: "wwpdw/prepared",
    client: {
      async delete() { return {} as never; },
      async head() { return {} as never; },
      signatureUrl(objectKey) {
        signed = objectKey;
        return "https://signed.example/video";
      }
    }
  });
  assert.equal(storage.createSignedUrl("wwpdw/prepared/a.mp4").url, "https://signed.example/video");
  assert.equal(signed, "wwpdw/prepared/a.mp4");
  assert.throws(() => storage.createSignedUrl("wwpdw/poc/a.mp4"), /outside/);
});
