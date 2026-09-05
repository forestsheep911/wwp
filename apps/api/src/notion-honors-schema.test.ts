import assert from "node:assert/strict";
import test from "node:test";

import { compareHonorsSchema, honorsPropertySchema, inspectHonorsSchemaTarget } from "./notion-honors-schema.js";

test("defines exact honor facts and a dual Work relation", () => {
  const schema = honorsPropertySchema("work-source");
  assert.deepEqual(schema.Name, { title: {} });
  assert.equal(schema.Work.relation.data_source_id, "work-source");
  assert.equal(schema.Work.relation.type, "dual_property");
  assert.ok(schema.Result.select.options.some((option) => option.name === "winner"));
  assert.ok(schema.Result.select.options.some((option) => option.name === "nominee"));
  assert.deepEqual(schema.Sources, { rich_text: {} });
});

test("places Honors beside the canonical work data source", async () => {
  const notion = {
    dataSources: { retrieve: async () => ({
      id: "work-source",
      title: [{ plain_text: "影视库" }],
      parent: { type: "database_id", database_id: "work-db" },
      database_parent: { type: "page_id", page_id: "library-root" }
    }) },
    databases: {}
  };
  const proposal = await inspectHonorsSchemaTarget(notion as never, "work-source");
  assert.equal(proposal.parentPageId, "library-root");
  assert.equal(proposal.workDataSourceId, "work-source");
  assert.equal(proposal.writesRequired, 1);
});

test("reports unsafe schema drift without mutating it", () => {
  const result = compareHonorsSchema({
    Name: { type: "title" },
    "Honor ID": { type: "number" },
    Result: { type: "select", select: { options: [{ name: "winner" }] } },
    Extra: { type: "rich_text" }
  }, "work-source");
  assert.ok(result.missing.includes("Work"));
  assert.deepEqual(result.typeMismatches, [{ name: "Honor ID", expected: "rich_text", actual: "number" }]);
  assert.ok(result.optionMismatches.some((entry) => entry.name === "Result"));
  assert.deepEqual(result.extra, ["Extra"]);
});
