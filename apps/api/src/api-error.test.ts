import assert from "node:assert/strict";
import test from "node:test";

import { internalServerErrorPayload } from "./api-error.js";

test("internal server errors expose no implementation details", () => {
  const payload = internalServerErrorPayload("request-123");
  const response = JSON.stringify(payload);

  assert.deepEqual(payload, {
    error: "服务器暂时无法完成请求，请稍后重试。",
    requestId: "request-123"
  });
  assert.doesNotMatch(response, /[A-Z]:\\/i);
  assert.doesNotMatch(response, /EPERM|rename|session-state/i);
});
