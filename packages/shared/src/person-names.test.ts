import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizePersonNameSearchKey,
  selectPersonBiographyTexts,
  selectPersonDisplayNames,
  type PersonNameEntry
} from "./person-names.js";

const at = "2026-08-10T00:00:00.000Z";

function name(overrides: Partial<PersonNameEntry> & Pick<PersonNameEntry, "value">): PersonNameEntry {
  return {
    kind: "alternate",
    source: "external",
    status: "strong",
    observedAt: at,
    ...overrides
  };
}

test("selects Chinese, English, and native names by deterministic provenance", () => {
  const result = selectPersonDisplayNames([
    name({ value: "梁朝偉", language: "zh-hant", script: "Hant", source: "tmdb" }),
    name({ value: "梁朝伟", language: "zh-hans", script: "Hans", source: "wikidata" }),
    name({ value: "Tony Leung Chiu-wai", language: "en", script: "Latn", source: "imdb", kind: "display", status: "verified" }),
    name({ value: "梁朝偉", language: "yue", script: "Hant", source: "wikidata", kind: "original", status: "verified" })
  ]);

  assert.equal(result.primary, "梁朝伟");
  assert.equal(result.chinese, "梁朝伟");
  assert.equal(result.english, "Tony Leung Chiu-wai");
  assert.equal(result.original, "梁朝偉");
  assert.deepEqual(result.aliases, []);
});

test("locked manual values override provider precedence", () => {
  const result = selectPersonDisplayNames([
    name({ value: "Provider Name", language: "en", script: "Latn", source: "imdb", status: "verified" })
  ], { english: "Editor Name" });

  assert.equal(result.primary, "Editor Name");
  assert.equal(result.english, "Editor Name");
  assert.deepEqual(result.aliases, ["Provider Name"]);
});

test("provisional transliterations never become the formal Chinese name", () => {
  const result = selectPersonDisplayNames([
    name({ value: "自动音译名", language: "zh-hans", script: "Hans", kind: "transliteration", source: "external", status: "provisional" }),
    name({ value: "Original Name", language: "en", script: "Latn", source: "tmdb", status: "verified" })
  ]);

  assert.equal(result.chinese, undefined);
  assert.equal(result.primary, "Original Name");
  assert.deepEqual(result.aliases, ["自动音译名"]);
});

test("normalizes punctuation, spacing, case, and diacritics only for search", () => {
  assert.equal(normalizePersonNameSearchKey(" Chloë Zhao "), "chloezhao");
  assert.equal(normalizePersonNameSearchKey("Tony Leung Chiu-wai"), "tonyleungchiuwai");
  assert.equal(normalizePersonNameSearchKey("梁 朝伟"), "梁朝伟");
});

test("preserves stage names and surname-order variants as searchable aliases", () => {
  const result = selectPersonDisplayNames([
    name({ value: "Zhang Ziyi", language: "en", script: "Latn", source: "imdb", kind: "display", status: "verified" }),
    name({ value: "Ziyi Zhang", language: "en", script: "Latn", source: "tmdb", kind: "alternate" }),
    name({ value: "章子怡", language: "zh-hans", script: "Hans", source: "wikidata", kind: "stage", status: "verified" })
  ]);

  assert.equal(result.primary, "章子怡");
  assert.equal(result.english, "Zhang Ziyi");
  assert.deepEqual(result.aliases, ["Ziyi Zhang"]);
});

test("selects independently sourced Chinese and English biographies", () => {
  const result = selectPersonBiographyTexts({
    source: "tmdb",
    texts: [
      { value: "中文小传", language: "zh-CN", source: "notion", status: "verified", observedAt: at },
      { value: "English biography", language: "en", source: "tmdb", status: "strong", observedAt: at }
    ]
  });
  assert.deepEqual(result, { chinese: "中文小传", english: "English biography", fallback: "中文小传" });
});

test("returns no biography text when localized evidence is absent", () => {
  assert.deepEqual(selectPersonBiographyTexts({ source: "tmdb" }), {});
});
