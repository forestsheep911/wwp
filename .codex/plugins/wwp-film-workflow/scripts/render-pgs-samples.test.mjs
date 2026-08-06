import assert from "node:assert/strict";
import test from "node:test";
import { distinctEventTimes } from "./render-pgs-samples.mjs";

test("PGS sample times collapse packet fragments into distinct events", () => {
  assert.deepEqual(
    distinctEventTimes(["113.530089", "113.527956", "113.398344", "116.116000", "130.2"], 3),
    [113.530089, 116.116, 130.2]
  );
});

test("PGS sample times ignore invalid values and respect the event limit", () => {
  assert.deepEqual(distinctEventTimes(["NaN", "-1", "10", "11", "12"], 2), [10, 11]);
});
