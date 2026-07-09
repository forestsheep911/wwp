import assert from "node:assert/strict";
import test from "node:test";

import {
  serviceWakeIsWarm,
  serviceWakeShouldShowQuiz,
  serviceWakeWarmUntil
} from "../src/cinema/service-wake";

test("serviceWakeShouldShowQuiz only opens for a slow cold-start probe", () => {
  const now = 10_000;
  const delayMs = 1_600;

  assert.equal(serviceWakeShouldShowQuiz({
    nowMs: now,
    delayMs,
    probeStartedAtMs: undefined,
    warmUntilMs: 0
  }), false);

  assert.equal(serviceWakeShouldShowQuiz({
    nowMs: now,
    delayMs,
    probeStartedAtMs: now - 800,
    warmUntilMs: 0
  }), false);

  assert.equal(serviceWakeShouldShowQuiz({
    nowMs: now,
    delayMs,
    probeStartedAtMs: now - delayMs,
    warmUntilMs: 0
  }), true);
});

test("serviceWake warm TTL suppresses the quiz even when regular API work is slow", () => {
  const now = 20_000;
  const warmUntilMs = serviceWakeWarmUntil(now, 10_000);

  assert.equal(serviceWakeIsWarm(warmUntilMs, now + 9_999), true);
  assert.equal(serviceWakeIsWarm(warmUntilMs, now + 10_001), false);
  assert.equal(serviceWakeShouldShowQuiz({
    nowMs: now + 2_000,
    delayMs: 1_600,
    probeStartedAtMs: now,
    warmUntilMs
  }), false);
});
