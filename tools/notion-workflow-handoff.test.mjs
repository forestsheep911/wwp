import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { assertExpectedPageTitle } from "./notion-workflow-handoff.mjs";

const scriptPath = path.resolve("tools/notion-workflow-handoff.mjs");

test("workflow handoff accepts a physical-interface direct binding option", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-workflow-handoff-"));
  try {
    const result = spawnSync(process.execPath, [scriptPath, "set", "--local-address", "192.0.2.10"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NOTION_READ_ONLY_TOKEN: "", NOTION_WRITE_TOKEN: "", NOTION_TOKEN: "" }
    });
    assert.match(result.stderr, /A Notion token is required/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("workflow handoff accepts bounded exact pages for reconciliation", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-workflow-handoff-"));
  try {
    const result = spawnSync(process.execPath, [
      scriptPath, "reconcile", "--page-id", "11111111-1111-1111-1111-111111111111",
      "--page-id", "22222222-2222-2222-2222-222222222222", "--local-address", "192.0.2.10"
    ], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NOTION_READ_ONLY_TOKEN: "", NOTION_WRITE_TOKEN: "", NOTION_TOKEN: "" }
    });
    assert.match(result.stderr, /A Notion token is required/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("workflow handoff serializes Notion requests at one-second intervals", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /let requestQueue = Promise\.resolve\(\)/);
  assert.match(source, /1000 - \(Date\.now\(\) - lastRequestStartedAt\)/);
});

test("workflow status writes require an exact expected work title", () => {
  const page = {
    id: "11111111-1111-1111-1111-111111111111",
    properties: { Name: { type: "title", title: [{ plain_text: "雷神2：黑暗世界 Thor: The Dark World (2013)" }] } }
  };
  assert.equal(
    assertExpectedPageTitle(page, "雷神2：黑暗世界 Thor: The Dark World (2013)"),
    "雷神2：黑暗世界 Thor: The Dark World (2013)"
  );
  assert.throws(
    () => assertExpectedPageTitle(page, "一次别离 جدایی نادر از سیمین A Separation (2011)"),
    /Workflow page title mismatch/u
  );
  assert.throws(() => assertExpectedPageTitle(page, ""), /set requires --expected-title/u);
});

test("workflow visibility accepts only explicit boolean values", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-workflow-handoff-"));
  try {
    const result = spawnSync(process.execPath, [
      scriptPath, "set", "--hide-from-website", "yes"
    ], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, NOTION_READ_ONLY_TOKEN: "", NOTION_WRITE_TOKEN: "", NOTION_TOKEN: "" }
    });
    assert.match(result.stderr, /--hide-from-website must be true or false/u);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("workflow visibility cannot be cleared outside the release gate", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /Clearing Hide from Website requires --release-work/u);
  assert.match(source, /visibilityRequested[\s\S]*Hide from Website[\s\S]*checkbox: options\.hide_from_website/u);
});
