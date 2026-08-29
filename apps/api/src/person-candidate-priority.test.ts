import assert from "node:assert/strict";
import test from "node:test";
import { prioritizePeopleCandidateBatch, prioritizePeopleCandidates } from "./person-candidate-priority.js";

test("uses existing top-cast strings to rank unordered Wikidata acting credits", () => {
  const ordered = prioritizePeopleCandidates([
    { name: "Cameo", originalName: "Jim Lovell", department: "acting", externalIds: { wikidata: "Q1" } },
    { name: "汤姆·汉克斯", originalName: "Tom Hanks", department: "acting", externalIds: { wikidata: "Q2" } },
    { name: "朗·霍华德", originalName: "Ron Howard", department: "directing", externalIds: { wikidata: "Q3" } },
    { name: "凯文·贝肯", originalName: "Kevin Bacon", department: "acting", externalIds: { wikidata: "Q4" } }
  ], [
    { name: "Tom Hanks", department: "acting" },
    { name: "Kevin Bacon", department: "acting" }
  ]);

  assert.deepEqual(ordered.map((credit) => credit.externalIds?.wikidata), ["Q3", "Q2", "Q4", "Q1"]);
});

test("places anchored principal cast before secondary crew departments", () => {
  const ordered = prioritizePeopleCandidates([
    { name: "Producer", department: "production" },
    { name: "Lead", originalName: "Lead Actor", department: "acting" },
    { name: "Director", department: "directing" },
    { name: "Writer", department: "writing" }
  ], [{ name: "Lead Actor", department: "acting" }]);
  assert.deepEqual(ordered.map((credit) => credit.name), ["Director", "Writer", "Lead", "Producer"]);
});

test("retains department and statement order when no prominence anchors exist", () => {
  const ordered = prioritizePeopleCandidates([
    { name: "Second", department: "acting", order: 2 },
    { name: "Writer", department: "writing" },
    { name: "First", department: "acting", order: 1 }
  ]);
  assert.deepEqual(ordered.map((credit) => credit.name), ["Writer", "First", "Second"]);
});

test("reserves the front of a small batch for anchored principal cast", () => {
  const ordered = prioritizePeopleCandidateBatch([
    { name: "Director", department: "directing", externalIds: { wikidata: "QD" } },
    { name: "Writer 1", department: "writing", externalIds: { wikidata: "QW1" } },
    { name: "Writer 2", department: "writing", externalIds: { wikidata: "QW2" } },
    { name: "Writer 3", department: "writing", externalIds: { wikidata: "QW3" } },
    { name: "主演甲", originalName: "Lead One", department: "acting", externalIds: { wikidata: "QA1" } },
    { name: "主演乙", originalName: "Lead Two", department: "acting", externalIds: { wikidata: "QA2" } }
  ], [
    { name: "Lead One", department: "acting" },
    { name: "Lead Two", department: "acting" }
  ]);
  assert.deepEqual(ordered.slice(0, 5).map((credit) => credit.externalIds?.wikidata), ["QD", "QW1", "QW2", "QA1", "QA2"]);
});

test("does not promote a cameo from a same-name writing anchor", () => {
  const ordered = prioritizePeopleCandidateBatch([
    { name: "作者本人", originalName: "Source Author", department: "acting", externalIds: { wikidata: "QC" } },
    { name: "主演", originalName: "Lead Actor", department: "acting", externalIds: { wikidata: "QL" } }
  ], [
    { name: "Source Author", department: "writing" },
    { name: "Lead Actor", department: "acting" }
  ]);
  assert.deepEqual(ordered.map((credit) => credit.externalIds?.wikidata), ["QL", "QC"]);
});
