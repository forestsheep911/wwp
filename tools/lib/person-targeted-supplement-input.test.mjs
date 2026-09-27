import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeCreditIdentityEvidence,
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

test("preserves a reviewed Douban ID alongside an IMDb-anchored identity", () => {
  const input = validateTargetedSupplementInput({
    ...base,
    credits: [{
      name: "Example Person",
      department: "acting",
      externalIds: { imdb: "nm1234567", douban: "35522239" },
      identityRefs: [{ source: "douban", id: "35522239", url: "https://www.douban.com/personage/35522239/" }],
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
  assert.equal(evidence.externalIds.douban, "35522239");
  assert.ok(evidence.sourceRefs.some((ref) => ref.source === "douban" && ref.id === "35522239"));
  assert.equal(evidence.observedAt, "2026-09-13T00:00:00.000Z");
  assert.equal(evidence.names[0].observedAt, "2026-09-13T00:00:00.000Z");
});

test("accepts a Douban-only identity when the exact work and person evidence are supplied", () => {
  const input = validateTargetedSupplementInput({
    work: { workId: "work_2", title: "Example Series", sourceWorkExternalIds: { douban: "35284242" } },
    credits: [{
      name: "Example Person",
      department: "acting",
      externalIds: { douban: "35522239" },
      workCreditUrl: "https://www.imdb.com/title/tt1234567/fullcredits/",
      reviewedEvidence: {
        externalIds: { douban: "35522239" },
        names: [{ value: "Example Person", language: "zh-CN", script: "Hans", kind: "display", source: "douban", status: "strong" }],
        sourceRefs: [
          { source: "douban", id: "35522239", url: "https://www.douban.com/personage/35522239/" },
          { source: "imdb", id: "tt1234567", url: "https://www.imdb.com/title/tt1234567/fullcredits/" }
        ]
      }
    }]
  });
  assert.equal(input.credits[0].externalIds.douban, "35522239");
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

test("rejects reviewed evidence names that cannot be materialized", () => {
  assert.throws(() => validateTargetedSupplementInput({
    ...base,
    credits: [{
      name: "Example Person",
      department: "acting",
      externalIds: { imdb: "nm1234567" },
      workCreditUrl: "https://www.imdb.com/title/tt1234567/",
      reviewedEvidence: {
        externalIds: { imdb: "nm1234567" },
        names: [{ name: "Example Person" }],
        sourceRefs: [{ source: "imdb", id: "nm1234567" }]
      }
    }]
  }), /names requires a non-empty value field/);
});

test("keeps the Wikidata discovery path concise", () => {
  const input = validateTargetedSupplementInput({
    ...base,
    credits: [{ name: "Known Person", department: "directing", externalIds: { wikidata: "Q42" } }]
  });
  assert.equal(input.credits[0].externalIds.wikidata, "Q42");
});

test("retains a reviewed Douban ID alongside Wikidata identity evidence", () => {
  const credit = validateTargetedSupplementInput({
    ...base,
    credits: [{
      name: "Example Person",
      department: "acting",
      externalIds: { wikidata: "Q42", douban: "35522239" },
      identityRefs: [{ source: "douban", id: "35522239", url: "https://movie.douban.com/celebrity/35522239/" }]
    }]
  }).credits[0];
  const evidence = mergeCreditIdentityEvidence({
    externalIds: { wikidata: "Q42", imdb: "nm1234567" },
    sourceRefs: [{ source: "wikidata", id: "Q42", url: "https://www.wikidata.org/wiki/Q42" }],
    observedAt: "2026-09-24T00:00:00.000Z"
  }, credit);
  assert.equal(evidence.externalIds.douban, "35522239");
  assert.ok(evidence.sourceRefs.some((ref) => ref.source === "douban" && ref.id === "35522239"));
});

test("rejects a reviewed identity ID that conflicts with Wikidata", () => {
  const credit = validateTargetedSupplementInput({
    ...base,
    credits: [{
      name: "Example Person",
      department: "acting",
      externalIds: { wikidata: "Q42", imdb: "nm7654321" },
      identityRefs: [{ source: "imdb", id: "nm7654321", url: "https://www.imdb.com/name/nm7654321/" }]
    }]
  }).credits[0];
  assert.throws(() => mergeCreditIdentityEvidence({
    externalIds: { wikidata: "Q42", imdb: "nm1234567" }, sourceRefs: [], observedAt: "now"
  }, credit), /imdb ID conflicts/u);
});

test("accepts and normalizes explicit legacy aliases", () => {
  const input = validateTargetedSupplementInput({
    ...base,
    credits: [{
      name: "Example Person",
      department: "acting",
      externalIds: { imdb: "nm1234567" },
      legacyAliases: ["旧姓名", "旧姓名"],
      workCreditUrl: "https://www.imdb.com/title/tt1234567/",
      reviewedEvidence: {
        externalIds: { imdb: "nm1234567" },
        names: [{ value: "Example Person", language: "en", script: "Latn", kind: "display", source: "imdb", status: "strong" }],
        sourceRefs: [{ source: "imdb", id: "nm1234567", url: "https://www.imdb.com/name/nm1234567/" }]
      }
    }]
  });
  assert.deepEqual(input.credits[0].legacyAliases, ["旧姓名"]);
});

test("rejects malformed legacy aliases", () => {
  assert.throws(() => validateTargetedSupplementInput({
    ...base,
    credits: [{
      name: "Example Person",
      department: "acting",
      externalIds: { wikidata: "Q42" },
      legacyAliases: ["", 42]
    }]
  }), /legacyAliases/);
});
