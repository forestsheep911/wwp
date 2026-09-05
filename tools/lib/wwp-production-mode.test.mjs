import test from "node:test";
import assert from "node:assert/strict";
import { buildProductionModePlan, normalizeProductionMode } from "./wwp-production-mode.mjs";

test("film and current enrichment is the default serialized plan", () => {
  const plan = buildProductionModePlan(normalizeProductionMode(), ["wwm_1", "wwm_1", "wwm_2"]);
  assert.deepEqual(plan.sequence, ["film", "base-metadata", "people", "honors", "highlights"]);
  assert.equal(plan.enrichment.status, "eligible_after_film_checkpoint");
  assert.deepEqual(plan.enrichment.workIds, ["wwm_1", "wwm_2"]);
});

test("single-lane modes disable the other lane", () => {
  assert.equal(buildProductionModePlan("film_only").people.enabled, false);
  assert.equal(buildProductionModePlan("people-only").film.enabled, false);
  assert.equal(buildProductionModePlan("enrichment-only").film.enabled, false);
});

test("film and current people remains an explicitly narrower mode", () => {
  const plan = buildProductionModePlan("film-and-current-people", ["wwm_9"]);
  assert.deepEqual(plan.sequence, ["film", "people"]);
  assert.deepEqual(plan.people.workIds, ["wwm_9"]);
});

test("unknown modes fail closed", () => {
  assert.throws(() => normalizeProductionMode("parallel"), /--mode must be one of/);
});
