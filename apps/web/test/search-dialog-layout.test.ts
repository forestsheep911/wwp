import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/cinema/components/SearchDialog.tsx", import.meta.url),
  "utf8"
);

test("desktop search dialog keeps one stable viewport before and after results load", () => {
  assert.match(source, /sm:h-\[min\(86vh,780px\)\]/);
  assert.match(source, /sm:grid-rows-\[auto_auto_minmax\(0,1fr\)\]/);
  assert.match(source, /sm:\[scrollbar-gutter:stable\]/);
});

test("search loading indicator reserves its width while idle", () => {
  assert.match(source, /grid h-5 w-5 shrink-0 place-items-center/);
});

test("desktop search keeps results in the dialog instead of offering a legacy list transition", () => {
  assert.doesNotMatch(source, /copy\.search\.viewAll/);
});
