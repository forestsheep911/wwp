import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const layoutSource = readFileSync(
  new URL("../src/cinema/components/CinemaLayout.tsx", import.meta.url),
  "utf8",
);

test("switching primary tabs returns the page to the top", () => {
  const navigateToTab = appSource.match(
    /function navigateToTab\([\s\S]*?\n  function openBrowsePreset/,
  )?.[0];

  assert.ok(navigateToTab);
  assert.match(
    navigateToTab,
    /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/,
  );
});

test("desktop layout reserves a stable vertical scrollbar gutter", () => {
  assert.match(
    stylesSource,
    /@media \(min-width: 640px\)[\s\S]*?scrollbar-gutter: stable/,
  );
});

test("the account menu does not lock or reposition the document scroll", () => {
  assert.match(layoutSource, /<DropdownMenu modal=\{false\} open=\{open\}/);
});
