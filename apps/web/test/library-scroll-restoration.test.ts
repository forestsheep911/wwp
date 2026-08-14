import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const librarySource = readFileSync(
  new URL("../src/cinema/components/LibraryTab.tsx", import.meta.url),
  "utf8"
);

test("library scroll restoration runs before paint without an initial frame delay", () => {
  const restorationEffect = appSource.slice(
    appSource.indexOf('useLayoutEffect(() => {\n    if (activeTab !== "library" || detailAssetKey)'),
    appSource.indexOf("function rememberPlaybackLine")
  );

  assert.match(restorationEffect, /restore\(\);/);
  assert.doesNotMatch(
    restorationEffect,
    /requestAnimationFrame\(\(\) => \{\s*frame = window\.requestAnimationFrame\(restore\)/
  );
});

test("opening a detail keeps the existing list surface mounted", () => {
  assert.match(librarySource, /setPreserveListDuringDetail\(true\)/);
  assert.match(librarySource, /const displayedDetailResult = detailAssetKey \? detailResult : undefined/);
  assert.match(librarySource, /const renderListSurface = !detailVisible \|\| preserveListDuringDetail/);
  assert.match(librarySource, /className=\{detailVisible \? "hidden" : "contents"\}/);
  assert.match(librarySource, /data-library-list-surface/);
});
