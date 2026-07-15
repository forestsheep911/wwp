import assert from "node:assert/strict";
import test from "node:test";

import { retryAfterCsrfRecovery } from "../src/csrf-recovery";

test("retries one rejected action after refreshing an in-memory CSRF token", async () => {
  let attempts = 0;
  let refreshes = 0;

  const result = await retryAfterCsrfRecovery(
    async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Cross-site request verification failed.");
      }
      return "accepted";
    },
    async () => {
      refreshes += 1;
    },
    (error) => error instanceof Error && error.message === "Cross-site request verification failed."
  );

  assert.equal(result, "accepted");
  assert.equal(refreshes, 1);
  assert.equal(attempts, 2);
});

test("does not retry a rejection that is not a CSRF verification failure", async () => {
  let attempts = 0;
  let refreshes = 0;

  await assert.rejects(
    retryAfterCsrfRecovery(
      async () => {
        attempts += 1;
        throw new Error("Access key did not match.");
      },
      async () => {
        refreshes += 1;
      },
      (error) => error instanceof Error && error.message === "Cross-site request verification failed."
    ),
    /Access key did not match\./
  );

  assert.equal(refreshes, 0);
  assert.equal(attempts, 1);
});
