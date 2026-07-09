import assert from "node:assert/strict";
import test from "node:test";

import {
  creditInputDisplayValue,
  parseCreditInputValue
} from "../src/cinema/admin-credit-input";

test("parseCreditInputValue keeps an empty numeric input editable", () => {
  assert.equal(Number.isNaN(parseCreditInputValue("")), true);
  assert.equal(Number.isNaN(parseCreditInputValue("   ")), true);
});

test("creditInputDisplayValue removes leading zeroes after parsing", () => {
  assert.equal(parseCreditInputValue("0100"), 100);
  assert.equal(creditInputDisplayValue(parseCreditInputValue("0100")), "100");
});

test("creditInputDisplayValue renders invalid numeric state as empty", () => {
  assert.equal(creditInputDisplayValue(Number.NaN), "");
});
