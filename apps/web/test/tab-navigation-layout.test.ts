import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const layoutSource = readFileSync(
  new URL("../src/cinema/components/CinemaLayout.tsx", import.meta.url),
  "utf8",
);
const librarySource = readFileSync(
  new URL("../src/cinema/components/LibraryTab.tsx", import.meta.url),
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

test("desktop library navigation stays fixed and contains touch scrolling", () => {
  assert.match(layoutSource, /className="min-w-0 overflow-x-clip"/);
  assert.doesNotMatch(layoutSource, /className="min-w-0 overflow-hidden"/);
  assert.match(librarySource, /data-desktop-library-sidebar/);
  assert.match(
    librarySource,
    /className="[^"\n]*fixed[^"\n]*bottom-4[^"\n]*top-\[4\.75rem\][^"\n]*touch-none[^"\n]*overflow-y-auto[^"\n]*overscroll-contain[^"\n]*"/,
  );
  assert.doesNotMatch(librarySource, /lg:sticky/);
  assert.match(librarySource, /addEventListener\("touchmove", handleTouchMove, \{ passive: false \}\)/);
  assert.match(librarySource, /event\.preventDefault\(\)/);
  assert.match(librarySource, /element\.scrollTop = Math\.max\(0, Math\.min\(maxScrollTop, element\.scrollTop \+ deltaY\)\)/);
});
