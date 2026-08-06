import test from "node:test";
import assert from "node:assert/strict";
import {
  appendWorkflowNote,
  buildActionableWorkflowFilter,
  buildWorkflowUpdate,
  pendingHumanWorkflowNote,
  richTextPayload
} from "./notion-workflow-handoff.mjs";

function page(status = "已上传待 AI 收尾", note = "已有说明") {
  return {
    properties: {
      Name: { type: "title", title: [{ plain_text: "Example" }] },
      "Workflow Status": { type: "select", select: status ? { name: status } : null },
      "Workflow Note": { type: "rich_text", rich_text: note ? [{ plain_text: note }] : [] }
    }
  };
}

test("actionable filter queries only explicit AI handoff states", () => {
  assert.deepEqual(buildActionableWorkflowFilter(), {
    or: [
      { property: "Workflow Status", select: { equals: "待 AI 处理" } },
      { property: "Workflow Status", select: { equals: "已上传待 AI 收尾" } },
      { property: "Workflow Status", select: { equals: "已确认待 AI 发布" } }
    ]
  });
});

test("AI workflow note uses the machine-readable AI marker", () => {
  assert.equal(
    appendWorkflowNote("已有说明", { actor: "ai", note: "已领取。", at: "2026-07-25T00:00:00.000Z" }),
    "已有说明\n【AI(^_^) 2026-07-25T00:00:00.000Z】 已领取。"
  );
});

test("pending human note is only the plain-text tail after the latest AI marker", () => {
  const note = "先前人工说明\n【AI(^_^) 2026-07-25T00:00:00.000Z】 已完成。\n请补海报\n并同步网站";
  assert.equal(pendingHumanWorkflowNote(note), "请补海报\n并同步网站");
});

test("an AI acknowledgement prevents a claimed human instruction from being claimed twice", () => {
  const claimed = appendWorkflowNote("请补海报", {
    actor: "ai",
    note: "已认领补海报，开始处理。",
    at: "2026-07-31T08:00:00.000Z"
  });
  assert.equal(pendingHumanWorkflowNote(claimed), "");
  assert.equal(
    pendingHumanWorkflowNote(`${claimed}\n请再核对标题。`),
    "请再核对标题。"
  );
});

test("legacy AI history is an acknowledgement boundary during protocol migration", () => {
  const note = "旧人工说明\n[2026-07-28T12:46:38.677Z codex] 已处理。";
  assert.equal(pendingHumanWorkflowNote(note), "");
});

test("date-only legacy AI history is an acknowledgement boundary", () => {
  const note = "旧人工说明\n[2026-07-29 AI] 自动上传和资产发布已完成。";
  assert.equal(pendingHumanWorkflowNote(note), "");
});

test("unbracketed legacy machine completion record is not treated as human input", () => {
  const note = "旧人工说明\n2026-07-29 自动上传、Media Assets、网站发布闸门和现场读回均已完成。";
  assert.equal(pendingHumanWorkflowNote(note), "");
});

test("a dated human note without machine vocabulary remains actionable", () => {
  assert.equal(pendingHumanWorkflowNote("2026-07-29 我只想保留低配。"), "2026-07-29 我只想保留低配。");
});

test("human note stays as plain text", () => {
  assert.equal(appendWorkflowNote("旧记录", { actor: "human", note: "我已上传。" }), "旧记录\n我已上传。");
});

test("workflow update claims an uploaded handoff and preserves the note", () => {
  const update = buildWorkflowUpdate(page(), {
    status: "AI 处理中",
    actor: "ai",
    note: "开始检查媒体块。",
    at: "2026-07-25T00:00:00.000Z"
  });
  assert.equal(update.currentStatus, "已上传待 AI 收尾");
  assert.equal(update.nextStatus, "AI 处理中");
  assert.match(update.nextNote, /开始检查媒体块/);
  assert.equal(update.properties["Workflow Status"].select.name, "AI 处理中");
});

test("workflow update can append a note without changing status", () => {
  const update = buildWorkflowUpdate(page("待人工上传"), {
    status: "待人工上传",
    actor: "ai",
    note: "文件名已订正。",
    at: "2026-07-25T00:00:00.000Z"
  });
  assert.equal(update.currentStatus, "待人工上传");
  assert.equal(update.nextStatus, "待人工上传");
  assert.match(update.nextNote, /文件名已订正/);
});

test("workflow update rejects invalid state jumps", () => {
  assert.throws(
    () => buildWorkflowUpdate(page("人工上传中"), { status: "已完成", actor: "ai" }),
    /illegal workflow handoff transition/
  );
});

test("rich text payload chunks long notes for the Notion API", () => {
  const payload = richTextPayload("x".repeat(4000));
  assert.equal(payload.length, 3);
  assert.equal(payload.map((item) => item.text.content).join("").length, 4000);
});
