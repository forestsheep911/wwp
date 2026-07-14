import assert from "node:assert/strict";
import test from "node:test";

import { apiRequestUrl, healthRequestUrl, normalizeApiBaseUrl } from "../src/api-routing";

test("production requests stay on the current Static Web Apps origin", () => {
  assert.equal(normalizeApiBaseUrl(undefined), "");
  assert.equal(apiRequestUrl("", "/api/auth/login"), "/api/auth/login");
  assert.equal(healthRequestUrl(""), "/api/health");
});

test("local direct API development keeps the unprefixed health endpoint", () => {
  const base = normalizeApiBaseUrl("http://127.0.0.1:8787/");
  assert.equal(apiRequestUrl(base, "/api/auth/check"), "http://127.0.0.1:8787/api/auth/check");
  assert.equal(healthRequestUrl(base), "http://127.0.0.1:8787/health");
});
