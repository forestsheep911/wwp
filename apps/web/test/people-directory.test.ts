import assert from "node:assert/strict";
import test from "node:test";

import { normalizePersonDirectoryQuery } from "../src/cinema/people-directory.js";

test("normalizes bilingual directory search consistently", () => {
  assert.equal(normalizePersonDirectoryQuery(" Hirokazu Kore-eda "), "hirokazukoreeda");
  assert.equal(normalizePersonDirectoryQuery("是枝 裕和"), "是枝裕和");
});
