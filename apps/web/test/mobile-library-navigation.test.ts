import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../src/cinema/components/LibraryTab.tsx", import.meta.url),
  "utf8"
);
const layoutSource = readFileSync(
  new URL("../src/cinema/components/CinemaLayout.tsx", import.meta.url),
  "utf8"
);
const stylesSource = readFileSync(
  new URL("../src/styles.css", import.meta.url),
  "utf8"
);

test("phone and portrait tablet navigation mirrors the desktop library and ranking sections", () => {
  const mobileNavigation = source.slice(
    source.indexOf("function MobileBrowseNavigation"),
    source.indexOf("function DesktopBrowseFilter")
  );
  assert.match(mobileNavigation, /aria-label="片库分类"/);
  assert.match(mobileNavigation, /aria-label="电影榜单"/);
  assert.match(mobileNavigation, /onBrowsePresetChange\(channel\.id, "newGood"\)/);
  assert.match(mobileNavigation, /onBrowsePresetChange\("movie", view\.id\)/);
  assert.match(mobileNavigation, /lg:hidden/);
  assert.doesNotMatch(mobileNavigation, /sm:hidden/);
  assert.doesNotMatch(layoutSource, /aria-label=\{copy\.layout\.browseLabel\}/);
  assert.doesNotMatch(source, /sm:block lg:hidden/);
});

test("portrait tablets use the poster gallery instead of detailed mobile cards", () => {
  assert.match(source, /focus-visible:ring-emerald-400 md:grid/);
  assert.match(source, /sm:rounded-lg sm:p-4 md:hidden/);
  assert.match(
    stylesSource,
    /@media \(min-width: 768px\) and \(max-width: 1023px\)[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/
  );
});

test("the shared library filter is available on mobile and starts collapsed", () => {
  assert.doesNotMatch(source, /className="hidden overflow-hidden rounded-xl border border-slate-800\/90 bg-slate-950\/72 shadow-xl shadow-black\/10 backdrop-blur lg:block"/);
  assert.match(source, /window\.matchMedia\("\(min-width: 1024px\)"\)\.matches/);
});
