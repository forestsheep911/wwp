import assert from "node:assert/strict";
import test from "node:test";
import { loadingGridCount, remainingLoadingCount } from "../src/cinema/loading-grid";

test("wide screen placeholders fill complete rows and the remaining viewport", () => {
  assert.equal(loadingGridCount(10, 380, 24, 700), 20);
  assert.equal(loadingGridCount(3, 400, 24, 850), 9);
});

test("partial results retain only the missing visible slots", () => {
  assert.equal(remainingLoadingCount(30, 10, 12), 18);
  assert.equal(remainingLoadingCount(30, 10, 24), 6);
  assert.equal(remainingLoadingCount(30, 10, 30), 0);
  assert.equal(remainingLoadingCount(20, 10, 32), 8);
  assert.equal(remainingLoadingCount(3, 1, 12), 0);
});
test("phone placeholders cover the viewport without adding an unnecessary full row", () => {
  assert.equal(loadingGridCount(1, 300, 16, 616), 2);
  assert.equal(loadingGridCount(1, 300, 16, 617), 3);
});
test("below-fold and not-yet-measurable grids keep one complete row", () => {
  assert.equal(loadingGridCount(6, 380, 24, -100), 6);
  assert.equal(loadingGridCount(6, 0, 24, 700), 6);
});
