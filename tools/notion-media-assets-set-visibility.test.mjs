import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("visibility override requires a concrete reason before hiding", () => {
  const source = fs.readFileSync(new URL("./notion-media-assets-set-visibility.mjs", import.meta.url), "utf8");
  assert.match(source, /options\.updateWork\s*\n\s*\? workVisibilityHideReasonIsConcrete\(options\.reason\)/u);
  assert.match(source, /:\s*visibilityHideReasonIsConcrete\(options\.reason\)/u);
  assert.match(source, /--hidden true requires --reason with a concrete viewing/u);
  assert.match(source, /metadata follow-up is not a hiding reason/u);
});

test("a child defect cannot hide the whole work", () => {
  const source = fs.readFileSync(new URL("./notion-media-assets-set-visibility.mjs", import.meta.url), "utf8");
  assert.match(source, /workVisibilityHideReasonIsConcrete\(options\.reason\)/u);
  assert.match(source, /options\.updateWork/u);
});
