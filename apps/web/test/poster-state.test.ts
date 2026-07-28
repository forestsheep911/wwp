import assert from "node:assert/strict";
import test from "node:test";

import { posterIndexAfterImageEvent, posterUrlPriority } from "../src/cinema/poster-state";

test("a successfully loaded poster remains selected", () => {
  assert.equal(posterIndexAfterImageEvent(0, 2, "load"), 0);
});

test("a failed poster advances only while a fallback exists", () => {
  assert.equal(posterIndexAfterImageEvent(0, 2, "error"), 1);
  assert.equal(posterIndexAfterImageEvent(1, 2, "error"), undefined);
});

test("same-origin local poster URLs are preferred over remote fallbacks", () => {
  assert.equal(posterUrlPriority("/api/posters/0123456789abcdef0123456789abcdef"), 0);
  assert.equal(posterUrlPriority("https://example.blob.core.windows.net/posters/01.webp"), 1);
  assert.equal(posterUrlPriority("https://example.com/poster.jpg"), 2);
});

test("untrusted relative and insecure poster URLs are rejected", () => {
  assert.equal(posterUrlPriority("/uploads/poster.jpg"), 99);
  assert.equal(posterUrlPriority("http://example.com/poster.jpg"), 99);
});
