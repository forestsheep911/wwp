import assert from "node:assert/strict";
import test from "node:test";
import {
  coreMetadataFields,
  deriveMetadataCompleteness
} from "./notion-metadata-completeness.js";

function completeValues() {
  return Object.fromEntries(coreMetadataFields.map((field) => [field, "present"]));
}

test("verified metadata does not require optional ratings, box office, TMDB, or manual override", () => {
  assert.deepEqual(deriveMetadataCompleteness({
    hasExternalId: true,
    conflicts: [],
    values: completeValues()
  }), {
    status: "verified",
    missingCoreFields: [],
    unresolvedIssues: []
  });
});

test("missing core metadata or an issue keeps the page partial", () => {
  const values = completeValues();
  values["Poster URL"] = "";
  values["AI Issue"] = "summary needs review";
  assert.deepEqual(deriveMetadataCompleteness({
    hasExternalId: true,
    conflicts: [],
    values
  }), {
    status: "partial",
    missingCoreFields: ["Poster URL"],
    unresolvedIssues: ["AI Issue"]
  });
});

test("identity conflicts take precedence over completeness", () => {
  assert.equal(deriveMetadataCompleteness({
    hasExternalId: true,
    conflicts: ["IMDb mismatch"],
    values: completeValues()
  }).status, "conflict");
});
