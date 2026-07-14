import assert from "node:assert/strict";
import test from "node:test";

import { posterIndexAfterImageEvent } from "../src/cinema/poster-state";

test("a successfully loaded poster remains selected", () => {
  assert.equal(posterIndexAfterImageEvent(0, 2, "load"), 0);
});

test("a failed poster advances only while a fallback exists", () => {
  assert.equal(posterIndexAfterImageEvent(0, 2, "error"), 1);
  assert.equal(posterIndexAfterImageEvent(1, 2, "error"), undefined);
});
