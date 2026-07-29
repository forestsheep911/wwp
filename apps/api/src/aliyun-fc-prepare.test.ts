import assert from "node:assert/strict";
import test from "node:test";

import { __test } from "./aliyun-fc-prepare.js";

test("FC task IDs are stable, valid and bounded", () => {
  const taskId = __test.safeTaskId(`123 bad/${"x".repeat(200)}`);
  assert.match(taskId, /^[A-Za-z_][A-Za-z0-9_-]+$/);
  assert.equal(taskId.length, 128);
});
