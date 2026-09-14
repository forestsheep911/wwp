import assert from "node:assert/strict";
import test from "node:test";

import {
  reviewedEvidenceForCredit,
  validateTargetedSupplementInput
} from "./person-targeted-supplement-input.mjs";

const base = {
  work: {
    workId: "work_1",
    title: "Example (2000)",
    sourceWorkExternalIds: { imdb: "tt1234567" }
  }
};

test("accepts a reviewed IMDb-only identity with exact work-credit evidence", () => {
  const input = validateTargetedSupplementInput({
    ...base,
    credits: [{
      name: "Example Person",
      department: "acting",
      externalIds: { imdb: "nm1234567" },
      workCreditUrl: "https://www.imdb.com/title/tt1234567/",
      reviewedEvidence: {
        externalIds: { imdb: "nm1234567" },
        names: [{ value: "Example Person", language: "en", script: "Latn", kind: "display", source: "imdb", status: "strong" }],
        sourceRefs: [{ source: "imdb", id: "nm1234567", url: "https://www.imdb.com/name/nm1234567/" }]
      }
    }]
  });
  const evidence = reviewedEvidenceForCredit(input.credits[0], "2026-09-13T00:00:00.000Z");
  assert.equal(evidence.externalIds.imdb, "nm1234567");
  assert.equal(evidence.observedAt, "2026-09-13T00:00:00.000Z");
  assert.equal(evidence.names[0].observedAt, "2026-09-13T00:00:00.000Z");
});

test("rejects IMDb-only identity without exact work-credit evidence", () => {
  assert.throws(() => validateTargetedSupplementInput({
    ...base,
    credits: [{
      name: "Example Person",
      department: "acting",
      externalIds: { imdb: "nm1234567" },
      reviewedEvidence: {
        externalIds: { imdb: "nm1234567" },
        names: [{ value: "Example Person" }],
        sourceRefs: [{ source: "imdb", id: "nm1234567" }]
      }
    }]
  }), /workCreditUrl/);
});

test("keeps the Wikidata discovery path concise", () => {
  const input = validateTargetedSupplementInput({
    ...base,
    credits: [{ name: "Known Person", department: "directing", externalIds: { wikidata: "Q42" } }]
  });
  assert.equal(input.credits[0].externalIds.wikidata, "Q42");
});
