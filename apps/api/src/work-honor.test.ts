import test from "node:test";
import assert from "node:assert/strict";
import { validateWorkHonorRecord, type WorkHonorRecord } from "./work-honor.js";

function validHonor(overrides: Partial<WorkHonorRecord> = {}): WorkHonorRecord {
  return {
    honorId: "honor_academy_2020_best_picture",
    workId: "wwm_example",
    awardingBody: "Academy of Motion Picture Arts and Sciences",
    eventName: "92nd Academy Awards",
    editionYear: 2020,
    category: "Best Picture",
    result: "winner",
    recipients: ["work"],
    sourceRefs: [{
      url: "https://www.oscars.org/oscars/ceremonies/2020",
      authority: "official",
      observedAt: "2026-09-05T00:00:00.000Z"
    }],
    status: "verified",
    checkedAt: "2026-09-05T00:00:00.000Z",
    ...overrides
  };
}

test("accepts an exact sourced honor fact", () => {
  assert.deepEqual(validateWorkHonorRecord(validHonor()), { valid: true, errors: [] });
});

test("rejects vague unsourced award claims", () => {
  const result = validateWorkHonorRecord(validHonor({ category: "多项大奖", sourceRefs: [] }));
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ["vague_category", "missing_source_reference"]);
});

test("keeps winner, nominee, and selection semantically distinct", () => {
  assert.equal(validateWorkHonorRecord(validHonor({ result: "nominee" })).valid, true);
  assert.equal(validateWorkHonorRecord(validHonor({ result: "selection" })).valid, true);
  assert.equal(validateWorkHonorRecord(validHonor({ result: "won-or-nominated" as never })).valid, false);
});

test("requires recipient scope and auditable source timestamps", () => {
  const result = validateWorkHonorRecord(validHonor({
    recipients: [],
    sourceRefs: [{ url: "http://example.com", authority: "official", observedAt: "someday" }]
  }));
  assert.deepEqual(result.errors, [
    "missing_recipient_scope",
    "source_must_be_https",
    "invalid_source_observed_at"
  ]);
});
