import assert from "node:assert/strict";
import test from "node:test";

import { remapReportToExistingPeople } from "./person-report-identity-remap.mjs";

test("remaps a reviewed profile and its credits when two stable IDs agree", () => {
  const report = {
    proposedProfiles: [{ personId: "person-new", externalIds: { imdb: "nm1", tmdb: "1" } }],
    proposedCredits: [{ workId: "work-1", credits: [{ personId: "person-new" }] }]
  };
  const output = remapReportToExistingPeople(report, { conflicts: [{
    incomingPersonId: "person-new",
    existingPersonId: "person-existing",
    pageId: "page-existing",
    externalIds: ["imdb:nm1", "tmdb:1"],
    incomingExternalIds: { imdb: "nm1", tmdb: "1" },
    existingExternalIds: { imdb: "nm1", tmdb: "1" }
  }] });
  assert.equal(output.proposedProfiles[0].personId, "person-existing");
  assert.equal(output.proposedCredits[0].credits[0].personId, "person-existing");
  assert.equal(output.identityRemaps.length, 1);
});

test("rejects a remap supported by only one stable ID", () => {
  assert.throws(() => remapReportToExistingPeople({ proposedProfiles: [] }, { conflicts: [{
    incomingPersonId: "person-new",
    existingPersonId: "person-existing",
    pageId: "page-existing",
    externalIds: ["imdb:nm1"],
    incomingExternalIds: { imdb: "nm1" },
    existingExternalIds: { imdb: "nm1" }
  }] }), /at least two matching stable IDs/);
});

test("allows one exact IMDb identity when the incoming profile carries reviewed work-credit evidence", () => {
  const report = {
    proposedProfiles: [{
      personId: "incoming",
      sourceRefs: [{
        source: "imdb-work-credit",
        id: "tt1234567",
        url: "https://www.imdb.com/title/tt1234567/fullcredits/"
      }]
    }],
    proposedCredits: [{ credits: [{ personId: "incoming" }] }]
  };
  const output = remapReportToExistingPeople(report, { conflicts: [{
    incomingPersonId: "incoming",
    existingPersonId: "existing",
    pageId: "page-1",
    externalIds: ["imdb:nm1234567"],
    incomingExternalIds: { imdb: "nm1234567" },
    existingExternalIds: { imdb: "nm1234567" }
  }] });
  assert.equal(output.proposedProfiles[0].personId, "existing");
  assert.equal(output.proposedCredits[0].credits[0].personId, "existing");
});

test("allows filling a missing existing provider ID when other stable IDs prove identity", () => {
  const report = {
    proposedProfiles: [{ personId: "incoming", externalIds: { imdb: "nm1", tmdb: "1", douban: "27224678" } }],
    proposedCredits: [{ credits: [{ personId: "incoming" }] }]
  };
  const output = remapReportToExistingPeople(report, { conflicts: [{
    incomingPersonId: "incoming",
    existingPersonId: "existing",
    pageId: "page-1",
    externalIds: ["imdb:nm1", "tmdb:1"],
    incomingExternalIds: { imdb: "nm1", tmdb: "1", douban: "27224678" },
    existingExternalIds: { imdb: "nm1", tmdb: "1", douban: undefined }
  }] });
  assert.equal(output.proposedProfiles[0].personId, "existing");
  assert.equal(output.proposedProfiles[0].externalIds.douban, "27224678");
  assert.equal(output.proposedCredits[0].credits[0].personId, "existing");
});

test("rejects conflicts that point at multiple existing people", () => {
  assert.throws(() => remapReportToExistingPeople({ proposedProfiles: [] }, { conflicts: [
    { incomingPersonId: "person-new", existingPersonId: "person-a", pageId: "page-a", externalIds: ["imdb:nm1"], incomingExternalIds: { imdb: "nm1", tmdb: "1" }, existingExternalIds: { imdb: "nm1" } },
    { incomingPersonId: "person-new", existingPersonId: "person-b", pageId: "page-b", externalIds: ["tmdb:1"], incomingExternalIds: { imdb: "nm1", tmdb: "1" }, existingExternalIds: { tmdb: "1" } }
  ] }), /expected one existing person/);
});

test("rejects a remap when another provider ID contradicts the existing row", () => {
  assert.throws(() => remapReportToExistingPeople({ proposedProfiles: [] }, { conflicts: [{
    incomingPersonId: "person-new",
    existingPersonId: "person-existing",
    pageId: "page-existing",
    externalIds: ["imdb:nm1", "wikidata:q1"],
    incomingExternalIds: { imdb: "nm1", wikidata: "q1", tmdb: "2" },
    existingExternalIds: { imdb: "nm1", wikidata: "q1", tmdb: "1" }
  }] }), /contrary tmdb IDs/);
});
