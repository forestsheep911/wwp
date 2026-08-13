import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const libraryTab = readFileSync(
  new URL("../src/cinema/components/LibraryTab.tsx", import.meta.url),
  "utf8"
);

test("detail age panel separates the site guard from the original classification", () => {
  assert.match(libraryTab, /<ShieldCheck className="h-4 w-4" aria-hidden="true"\s*\/>/);
  assert.match(libraryTab, /<span className="text-xs font-medium text-slate-500">分级<\/span>/);
  assert.match(libraryTab, /visibleTags\(metadata\?\.ratingLevel\)\.slice\(0, 2\)/);
});

test("detail age panel does not render AI provenance, confidence, or generated reasons", () => {
  const panel = libraryTab.slice(
    libraryTab.indexOf("function AgeRecommendationPanel"),
    libraryTab.indexOf("function cardTags")
  );
  assert.doesNotMatch(panel, /sourceLabel|confidenceLabel|recommendation\.reason/);
});

test("original classifications remain visible without a site age suggestion", () => {
  assert.match(libraryTab, /if \(!hasAge && ratingLevel\.length === 0 && riskTags\.length === 0\)/);
});
