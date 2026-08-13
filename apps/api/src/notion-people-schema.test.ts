import assert from "node:assert/strict";
import test from "node:test";

import { comparePeopleSchema, DEPRECATED_PEOPLE_PROPERTIES, inspectPeopleSchemaTarget, peoplePropertySchema } from "./notion-people-schema.js";

test("defines immutable identity, editorial locks, publication state, and provenance fields", () => {
  const schema = peoplePropertySchema();
  assert.deepEqual(schema.Name, { title: {} });
  assert.deepEqual(schema["Person ID"], { rich_text: {} });
  assert.ok(schema["Locked Fields"].multi_select.options.some((option) => option.name === "Chinese Name"));
  assert.deepEqual(schema["Biography ZH"], { rich_text: {} });
  assert.ok(schema["Biography ZH Status"].select.options.some((option) => option.name === "verified"));
  assert.ok(schema["Biography ZH Method"].select.options.some((option) => option.name === "editorial-rewrite"));
  assert.deepEqual(schema["Biography EN"], { rich_text: {} });
  assert.ok(schema["Biography EN Status"].select.options.some((option) => option.name === "verified"));
  assert.ok(schema["Biography EN Method"].select.options.some((option) => option.name === "editorial-rewrite"));
  assert.equal("Biography" in schema, false);
  assert.deepEqual(DEPRECATED_PEOPLE_PROPERTIES, ["Biography", "Biography ZH Sources", "Biography EN Sources"]);
  assert.ok(schema["Locked Fields"].multi_select.options.some((option) => option.name === "Biography ZH"));
  assert.ok(schema["Locked Fields"].multi_select.options.some((option) => option.name === "Biography EN"));
  assert.deepEqual(schema["Hide from Website"], { checkbox: {} });
});

test("places People beside Media Assets using the returned database grandparent", async () => {
  const notion = {
    dataSources: { retrieve: async () => ({
      id: "media-source",
      title: [{ plain_text: "Media Assets" }],
      parent: { type: "database_id", database_id: "media-db" },
      database_parent: { type: "page_id", page_id: "library-root" }
    }) },
    databases: {}
  };
  const proposal = await inspectPeopleSchemaTarget(notion as never, "media-source");
  assert.equal(proposal.parentPageId, "library-root");
  assert.equal(proposal.referenceDatabaseId, "media-db");
  assert.equal(proposal.writesRequired, 1);
});

test("reports schema drift without mutating it", () => {
  const result = comparePeopleSchema({
    Name: { type: "title" },
    "Person ID": { type: "number" },
    "Locked Fields": { type: "multi_select", multi_select: { options: [{ name: "Biography" }] } },
    Extra: { type: "rich_text" }
  });
  assert.ok(result.missing.includes("Chinese Name"));
  assert.deepEqual(result.typeMismatches, [{ name: "Person ID", expected: "rich_text", actual: "number" }]);
  assert.ok(result.optionMismatches.some((entry) => entry.name === "Locked Fields"));
  assert.deepEqual(result.extra, ["Extra"]);
});
