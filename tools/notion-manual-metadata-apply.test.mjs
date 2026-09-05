import test from "node:test";
import assert from "node:assert/strict";
import { buildMetadataPatch } from "./notion-manual-metadata-apply.mjs";

test("manual metadata preserves existing fields and merges provenance", () => {
  const properties = {
    "简介": { type: "rich_text", rich_text: [{ plain_text: "existing" }] },
    "Runtime Minutes": { type: "number", number: null },
    "Metadata Source": { type: "multi_select", multi_select: [{ name: "notion-title" }] }
  };
  const result = buildMetadataPatch(properties, {
    "简介": "replacement",
    "Runtime Minutes": 24,
    "Metadata Source": { value: ["manual"], merge: true }
  });
  assert.equal(result.patch["简介"], undefined);
  assert.equal(result.skipped["简介"], "existing_value_preserved");
  assert.equal(result.patch["Runtime Minutes"].number, 24);
  assert.deepEqual(result.patch["Metadata Source"].multi_select, [{ name: "notion-title" }, { name: "manual" }]);
});

test("manual metadata requires explicit overwrite and rejects workflow fields", () => {
  const properties = {
    "Metadata Status": { type: "select", select: { name: "partial" } },
    "Workflow Status": { type: "select", select: null }
  };
  const result = buildMetadataPatch(properties, {
    "Metadata Status": { value: "verified", overwrite: true }
  });
  assert.equal(result.patch["Metadata Status"].select.name, "verified");
  assert.throws(() => buildMetadataPatch(properties, { "Workflow Status": "已完成" }), /not allowed/u);
});

test("manual metadata rejects invalid number and checkbox values", () => {
  const properties = {
    "Metadata Confidence": { type: "number", number: null },
    "Needs Review": { type: "checkbox", checkbox: false }
  };
  assert.throws(() => buildMetadataPatch(properties, { "Metadata Confidence": "high" }), /must be finite/u);
  assert.throws(() => buildMetadataPatch(properties, {
    "Needs Review": { value: "false", overwrite: true }
  }), /must be boolean/u);
});

test("manual metadata supports the complete AI age advisory group", () => {
  const properties = {
    "AI年龄建议置信度": { type: "select", select: null },
    "内容风险标签": { type: "multi_select", multi_select: [] },
    "AI年龄建议理由": { type: "rich_text", rich_text: [] }
  };
  const result = buildMetadataPatch(properties, {
    "AI年龄建议置信度": "high",
    "内容风险标签": ["战争", "暴力"],
    "AI年龄建议理由": "包含持续战争暴力。"
  });
  assert.equal(result.patch["AI年龄建议置信度"].select.name, "high");
  assert.deepEqual(result.patch["内容风险标签"].multi_select, [{ name: "战争" }, { name: "暴力" }]);
  assert.equal(result.patch["AI年龄建议理由"].rich_text[0].text.content, "包含持续战争暴力。");
});
