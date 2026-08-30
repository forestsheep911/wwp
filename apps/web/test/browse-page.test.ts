import assert from "node:assert/strict";
import test from "node:test";
import { mergeBrowsePage } from "../src/cinema/browse-page";

const row = (assetKey: string) => ({ assetKey });

test("a catalog reset replaces stale first-page and append results", () => {
  const stale = [row("old-1"), row("old-2")];
  const refreshed = [row("new-title"), row("old-1")];
  assert.deepEqual(
    mergeBrowsePage(stale, refreshed, { append: true, reset: true }),
    refreshed
  );
});

test("a matching catalog append keeps existing rows and de-duplicates overlap", () => {
  assert.deepEqual(
    mergeBrowsePage([row("a"), row("b")], [row("b"), row("c")], { append: true }),
    [row("a"), row("b"), row("c")]
  );
});
