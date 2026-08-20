import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldOpenDetailInCurrentTab } from "../src/cinema/detail-link";

const plainClick = {
  altKey: false,
  button: 0,
  ctrlKey: false,
  defaultPrevented: false,
  metaKey: false,
  shiftKey: false
};

test("only an unmodified primary click uses in-page detail navigation", () => {
  assert.equal(shouldOpenDetailInCurrentTab(plainClick), true);
  assert.equal(shouldOpenDetailInCurrentTab({ ...plainClick, ctrlKey: true }), false);
  assert.equal(shouldOpenDetailInCurrentTab({ ...plainClick, metaKey: true }), false);
  assert.equal(shouldOpenDetailInCurrentTab({ ...plainClick, button: 1 }), false);
  assert.equal(shouldOpenDetailInCurrentTab({ ...plainClick, shiftKey: true }), false);
  assert.equal(shouldOpenDetailInCurrentTab({ ...plainClick, altKey: true }), false);
  assert.equal(shouldOpenDetailInCurrentTab({ ...plainClick, defaultPrevented: true }), false);
});

test("gallery and list detail entry points expose real href links", () => {
  const source = readFileSync(
    new URL("../src/cinema/components/LibraryTab.tsx", import.meta.url),
    "utf8"
  );

  assert.match(source, /data-gallery-card[\s\S]{0,160}href=\{getDetailHref\(result\)\}/);
  assert.match(source, /function MovieListView[\s\S]+href=\{getDetailHref\(result\)\}/);
  assert.match(source, /onClick=\{\(event\) => openDetailFromLink\(event, result, onOpenDetail\)\}/);
});
