import test from "node:test";
import assert from "node:assert/strict";
import { createNotionPacedFetch } from "./notion-source.js";
import { ProviderRateLimiter } from "./person-sources/provider-http.js";

test("Notion source fetches share one serial rate limiter", async () => {
  let active = 0;
  let maximumActive = 0;
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    calls.push(String(input));
    await Promise.resolve();
    active -= 1;
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const paced = createNotionPacedFetch(fetchImpl, new ProviderRateLimiter(0));

  await Promise.all([
    paced("https://api.notion.com/a"),
    paced("https://api.notion.com/b"),
    paced("https://api.notion.com/c")
  ]);

  assert.equal(maximumActive, 1);
  assert.deepEqual(calls, [
    "https://api.notion.com/a",
    "https://api.notion.com/b",
    "https://api.notion.com/c"
  ]);
});
