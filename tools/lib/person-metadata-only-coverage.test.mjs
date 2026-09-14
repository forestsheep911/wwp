import test from "node:test";
import assert from "node:assert/strict";
import { buildMetadataOnlyPeopleCoverage } from "./person-metadata-only-coverage.mjs";

test("builds fully linked coverage only from bidirectional catalog readback", () => {
  const catalog = {
    people: { person_1: { profile: {} } },
    creditsByWorkId: { wwm_one: [{ personId: "person_1", name: "One", department: "acting" }] },
    creditsByPersonId: { person_1: [{ personId: "person_1", workId: "wwm_one", name: "One", department: "acting" }] }
  };
  const result = buildMetadataOnlyPeopleCoverage(catalog, { workId: "wwm_one", sourcePageId: "page", expectedCreditCount: 1 });
  assert.equal(result.works[0].status, "fully_linked");
  assert.equal(result.works[0].linkedCreditCount, 1);
});

test("rejects incomplete reverse relations", () => {
  const catalog = {
    people: { person_1: { profile: {} } },
    creditsByWorkId: { wwm_one: [{ personId: "person_1", name: "One", department: "acting" }] },
    creditsByPersonId: { person_1: [] }
  };
  assert.throws(() => buildMetadataOnlyPeopleCoverage(catalog, { workId: "wwm_one", sourcePageId: "page", expectedCreditCount: 1 }), /bidirectionally linked/u);
});
