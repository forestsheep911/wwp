import test from "node:test";
import assert from "node:assert/strict";
import {
  isTransientNotionUploadError,
  withTransientNotionUploadRetry
} from "./notion-upload-retry.mjs";

test("recognizes transient Notion and network failures", () => {
  assert.equal(isTransientNotionUploadError({ status: 502 }), true);
  assert.equal(isTransientNotionUploadError({ status: 524 }), true);
  assert.equal(isTransientNotionUploadError({ code: "ECONNRESET" }), true);
  assert.equal(isTransientNotionUploadError(new Error("fetch failed")), true);
  assert.equal(isTransientNotionUploadError({ status: 400 }), false);
});

test("retries the same operation after transient failures", async () => {
  let calls = 0;
  const retries = [];
  const result = await withTransientNotionUploadRetry(async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("Bad gateway"), { status: 502 });
    return "ok";
  }, {
    maxAttempts: 4,
    baseDelayMs: 0,
    onRetry: (event) => retries.push(event.nextAttempt)
  });
  assert.equal(result, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(retries, [2, 3]);
});

test("does not retry permanent errors", async () => {
  let calls = 0;
  await assert.rejects(
    withTransientNotionUploadRetry(async () => {
      calls += 1;
      throw Object.assign(new Error("bad request"), { status: 400 });
    }, { baseDelayMs: 0 }),
    /bad request/
  );
  assert.equal(calls, 1);
});
