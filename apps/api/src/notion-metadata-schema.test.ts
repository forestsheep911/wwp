import assert from "node:assert/strict";
import test from "node:test";

import {
  collectMetadataHintsFromText,
  createMetadataHints,
  mergeMetadataHints,
  normalizeMetacriticUrl,
  normalizeRottenTomatoesUrl,
  notionManagedProperties
} from "./notion-metadata-schema.js";
import { buildAiCheckUpdates, buildResolvedAiIssueUpdates } from "./notion-ai-check-state.js";
import { schemaPatch } from "./notion-schema-migration.js";

test("collectMetadataHintsFromText captures official critic rating page URLs", () => {
  const hints = createMetadataHints();

  collectMetadataHintsFromText(
    hints,
    [
      "Critic rating fallback:",
      "烂番茄新鲜度=90 (rotten-tomatoes-page, https://www.rottentomatoes.com/m/zodiac/reviews, 264 reviews);",
      "Metascore=79 (metacritic-page, https://www.metacritic.com/movie/zodiac/critic-reviews/, 40 reviews)"
    ].join(" ")
  );

  assert.equal(hints.externalIds.rottenTomatoes, "https://www.rottentomatoes.com/m/zodiac");
  assert.equal(hints.externalIds.metacritic, "https://www.metacritic.com/movie/zodiac");
  assert.equal(hints.sourceTexts.length, 1);
});

test("critic URL normalizers accept official movie and TV paths only", () => {
  assert.equal(
    normalizeRottenTomatoesUrl("https://www.rottentomatoes.com/tv/modern_love/s01/audience-reviews"),
    "https://www.rottentomatoes.com/tv/modern_love/s01"
  );
  assert.equal(
    normalizeMetacriticUrl("https://www.metacritic.com/tv/the-wire/user-reviews/."),
    "https://www.metacritic.com/tv/the-wire"
  );
  assert.equal(
    normalizeMetacriticUrl("https://www.metacritic.com/tv/the-bear/season-5/critic-reviews/"),
    "https://www.metacritic.com/tv/the-bear/season-5"
  );
  assert.equal(normalizeRottenTomatoesUrl("https://example.com/m/zodiac"), undefined);
  assert.equal(normalizeMetacriticUrl("https://www.metacritic.com/search/zodiac/"), undefined);
});

test("mergeMetadataHints preserves critic site URLs", () => {
  const first = createMetadataHints();
  const second = createMetadataHints();
  collectMetadataHintsFromText(first, "https://www.rottentomatoes.com/m/zodiac");
  collectMetadataHintsFromText(second, "https://www.metacritic.com/movie/zodiac");

  const merged = mergeMetadataHints(first, second);

  assert.equal(merged.externalIds.rottenTomatoes, "https://www.rottentomatoes.com/m/zodiac");
  assert.equal(merged.externalIds.metacritic, "https://www.metacritic.com/movie/zodiac");
});

test("managed schema separates collaboration, human issues, AI issues, and AI check time", () => {
  const byName = new Map(notionManagedProperties.map((property) => [property.name, property.type]));

  assert.equal(byName.get("Workflow Status"), "select");
  assert.equal(byName.get("Workflow Note"), "rich_text");
  assert.equal(byName.get("Human Issue"), "rich_text");
  assert.equal(byName.get("AI Issue"), "rich_text");
  assert.equal(byName.get("Last AI Check Time"), "date");
});

test("schema migration renames legacy Issue in place without adding a duplicate Human Issue", () => {
  const patch = schemaPatch({ Issue: { type: "rich_text", id: "legacy-issue" } });

  assert.deepEqual(patch.Issue, { name: "Human Issue" });
  assert.equal(patch["Human Issue"], undefined);
  assert.deepEqual(patch["AI Issue"], { rich_text: {} });
  assert.deepEqual(patch["Last AI Check Time"], { date: {} });
});

test("schema migration renames the live lowercase issue property in place", () => {
  const patch = schemaPatch({ issue: { type: "rich_text", id: "live-issue" } });

  assert.deepEqual(patch.issue, { name: "Human Issue" });
  assert.equal(patch["Human Issue"], undefined);
});

test("schema migration preserves both issue fields when legacy and human names coexist", () => {
  const patch = schemaPatch({
    Issue: { type: "rich_text", id: "legacy-issue" },
    "Human Issue": { type: "rich_text", id: "human-issue" }
  });

  assert.equal(patch.Issue, undefined);
  assert.equal(patch["Human Issue"], undefined);
});

test("completed AI check records time and unresolved AI issue without touching Human Issue", () => {
  const updates = buildAiCheckUpdates({
    checkedAt: "2026-07-13T14:30:00+08:00",
    unresolvedIssue: "资料不足，年龄建议需要人工复核"
  });

  assert.deepEqual(updates["Last AI Check Time"], { date: { start: "2026-07-13T14:30:00+08:00" } });
  assert.deepEqual(updates["AI Issue"], {
    rich_text: [{ type: "text", text: { content: "资料不足，年龄建议需要人工复核" } }]
  });
  assert.deepEqual(updates["Needs Review"], { checkbox: true });
  assert.equal(updates["Human Issue"], undefined);
  assert.equal(updates["Metadata Updated At"], undefined);
});

test("successful AI check with no unresolved issue updates only its check time", () => {
  const updates = buildAiCheckUpdates({ checkedAt: "2026-07-13" });

  assert.deepEqual(updates, { "Last AI Check Time": { date: { start: "2026-07-13" } } });
});

test("resolved family-age issue clears only its AI issue and preserves human review", () => {
  assert.deepEqual(buildResolvedAiIssueUpdates({
    existingAiIssue: "AI 年龄建议待复核：资料不足",
    humanIssue: "",
    resolvedPrefix: "AI 年龄建议待复核："
  }), {
    "AI Issue": { rich_text: [] },
    "Needs Review": { checkbox: false }
  });
  assert.deepEqual(buildResolvedAiIssueUpdates({
    existingAiIssue: "海报身份待复核",
    humanIssue: "",
    resolvedPrefix: "AI 年龄建议待复核："
  }), {});
  assert.deepEqual(buildResolvedAiIssueUpdates({
    existingAiIssue: "AI 年龄建议待复核：资料不足",
    humanIssue: "人工要求保留复核",
    resolvedPrefix: "AI 年龄建议待复核："
  }), {
    "AI Issue": { rich_text: [] }
  });
});
