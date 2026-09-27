import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { assertExpectedPageTitle } from "./notion-workflow-handoff.mjs";
import {
  shouldAutoReleaseWorkVisibility,
  visibilityHideReasonIsConcrete,
  workVisibilityHideReasonIsConcrete
} from "./lib/notion-workflow-handoff.mjs";

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

test("workflow visibility has a separate release gate from completion", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /--release-work and --release-visibility cannot be used together/u);
  assert.match(source, /Clearing Hide from Website requires --release-work or --release-visibility/u);
  assert.match(source, /set requires --page-id, --expected-title, and --status \(unless --release-visibility is used\)/u);
  assert.match(source, /visibilityRequested[\s\S]*Hide from Website[\s\S]*checkbox: options\.hide_from_website/u);
});

test("work-level hiding requires a concrete viewing or explicit human-hold reason", () => {
  const source = fs.readFileSync(path.resolve("tools/lib/notion-workflow-handoff.mjs"), "utf8");
  const cli = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /visibilityHideReasonIsConcrete/u);
  assert.match(cli, /Keeping Hide from Website=true requires --note with a concrete viewing/u);
  assert.match(cli, /uncertainty and metadata follow-up are not hiding reasons/u);
  assert.equal(visibilityHideReasonIsConcrete("资料还没补齐，Needs Review=true"), false);
  assert.equal(visibilityHideReasonIsConcrete("Edge 播放无声音，暂不发布"), false);
  assert.equal(visibilityHideReasonIsConcrete("实测 Edge 播放无声音，暂时隐藏该规格"), true);
  assert.equal(visibilityHideReasonIsConcrete("实测 Media Assets 缺失，暂缓发布"), false);
  assert.equal(visibilityHideReasonIsConcrete("实测 Media Assets 读回失败，ffprobe 待补"), false);
  assert.equal(visibilityHideReasonIsConcrete("实测页面映射错误，导致网站无法打开视频"), true);
});

test("ordinary handoff writes include stale-visibility cleanup", () => {
  const source = fs.readFileSync(scriptPath, "utf8");
  assert.match(source, /shouldAutoReleaseWorkVisibility\(page\)/u);
  assert.match(source, /Hide from Website.*checkbox: false/u);
});

test("visibility fails open for uncertain or child-scoped follow-up", () => {
  const hiddenPage = (note) => ({
    properties: {
      "Hide from Website": { type: "checkbox", checkbox: true },
      "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: note }] }
    }
  });

  assert.equal(workVisibilityHideReasonIsConcrete("资料未补齐，海报待修，Needs Review=true"), false);
  assert.equal(workVisibilityHideReasonIsConcrete("画面有轻微瑕疵，但不影响正常观看，后续可以再修"), false);
  assert.equal(workVisibilityHideReasonIsConcrete("第 3 集播放无声音，其他规格正常"), false);
  assert.equal(workVisibilityHideReasonIsConcrete("全片无法解码，唯一可播放版本不可用"), false);
  assert.equal(workVisibilityHideReasonIsConcrete("实测全片无法解码，唯一可播放版本不可用"), true);
  assert.equal(workVisibilityHideReasonIsConcrete("实测 Media Assets 缺失，但视频块可以正常播放"), false);
  assert.equal(workVisibilityHideReasonIsConcrete("实测全部规格页面映射错误，导致网站无法打开视频"), true);
  assert.equal(shouldAutoReleaseWorkVisibility(hiddenPage("资料未补齐，后续补齐即可")), true);
  assert.equal(shouldAutoReleaseWorkVisibility(hiddenPage("画面有轻微瑕疵，但不影响正常观看，后续可以再修")), true);
  assert.equal(shouldAutoReleaseWorkVisibility(hiddenPage("第 3 集播放无声音，先隔离这一集")), true);
  assert.equal(shouldAutoReleaseWorkVisibility(hiddenPage("【AI(^_^) 2026-09-24T00:00:00.000Z】 全片无法播放，暂不发布")), true);
  assert.equal(shouldAutoReleaseWorkVisibility(hiddenPage("实测全片无法播放，暂不发布")), false);
});
