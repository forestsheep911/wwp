import test from "node:test";
import assert from "node:assert/strict";
import { markMetadataOnlyWork } from "./person-metadata-only-report.mjs";

const pageId = "3da20ac1-2f0a-81b5-8aea-d3a104f946e2";

function cleanReport() {
  return {
    identityIssues: [],
    unresolved: [],
    proposedCredits: [{
      workId: "wwm_example",
      title: "Example",
      sourceWorkExternalIds: { imdb: "tt0000001" },
      credits: [{ name: "Person", personId: "person_00000000-0000-4000-8000-000000000001" }]
    }]
  };
}

test("marks an exact complete report as metadata-only", () => {
  const result = markMetadataOnlyWork(cleanReport(), { workId: "wwm_example", sourcePageId: pageId });
  assert.deepEqual(result.proposedCredits[0].metadataOnlyWork, {
    mode: "metadata-only",
    sourcePageId: pageId,
    completeCreditSet: true
  });
});

test("rejects unresolved or partially linked metadata-only reports", () => {
  const unresolved = cleanReport();
  unresolved.unresolved.push({ reason: "unknown person" });
  assert.throws(() => markMetadataOnlyWork(unresolved, { workId: "wwm_example", sourcePageId: pageId }), /zero identity issues/u);

  const unlinked = cleanReport();
  delete unlinked.proposedCredits[0].credits[0].personId;
  assert.throws(() => markMetadataOnlyWork(unlinked, { workId: "wwm_example", sourcePageId: pageId }), /fully linked/u);
});
