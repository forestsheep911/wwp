import test from "node:test";
import assert from "node:assert/strict";
import {
  appendWorkflowNote,
  buildActionableWorkflowFilter,
  buildWorkflowUpdate,
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

test("workflow note appends actor and timestamp without replacing prior context", () => {
  assert.equal(
    appendWorkflowNote("已有说明", { actor: "ai", note: "已领取。", at: "2026-07-25T00:00:00.000Z" }),
    "已有说明\n[2026-07-25T00:00:00.000Z AI] 已领取。"
  );
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
