import test from "node:test";
import assert from "node:assert/strict";
import { assessWorkEnrichment } from "./work-enrichment.js";

test("highlights wait for verified base metadata", () => {
  const result = assessWorkEnrichment({
    workId: "wwm_1",
    metadataStatus: "partial",
    metadataMissingFields: ["release_year", "production_companies"],
    peopleStatus: "verified",
    keyCreatorsVerified: true,
    honorsStatus: "verified"
  });
  assert.equal(result.highlights.status, "blocked_metadata");
  assert.deepEqual(result.highlights.blockedBy, ["metadata"]);
  assert.deepEqual(result.highlights.missingFields, ["release_year", "production_companies"]);
  assert.equal(result.highlights.nextAction, "complete_base_metadata");
});

test("verified key creators allow an incomplete long-tail People catalog", () => {
  const result = assessWorkEnrichment({
    workId: "wwm_2",
    metadataStatus: "verified",
    peopleStatus: "partial",
    keyCreatorsVerified: true,
    honorsStatus: "checked_none_found"
  });
  assert.equal(result.people.readyForHighlights, true);
  assert.equal(result.highlights.status, "ready");
});

test("unchecked honors block highlights while checked none found does not", () => {
  const blocked = assessWorkEnrichment({
    workId: "wwm_3",
    metadataStatus: "verified",
    peopleStatus: "verified",
    keyCreatorsVerified: true,
    honorsStatus: "not_checked"
  });
  assert.equal(blocked.highlights.status, "blocked_honors");

  const ready = assessWorkEnrichment({
    workId: "wwm_3",
    metadataStatus: "verified",
    peopleStatus: "verified",
    keyCreatorsVerified: true,
    honorsStatus: "checked_none_found"
  });
  assert.equal(ready.highlights.status, "ready");
});

test("review state and human lock survive a ready prerequisite gate", () => {
  const result = assessWorkEnrichment({
    workId: "wwm_4",
    metadataStatus: "verified",
    peopleStatus: "verified",
    keyCreatorsVerified: true,
    honorsStatus: "verified",
    highlightStatus: "reviewed",
    highlightHumanLocked: true,
    humanConfirmationReasons: ["conflicting_director_credit", "conflicting_director_credit"]
  });
  assert.equal(result.highlights.status, "reviewed");
  assert.equal(result.highlights.humanLocked, true);
  assert.equal(result.needsHumanConfirmation, true);
  assert.deepEqual(result.humanConfirmationReasons, ["conflicting_director_credit"]);
  assert.equal(result.highlights.nextAction, "preserve_human_locked_highlights");
});
