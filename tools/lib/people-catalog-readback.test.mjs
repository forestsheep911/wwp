import test from "node:test";
import assert from "node:assert/strict";
import { missingLinkedCreditKeys, verifyPeopleCatalogReadback } from "./people-catalog-readback.mjs";

const result = (personId) => ({
  assetKey: "asset-1",
  metadata: { work: { credits: [{ name: "A", department: "acting", job: "Actor", personId }] } }
});

test("people readback detects a relation that is not visible in the index", () => {
  assert.deepEqual(missingLinkedCreditKeys(result("person-a"), result(undefined)), ["acting|Actor|A=>person-a"]);
});

test("people readback retries eventual index visibility", async () => {
  let reads = 0;
  const check = await verifyPeopleCatalogReadback({
    searchStore: { getResult: async () => (++reads < 2 ? result(undefined) : result("person-a")) },
    expectedResults: [result("person-a")],
    attempts: 2,
    delayMs: 0
  });
  assert.equal(check.verified, true);
  assert.equal(check.attempts, 2);
});
