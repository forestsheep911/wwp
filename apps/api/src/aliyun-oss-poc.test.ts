import assert from "node:assert/strict";
import test from "node:test";

import {
  AliyunOssPocUnavailableError,
  createAliyunOssPoc
} from "./aliyun-oss-poc.js";

test("OSS playback POC stays disabled until explicitly enabled", () => {
  const poc = createAliyunOssPoc({
    ALIBABA_CLOUD_ACCESS_KEY_ID: "id",
    ALIBABA_CLOUD_ACCESS_KEY_SECRET: "secret",
    ALIYUN_OSS_BUCKET: "bucket",
    ALIYUN_OSS_REGION: "oss-cn-shanghai"
  });

  assert.equal(poc.status().enabled, false);
  assert.throws(() => poc.createSignedUrl(), AliyunOssPocUnavailableError);
});

test("OSS playback POC signs only the configured test object", () => {
  let receivedObjectKey = "";
  let receivedExpires = 0;
  let receivedBucket = "";
  const poc = createAliyunOssPoc(
    {
      ALIBABA_CLOUD_ACCESS_KEY_ID: "id",
      ALIBABA_CLOUD_ACCESS_KEY_SECRET: "secret",
      ALIYUN_OSS_BUCKET: "bucket",
      ALIYUN_OSS_ENDPOINT: "https://oss-cn-shanghai.aliyuncs.com",
      ALIYUN_OSS_POC_ENABLED: "true",
      ALIYUN_OSS_POC_OBJECT_KEY: "wwpdw/poc/test.mp4",
      ALIYUN_OSS_REGION: "oss-cn-shanghai",
      ALIYUN_OSS_SIGNED_URL_MINUTES: "120"
    },
    (options) => {
      receivedBucket = options.bucket;
      return {
        signatureUrl(objectKey, signingOptions) {
          receivedObjectKey = objectKey;
          receivedExpires = signingOptions.expires;
          return "https://signed.example/video";
        }
      };
    }
  );

  assert.deepEqual(poc.status(), {
    enabled: true,
    expiresMinutes: 60,
    objectKey: "wwpdw/poc/test.mp4"
  });
  assert.equal(poc.createSignedUrl().url, "https://signed.example/video");
  assert.equal(receivedBucket, "bucket");
  assert.equal(receivedObjectKey, "wwpdw/poc/test.mp4");
  assert.equal(receivedExpires, 3600);
});
