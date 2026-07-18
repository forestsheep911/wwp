import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { unwrapAuthenticatedSession } from "../src/cinema/auth-session";

test("login session envelopes expose the nested authenticated role", () => {
  const response = {
    auth: {
      ok: true as const,
      role: "admin" as const
    },
    csrfToken: "csrf-value"
  };

  assert.deepEqual(unwrapAuthenticatedSession(response), response.auth);
});

test("the login API unwraps the authenticated session envelope before handing off", () => {
  const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");
  const loginStart = apiSource.indexOf("export function login");
  const loginEnd = apiSource.indexOf("\nexport function logout", loginStart);
  const loginSource = apiSource.slice(loginStart, loginEnd);

  assert.match(loginSource, /request<AuthenticatedSessionEnvelope>/);
  assert.match(loginSource, /return unwrapAuthenticatedSession\(response\);/);
});
