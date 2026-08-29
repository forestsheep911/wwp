import test from "node:test";
import assert from "node:assert/strict";
import { createPacedFetch } from "./notion-request-limiter.mjs";

test("serializes concurrent requests and keeps the requested start interval", async () => {
  let clock = 0;
  const starts = [];
  const waits = [];
  const fetch = createPacedFetch(async (value) => {
    starts.push([value, clock]);
    return value;
  }, {
    minIntervalMs: 1000,
    now: () => clock,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    }
  });

  assert.deepEqual(await Promise.all([fetch("a"), fetch("b"), fetch("c")]), ["a", "b", "c"]);
  assert.deepEqual(starts, [["a", 0], ["b", 1000], ["c", 2000]]);
  assert.deepEqual(waits, [1000, 1000]);
});

test("a rejected request does not break the shared queue", async () => {
  const calls = [];
  const fetch = createPacedFetch(async (value) => {
    calls.push(value);
    if (value === "bad") throw new Error("failed");
    return value;
  }, { minIntervalMs: 0 });

  const results = await Promise.allSettled([fetch("bad"), fetch("good")]);
  assert.equal(results[0].status, "rejected");
  assert.equal(results[1].status, "fulfilled");
  assert.deepEqual(calls, ["bad", "good"]);
});
