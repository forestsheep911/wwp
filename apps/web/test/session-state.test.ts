import assert from "node:assert/strict";
import test from "node:test";
import { readSession, writeSession, setSessionScope, clearSessionState } from "../src/cinema/session-state";
test("session state survives unavailable browser storage and isolates accounts", () => {
 setSessionScope("a"); writeSession("search", { query: "电影", results: [1] });
 setSessionScope("b"); assert.equal(readSession("search", undefined), undefined);
 setSessionScope("a"); assert.deepEqual(readSession("search", undefined), { query:"电影",results:[1] });
 clearSessionState(); assert.equal(readSession("search", undefined), undefined);
});

test("oversized search keeps a compact reload query and full in-memory results", () => {
 const storage: Record<string, string> = {};
 Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
  getItem: (key: string) => storage[key] ?? null,
  setItem: (key: string, value: string) => { storage[key] = value; },
  removeItem: (key: string) => { delete storage[key]; },
 } });
 try {
  setSessionScope("large");
  const full = { query: "large query", results: "x".repeat(1_000_001) };
  const compact = { query: "large query", results: [], savedAt: 0 };
  writeSession("search", full, compact);
  assert.deepEqual(JSON.parse(Object.values(storage)[0]).value, compact);
  assert.deepEqual(readSession("search", undefined), full);
 } finally { clearSessionState(); Reflect.deleteProperty(globalThis, "sessionStorage"); }
});
