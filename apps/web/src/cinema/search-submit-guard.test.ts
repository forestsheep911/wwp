import assert from "node:assert/strict";
import test from "node:test";
import { createSearchSubmitGuard } from "./search-submit-guard";
import { readFileSync } from "node:fs";

test("search input supplies both explicit and native form keyboard hints", () => {
  const source = readFileSync(new URL("./components/SearchDialog.tsx", import.meta.url), "utf8");
  assert.match(source, /<form action="\/" method="get" role="search"/);
  assert.match(source, /<textarea/);
  assert.match(source, /rows=\{1\}/);
  assert.match(source, /form\?\.requestSubmit\(\)/);
  assert.match(source, /enterKeyHint="search"/);
  assert.match(source, /event\.preventDefault\(\)/);
});

test("empty and busy searches are blocked", () => {
  const guard = createSearchSubmitGuard();
  assert.equal(guard.accept("  ", false), false);
  assert.equal(guard.accept("星际", true), false);
  assert.equal(guard.accept("星际", false), true);
});

test("candidate confirmation cannot submit; a later Enter can", () => {
  let now = 0;
  const guard = createSearchSubmitGuard(() => now);
  guard.compositionStart();
  assert.equal(guard.blocksEnter(), true);
  assert.equal(guard.accept("星际", false), false);
  guard.compositionEnd();
  assert.equal(guard.blocksEnter(), true);
  assert.equal(guard.accept("星际", false), false);
  now = 201;
  assert.equal(guard.blocksEnter(), false);
  assert.equal(guard.blocksEnter(true), true);
  assert.equal(guard.blocksEnter(false, 229), true);
  assert.equal(guard.accept("星际", false), true);
});

test("rapid duplicate events are blocked but retries and new queries work", () => {
  let now = 0;
  const guard = createSearchSubmitGuard(() => now);
  assert.equal(guard.accept("星际", false), true);
  assert.equal(guard.accept(" 星际 ", false), false);
  now = 501;
  assert.equal(guard.accept("星际", false), true);
  assert.equal(guard.accept("盗梦", false), true);
});
