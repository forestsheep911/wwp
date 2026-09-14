import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("merges the same stable identity across work reports and preserves both credits", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "person-batch-compose-"));
  const firstId = "person_00000000-0000-4000-8000-000000000001";
  const secondId = "person_00000000-0000-4000-8000-000000000002";
  const profile = (personId, department) => ({
    personId,
    names: [{ value: "Person", language: "en", kind: "display" }],
    externalIds: { tmdb: "1", imdb: "nm1", wikidata: "Q1" },
    departments: [department],
    sourceRefs: []
  });
  writeFileSync(path.join(directory, "first.json"), JSON.stringify({
    proposedProfiles: [profile(firstId, "acting")],
    proposedCredits: [{ workId: "work-1", credits: [{ personId: firstId, externalIds: { tmdb: "1", imdb: "nm1" } }] }],
    identityIssues: [],
    unresolved: []
  }));
  writeFileSync(path.join(directory, "second.json"), JSON.stringify({
    proposedProfiles: [profile(secondId, "writing")],
    proposedCredits: [{ workId: "work-2", credits: [{ personId: secondId, externalIds: { tmdb: "1", imdb: "nm1" } }] }],
    identityIssues: [],
    unresolved: []
  }));
  const configPath = path.join(directory, "config.json");
  execFileSync(process.execPath, [
    "--import", "tsx", path.resolve("tools/person-batch-config.mjs"),
    "--report", path.join(directory, "first.json"),
    "--report", path.join(directory, "second.json"),
    "--output", configPath
  ]);
  const outputPath = path.join(directory, "output.json");
  execFileSync(process.execPath, ["--import", "tsx", path.resolve("tools/person-batch-compose.mjs"), "--config", configPath, "--output", outputPath]);
  const output = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(output.proposedProfiles.length, 1);
  assert.deepEqual(new Set(output.proposedProfiles[0].departments), new Set(["acting", "writing"]));
  assert.deepEqual(output.proposedCredits.map((work) => work.credits[0].personId), [firstId, firstId]);
  assert.deepEqual(output.identityIssues, []);
});

test("retains unselected profiles only as credit identity evidence", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "person-batch-compose-"));
  const selectedId = "person_00000000-0000-4000-8000-000000000011";
  const deferredId = "person_00000000-0000-4000-8000-000000000012";
  const profile = (personId, name, wikidata) => ({
    personId,
    names: [{ value: name, language: "en", kind: "display" }],
    externalIds: { wikidata },
    departments: ["acting"],
    sourceRefs: []
  });
  writeFileSync(path.join(directory, "report.json"), JSON.stringify({
    proposedProfiles: [profile(selectedId, "Selected", "Q11"), profile(deferredId, "P!nk", "Q12")],
    proposedCredits: [{ workId: "work-1", credits: [
      { personId: selectedId, name: "Selected", department: "acting", job: "Actor", externalIds: { wikidata: "Q11" } },
      { personId: deferredId, name: "Pink", department: "acting", job: "Voice Actor", externalIds: { wikidata: "Q12" } }
    ] }],
    identityIssues: [],
    unresolved: []
  }));
  const configPath = path.join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({ inputs: [{
    report: "report.json",
    profilePersonIds: [selectedId],
    keepLinkedPersonIds: [selectedId]
  }] }));
  const outputPath = path.join(directory, "output.json");
  execFileSync(process.execPath, ["--import", "tsx", path.resolve("tools/person-batch-compose.mjs"), "--config", configPath, "--output", outputPath]);
  const output = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.deepEqual(output.proposedProfiles.map((entry) => entry.personId), [selectedId]);
  assert.deepEqual(new Set(output.creditIdentityProfiles.map((entry) => entry.personId)), new Set([selectedId, deferredId]));
  assert.equal(output.proposedCredits[0].credits[1].personId, undefined);
});

test("profile-only input omits work credits for resumable metadata-only publication", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "person-batch-compose-"));
  const personId = "person_00000000-0000-4000-8000-000000000021";
  writeFileSync(path.join(directory, "report.json"), JSON.stringify({
    proposedProfiles: [{ personId, names: [], externalIds: { wikidata: "Q21" }, departments: ["acting"], sourceRefs: [] }],
    proposedCredits: [{ workId: "wwm_hidden", credits: [{ personId, name: "Person", department: "acting" }] }],
    identityIssues: [],
    unresolved: []
  }));
  const configPath = path.join(directory, "config.json");
  writeFileSync(configPath, JSON.stringify({ inputs: [{
    report: "report.json",
    profilePersonIds: [personId],
    keepLinkedPersonIds: [personId],
    profilesOnly: true
  }] }));
  const outputPath = path.join(directory, "output.json");
  execFileSync(process.execPath, ["--import", "tsx", path.resolve("tools/person-batch-compose.mjs"), "--config", configPath, "--output", outputPath]);
  const output = JSON.parse(readFileSync(outputPath, "utf8"));
  assert.equal(output.proposedProfiles.length, 1);
  assert.deepEqual(output.proposedCredits, []);
  assert.deepEqual(output.unresolved, []);
});
