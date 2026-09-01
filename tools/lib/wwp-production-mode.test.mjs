import test from "node:test";
import assert from "node:assert/strict";
import { buildProductionModePlan, normalizeProductionMode } from "./wwp-production-mode.mjs";

test("film and current people is the default serialized plan", () => {
  const plan = buildProductionModePlan(normalizeProductionMode(), ["wwm_1", "wwm_1", "wwm_2"]);
  assert.deepEqual(plan.sequence, ["film", "people"]);
  assert.equal(plan.people.status, "eligible_after_film_checkpoint");
  assert.deepEqual(plan.people.workIds, ["wwm_1", "wwm_2"]);
});

test("single-lane modes disable the other lane", () => {
  assert.equal(buildProductionModePlan("film_only").people.enabled, false);
  assert.equal(buildProductionModePlan("people-only").film.enabled, false);
});

test("unknown modes fail closed", () => {
  assert.throws(() => normalizeProductionMode("parallel"), /--mode must be one of/);
});
