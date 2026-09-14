import test from "node:test";
import assert from "node:assert/strict";
import { describePeopleCoverageTargets } from "./person-coverage-target.mjs";

test("reports exact unlinked credit identities for selected works only", () => {
  const results = [{
    assetKey: "asset-one",
    sourcePageId: "page-one",
    title: "One",
    metadata: { work: { workId: "wwm_one", credits: [
      { name: "Linked", department: "acting", personId: "person_1" },
      { name: "Missing", department: "writing", externalIds: { wikidata: "Q2" } }
    ] } }
  }, { metadata: { work: { workId: "wwm_other", credits: [] } } }];
  const targets = describePeopleCoverageTargets(results, ["wwm_one"]);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].linkedCreditCount, 1);
  assert.deepEqual(targets[0].unlinkedCredits, [{ name: "Missing", department: "writing", externalIds: { wikidata: "Q2" } }]);
});
