import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const libraryTab = readFileSync(new URL("../src/cinema/components/LibraryTab.tsx", import.meta.url), "utf8");

test("returning from a detail opened in search restores the original library context", () => {
  const openSearchResult = source.slice(
    source.indexOf("function openSearchResult"),
    source.indexOf("async function refreshResultsInBackground")
  );
  const closeLibraryDetail = source.slice(
    source.indexOf("function closeLibraryDetail"),
    source.indexOf("function clearSearchResults")
  );

  assert.match(openSearchResult, /setDetailOpenedFromSearch\(true\)/);
  assert.match(closeLibraryDetail, /if \(detailOpenedFromSearch\)/);
  assert.match(closeLibraryDetail, /const origin = searchDialogOriginRef\.current/);
  assert.match(closeLibraryDetail, /setBrowseChannel\(origin\.browseChannel\)/);
  assert.match(closeLibraryDetail, /queueLibraryScrollRestore\(origin\)/);
  assert.match(closeLibraryDetail, /playerAssetKey: undefined\s*\}, "push"\)/);
  assert.match(closeLibraryDetail, /setDetailOpenedFromSearch\(false\)/);
});

test("ordinary library details retain the normal list return path", () => {
  const openLibraryDetail = source.slice(
    source.indexOf("function openLibraryDetail"),
    source.indexOf("async function loadPersonDetail")
  );
  assert.match(openLibraryDetail, /setDetailOpenedFromSearch\(false\)/);
});

test("search-opened details use the ordinary library return label", () => {
  assert.match(libraryTab, /backLabel=\{copy\.library\.backToList\}/);
  assert.doesNotMatch(libraryTab, /backLabel=\{hasQuery \? copy\.library\.backToSearchResults/);
});

test("search dialog submission does not reopen the legacy result list", () => {
  const dialogSearch = source.slice(
    source.indexOf("function runDialogSearch"),
    source.indexOf("function openSearchDialog")
  );
  assert.match(dialogSearch, /event\?\.preventDefault\(\)/);
  assert.doesNotMatch(dialogSearch, /runSearch\(/);
});
