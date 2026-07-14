import assert from "node:assert/strict";
import test from "node:test";

import { allowedOrigins, clearSessionCookie, sessionCookie } from "./auth-http.js";

test("only configured web origins are accepted for credentialed browser access", () => {
  const origins = allowedOrigins("https://family.example, https://second.example/");
  assert.equal(origins.has("https://family.example"), true);
  assert.equal(origins.has("https://second.example"), true);
  assert.equal(origins.has("https://attacker.example"), false);
});

test("production session cookie is HttpOnly, Secure, and cross-site compatible", () => {
  const prior = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const cookie = sessionCookie("session.secret", "2026-08-14T00:00:00.000Z");
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=None/);
    assert.match(clearSessionCookie(), /Max-Age=0/);
  } finally {
    process.env.NODE_ENV = prior;
  }
});
