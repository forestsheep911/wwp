import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

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
