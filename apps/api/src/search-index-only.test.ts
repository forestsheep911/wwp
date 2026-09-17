import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("./server.ts", import.meta.url), "utf8");
const start = source.indexOf("async function loadSearchResultsFromPersistentSources(");
const end = source.indexOf("\nfunction retrySearchQuery", start);
const executable = ts.transpile(source.slice(start, end), { target: ts.ScriptTarget.ES2022 });

function loader(search: (query: string, limit: number) => Promise<unknown[]>, enabled = true) {
  return runInNewContext(`${executable}; loadSearchResultsFromPersistentSources`, {
    searchIndexEnabled: enabled,
    searchIndexResultLimit: 8,
    searchIndex: { search },
    logWarn() {},
    errorLogFields() { return {}; },
    searchSource: { search() { throw new Error("Notion must not be called"); } },
    refreshIndexedMediaAssetResults() { throw new Error("No live refresh during search"); }
  });
}

test("index hit is returned without Notion refresh", async () => {
  const rows = [{ assetKey: "movie-1" }];
  const result = await loader(async (query, limit) => {
    assert.equal(query, "kokuho");
    assert.equal(limit, 8);
    return rows;
  })("kokuho");
  assert.equal(result.results, rows);
});

test("index miss returns no results without source fallback", async () => {
  const result = await loader(async () => [])("missing");
  assert.equal(result.results.length, 0);
});

test("index failure is not hidden by a Notion fallback", async () => {
  await assert.rejects(loader(async () => { throw new Error("index unavailable"); })("movie"), /index unavailable/);
});

test("disabled index never uses live Notion search", async () => {
  await assert.rejects(loader(async () => [], false)("movie"), /index is disabled/);
});

test("memory-cache hits do not refresh Notion", () => {
  const body = source.slice(source.indexOf("async function loadSearchResults(query:"), source.indexOf("async function writeSearchResultsToIndex"));
  assert.doesNotMatch(body, /refreshIndexedMediaAssetResults|searchSource\.search/);
});

test("dialog search is submit-driven, with an explicit touch button", () => {
  const app = readFileSync(new URL("../../web/src/App.tsx", import.meta.url), "utf8");
  const dialog = readFileSync(new URL("../../web/src/cinema/components/SearchDialog.tsx", import.meta.url), "utf8");
  assert.match(app, /if \(query\.trim\(\)\) setSubmittedSearch\(\{ query: query\.trim\(\) \}\)/);
  assert.match(app, /\}, \[submittedSearch, searchOpen\]\)/);
  assert.doesNotMatch(app, /\}, \[query, searchOpen\]\)/);
  assert.match(dialog, /type="submit"/);
  assert.match(dialog, /enterKeyHint="search"/);
  assert.match(dialog, /submittedQuery\?\.trim\(\)/);
});
