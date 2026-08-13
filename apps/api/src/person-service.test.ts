import assert from "node:assert/strict";
import test from "node:test";
import type { PersonCatalogState } from "@wwpdw/shared";

import { getPublicPerson, listPublicPeople, listPublicPersonIssues } from "./person-service.js";

function fixture(): PersonCatalogState {
  const observedAt = "2026-08-10T00:00:00.000Z";
  return {
    schemaVersion: 1,
    generatedAt: observedAt,
    people: {
      "person-a": { profile: { personId: "person-a", names: [
        { value: "梁朝伟", language: "zh-cn", kind: "display", source: "wikidata", status: "strong", observedAt },
        { value: "Tony Leung", language: "en", kind: "alternate", source: "wikidata", status: "strong", observedAt }
      ], departments: ["acting"], dataQuality: { status: "partial", updatedAt: observedAt }, createdAt: observedAt, updatedAt: observedAt }, workIds: ["work-a"], updatedAt: observedAt },
      "person-hidden": { profile: { personId: "person-hidden", names: [{ value: "Hidden", language: "en", kind: "display", source: "manual", status: "verified", observedAt }], hiddenFromWebsite: true, dataQuality: { status: "verified", updatedAt: observedAt }, createdAt: observedAt, updatedAt: observedAt }, workIds: [], updatedAt: observedAt }
    },
    redirects: { "person-old": "person-a" },
    externalIdIndex: { tmdb: {}, imdb: {}, wikidata: {} },
    aliasIndex: { "梁朝伟": ["person-a"], tonyleung: ["person-a"], hidden: ["person-hidden"] },
    creditsByWorkId: { "work-a": [{ personId: "person-a", name: "梁朝伟", department: "acting" }] },
    creditsByPersonId: { "person-a": [{ personId: "person-a", name: "梁朝伟", department: "acting", workId: "work-a", workTitle: "花样年华" }] },
    issues: []
  };
}

test("searches aliases but returns stable identity candidates", () => {
  const response = listPublicPeople(fixture(), { query: "Tony" });
  assert.equal(response.total, 1);
  assert.equal(response.people[0].personId, "person-a");
  assert.equal(response.people[0].names.primary, "梁朝伟");
  assert.equal(response.people[0].dataStatus, "partial");
});

test("paginates the stable directory order and reports full-directory totals", () => {
  const state = fixture();
  state.people["person-b"] = {
    profile: {
      personId: "person-b",
      names: [{ value: "王家卫", language: "zh-cn", kind: "display", source: "manual", status: "verified", observedAt: "2026-08-10T00:00:00.000Z" }],
      departments: ["directing"],
      dataQuality: { status: "verified", updatedAt: "2026-08-10T00:00:00.000Z" },
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z"
    },
    workIds: ["work-b"],
    updatedAt: "2026-08-10T00:00:00.000Z"
  };
  state.creditsByPersonId["person-b"] = [{ personId: "person-b", name: "王家卫", department: "directing", workId: "work-b", workTitle: "重庆森林" }];
  const first = listPublicPeople(state, { limit: 1 });
  const second = listPublicPeople(state, { limit: 1, offset: first.nextOffset });
  assert.equal(first.total, 2);
  assert.equal(first.offset, 0);
  assert.equal(first.nextOffset, 1);
  assert.equal(first.workRelationshipCount, 2);
  assert.equal(second.offset, 1);
  assert.equal(second.nextOffset, undefined);
  assert.notEqual(first.people[0].personId, second.people[0].personId);
});

test("searches linked work titles across the full directory", () => {
  const response = listPublicPeople(fixture(), { query: "花样年华" });
  assert.equal(response.total, 1);
  assert.equal(response.people[0].personId, "person-a");
});

test("falls back safely when pagination values are not finite", () => {
  const response = listPublicPeople(fixture(), { limit: Number.NaN, offset: Number.NaN });
  assert.equal(response.offset, 0);
  assert.equal(response.people.length, 1);
});

test("resolves redirects and returns WWP-only work credits", () => {
  const person = getPublicPerson(fixture(), "person-old");
  assert.equal(person?.personId, "person-a");
  assert.deepEqual(person?.works, [{ workId: "work-a", title: "花样年华", department: "acting" }]);
});

test("does not expose hidden people", () => {
  assert.equal(getPublicPerson(fixture(), "person-hidden"), undefined);
  assert.equal(listPublicPeople(fixture(), { query: "Hidden" }).total, 0);
});

test("does not expose unpublished work references", () => {
  const person = getPublicPerson(fixture(), "person-a", { visibleWorkIds: new Set() });
  assert.equal(person?.workCount, 0);
  assert.deepEqual(person?.works, []);
  assert.deepEqual(person?.representativeWorks, []);
});

test("admin issue payload contains review evidence but no provider payloads", () => {
  const state = fixture();
  state.issues.push({ kind: "unresolved_credit", message: "Missing person ID", workId: "work-a", creditName: "Someone" });
  assert.deepEqual(listPublicPersonIssues(state).issues, [{
    kind: "unresolved_credit",
    message: "Missing person ID",
    personIds: undefined,
    workId: "work-a",
    creditName: "Someone",
    externalId: undefined
  }]);
});
