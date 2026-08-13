import assert from "node:assert/strict";
import test from "node:test";

import { fetchProviderJson, ProviderHttpError, ProviderRateLimiter, retryAfterMilliseconds } from "./provider-http.js";

test("parses Retry-After seconds and HTTP dates", () => {
  assert.equal(retryAfterMilliseconds("2"), 2_000);
  assert.equal(retryAfterMilliseconds("Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("Wed, 21 Oct 2015 07:27:58 GMT")), 2_000);
  assert.equal(retryAfterMilliseconds("invalid"), undefined);
});

test("serializes requests through one shared rate limiter", async () => {
  let now = 1_000;
  const sleeps: number[] = [];
  const limiter = new ProviderRateLimiter(250, () => now, async (milliseconds) => {
    sleeps.push(milliseconds);
    now += milliseconds;
  });
  const starts: number[] = [];

  await Promise.all([
    limiter.schedule(async () => starts.push(now)),
    limiter.schedule(async () => starts.push(now)),
    limiter.schedule(async () => starts.push(now))
  ]);

  assert.deepEqual(starts, [1_000, 1_250, 1_500]);
  assert.deepEqual(sleeps, [250, 250]);
});

test("surfaces provider status and retry delay", async () => {
  const fetchImpl = async () => new Response("busy", {
    status: 429,
    headers: { "retry-after": "3" }
  });

  await assert.rejects(
    fetchProviderJson({
      url: "https://example.test",
      provider: "Example",
      fetchImpl,
      limiter: new ProviderRateLimiter(0)
    }),
    (error: unknown) => error instanceof ProviderHttpError && error.status === 429 && error.retryAfterMs === 3_000
  );
});
