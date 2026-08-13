import assert from "node:assert/strict";
import test from "node:test";

import {
  decidePersonIdentity,
  normalizePersonExternalIds
} from "./person-identity.js";

test("normalizes stable person identifiers without accepting title IDs", () => {
  assert.deepEqual(normalizePersonExternalIds({ tmdb: "00123", imdb: " NM0000197 ", wikidata: " q123 " }), {
    tmdb: "123",
    imdb: "nm0000197",
    wikidata: "Q123"
  });
  assert.deepEqual(normalizePersonExternalIds({ imdb: "tt0000197", wikidata: "person-1" }), {});
});

test("matches one person through a shared stable id and extends a crosswalk", () => {
  assert.deepEqual(decidePersonIdentity(
    { tmdb: "1337", imdb: "nm0504897" },
    [{ personId: "person-a", externalIds: { tmdb: "1337" } }]
  ), {
    action: "match",
    personId: "person-a",
    matchedBy: ["tmdb"]
  });
});

test("reports conflict when incoming ids point at multiple people", () => {
  assert.deepEqual(decidePersonIdentity(
    { tmdb: "1", imdb: "nm0000002" },
    [
      { personId: "person-a", externalIds: { tmdb: "1" } },
      { personId: "person-b", externalIds: { imdb: "nm0000002" } }
    ]
  ), {
    action: "conflict",
    reason: "ids_match_multiple_people",
    personIds: ["person-a", "person-b"],
    sources: ["tmdb", "imdb"]
  });
});

test("reports same-namespace conflict instead of merging through another id", () => {
  assert.deepEqual(decidePersonIdentity(
    { tmdb: "2", imdb: "nm0000001" },
    [{ personId: "person-a", externalIds: { tmdb: "1", imdb: "nm0000001" } }]
  ), {
    action: "conflict",
    reason: "same_namespace_id_conflict",
    personIds: ["person-a"],
    sources: ["tmdb"]
  });
});

test("does not resolve a person without a stable external id", () => {
  assert.deepEqual(decidePersonIdentity(undefined, [{ personId: "same-name" }]), {
    action: "unresolved",
    reason: "missing_stable_external_id"
  });
});

test("permits creation only when a stable id has no indexed match", () => {
  assert.deepEqual(decidePersonIdentity({ tmdb: "42" }, []), {
    action: "new",
    externalIds: { tmdb: "42" }
  });
});
