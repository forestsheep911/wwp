import test from "node:test";
import assert from "node:assert/strict";
import {
  appendWorkflowNote,
  buildActionableWorkflowFilter,
  buildWorkflowUpdate,
  pendingHumanWorkflowNote,
  richTextPayload,
  workVisibilityBlockers,
  workVisibilityReleaseBlockers,
  workCompletionBlockers,
  workReleaseBlockers,
  shouldAutoReleaseWorkVisibility,
  latestWorkflowNoteSegment,
  explicitVisibilityHoldFromPage,
  workVisibilityHideReasonIsConcrete,
  visibilityHideReasonIsConcrete
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

function releasablePage(overrides = {}) {
  return {
    properties: {
      ...page("待人工确认", "【AI(^_^) 2026-08-28T00:00:00.000Z】 发布门禁完成。").properties,
      "Hide from Website": { type: "checkbox", checkbox: true },
      "Metadata Status": { type: "select", select: { name: "verified" } },
      "Needs Review": { type: "checkbox", checkbox: false },
      "Human Issue": { type: "rich_text", rich_text: [] },
      "AI Issue": { type: "rich_text", rich_text: [] },
      ...overrides
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

test("work release gate accepts a verified page without pending issues", () => {
  assert.deepEqual(workReleaseBlockers(releasablePage()), []);
  assert.deepEqual(workCompletionBlockers(releasablePage()), []);
});

test("work visibility release is not blocked by metadata or follow-up issues", () => {
  const candidate = releasablePage({
    "Needs Review": { type: "checkbox", checkbox: true },
    "Metadata Status": { type: "select", select: { name: "partial" } },
    "Human Issue": { type: "rich_text", rich_text: [{ plain_text: "海报待修" }] },
    "AI Issue": { type: "rich_text", rich_text: [{ plain_text: "海报待修" }] },
    "Workflow Note": {
      type: "rich_text",
      rich_text: [{ plain_text: "【AI(^_^) 2026-08-28T00:00:00.000Z】 已检查。\n海报待修，后续补齐。" }]
    }
  });
  assert.deepEqual(workVisibilityBlockers(candidate), []);
});

test("unconfirmed playback suspicion stays visible until failure is evidenced", () => {
  const candidate = releasablePage({
    "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: "可能无法播放，待确认；资料和海报也未补齐" }] }
  });
  assert.equal(shouldAutoReleaseWorkVisibility(candidate), true);
  assert.deepEqual(workVisibilityBlockers(candidate), []);

  const confirmed = releasablePage({
    "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: "实测唯一可播放版本播放失败：无声音" }] }
  });
  assert.equal(shouldAutoReleaseWorkVisibility(confirmed), false);
  assert.deepEqual(workVisibilityBlockers(confirmed), ["concrete_visibility_risk"]);
});

test("visibility remains releasable for the common non-playback follow-up bundle", () => {
  const candidate = releasablePage({
    "Needs Review": { type: "checkbox", checkbox: true },
    "Metadata Status": { type: "select", select: { name: "partial" } },
    "Human Issue": { type: "rich_text", rich_text: [{ plain_text: "人物和海报待补" }] },
    "AI Issue": { type: "rich_text", rich_text: [{ plain_text: "评分来源待补" }] },
    "Workflow Note": {
      type: "rich_text",
      rich_text: [{ plain_text: "【AI(^_^) 2026-09-18T00:00:00.000Z】 已发布可播放版本；资料补全和规格扩展继续排队。" }]
    }
  });
  assert.deepEqual(workVisibilityBlockers(candidate), []);
});

test("AI processing status does not hide an already playable work", () => {
  const candidate = releasablePage({
    "Workflow Status": { type: "select", select: { name: "AI 处理中" } },
    "Metadata Status": { type: "select", select: { name: "partial" } },
    "Needs Review": { type: "checkbox", checkbox: true },
    "AI Issue": { type: "rich_text", rich_text: [{ plain_text: "人物资料待补" }] }
  });
  assert.deepEqual(workVisibilityBlockers(candidate), []);
});

test("an explicit human visibility hold still blocks release", () => {
  const candidate = releasablePage({
    "Workflow Note": {
      type: "rich_text",
      rich_text: [{ plain_text: "【AI(^_^) 2026-08-28T00:00:00.000Z】 已检查。\n暂不发布，保持隐藏。" }]
    }
  });
  assert.deepEqual(workVisibilityBlockers(candidate), ["visibility_hold"]);
});

test("a stale work-level hide is auto-released when no viewing risk is recorded", () => {
  assert.equal(shouldAutoReleaseWorkVisibility(releasablePage({
    "Workflow Note": {
      type: "rich_text",
      rich_text: [{ plain_text: "【AI(^_^) 2026-09-19T00:00:00.000Z】 资料和海报待补。" }]
    }
  })), true);
});

test("production deferral and subtitle follow-up do not preserve a work-level hide", () => {
  for (const note of [
    "【AI(^_^) 2026-09-19T00:00:00.000Z】 资料已建档，中文字幕待补，制作暂缓。",
    "【AI(^_^) 2026-09-19T00:00:00.000Z】 规格扩展尚未完成，已有版本可以观看。",
    "【AI(^_^) 2026-09-19T00:00:00.000Z】 AI处理中，海报和人物资料后续补齐。"
  ]) {
    const candidate = releasablePage({
      "Hide from Website": { type: "checkbox", checkbox: true },
      "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: note }] }
    });
    assert.equal(shouldAutoReleaseWorkVisibility(candidate), true, note);
    assert.deepEqual(workVisibilityBlockers(candidate), [], note);
  }
});

test("follow-up states never become a work-level hide by themselves", () => {
  for (const status of ["AI 处理中", "待人工确认", "暂缓"]) {
    const candidate = releasablePage({
      "Workflow Status": { type: "select", select: { name: status } },
      "Metadata Status": { type: "select", select: { name: "partial" } },
      "Needs Review": { type: "checkbox", checkbox: true },
      "AI Issue": { type: "rich_text", rich_text: [{ plain_text: "海报和人物资料待补" }] },
      "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: "规格还有小问题，后续补齐。" }] }
    });
    assert.equal(shouldAutoReleaseWorkVisibility(candidate), true, status);
    assert.deepEqual(workVisibilityBlockers(candidate), [], status);
  }
});

test("a concrete playback risk keeps work-level hide intact", () => {
  const candidate = releasablePage({
      "Workflow Note": {
      type: "rich_text",
      rich_text: [{ plain_text: "【AI(^_^) 2026-09-19T00:00:00.000Z】 实测 Edge 播放无声音，当前唯一可播放规格受影响，暂不发布。" }]
    }
  });
  assert.equal(shouldAutoReleaseWorkVisibility(candidate), false);
  assert.deepEqual(workVisibilityBlockers(candidate), ["concrete_visibility_risk"]);
  assert.deepEqual(workVisibilityReleaseBlockers(candidate), []);
});

test("explicit visibility release ignores playback notes after usable-path verification", () => {
  const followUp = releasablePage({
    "Metadata Status": { type: "select", select: { name: "partial" } },
    "Needs Review": { type: "checkbox", checkbox: true },
    "AI Issue": { type: "rich_text", rich_text: [{ plain_text: "海报待补" }] },
    "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: "【AI(^_^) 2026-09-25T00:00:00.000Z】 资料和海报稍后补，不影响观看，先发布。" }] }
  });
  assert.deepEqual(workVisibilityReleaseBlockers(followUp), []);

  const actualFailure = releasablePage({
    "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: "【AI(^_^) 2026-09-25T00:00:00.000Z】 实测唯一可播放版本无法解码，暂不发布。" }] }
  });
  assert.deepEqual(workVisibilityReleaseBlockers(actualFailure), []);

  const explicitHold = releasablePage({
    "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: "暂不发布，保持隐藏。" }] }
  });
  assert.deepEqual(workVisibilityReleaseBlockers(explicitHold), ["visibility_hold"]);
});

test("minor follow-up defects do not count as visibility blockers", () => {
  for (const note of [
    "资料不全，后续补人物和海报。",
    "中文字幕待补，规格扩展继续。",
    "规格页面名称待整理，Needs Review=true。",
    "有一个空的可选规格页，后续清理。",
    "AI处理中，评分和简介尚未补齐。",
    "画面有轻微问题，但不影响正常观看，后续修复。",
    "人声比另一音轨略大，但能正常听清，后续再平衡。",
    "有轻微水印和压缩痕迹，仍可正常观看。",
    "字幕位置略有偏差但不遮挡内容，之后优化。",
    "高码率版本尚未制作，先发布现有版本。",
    "上传速度慢，稍后继续上传。",
    "资料补全阻塞，但已有版本可以正常播放。"
  ]) {
    assert.equal(visibilityHideReasonIsConcrete(note), false, note);
  }
});

test("only material viewing failures count as automatic hide reasons", () => {
  for (const note of [
    "Edge 播放无声音，暂不发布。",
    "该媒体块缺失，页面会出现无法播放的条目。",
    "当前视频无法解码，等待替换版本。",
    "网站播放严重偏色，保持隐藏。"
  ]) {
    assert.equal(visibilityHideReasonIsConcrete(note), false, note);
  }
  assert.equal(visibilityHideReasonIsConcrete("实测 Edge 播放无声音，暂时隐藏该规格。"), true);
});

test("an unfinished catalog does not become hidden just because it has no playable path yet", () => {
  for (const note of [
    "目前没有任何可播放版本，等待压制。",
    "尚无可播放资源，先补影片资料。",
    "暂无播放版本，字幕和制作排队中。",
    "等待首个可播放版本上传。"
  ]) {
    assert.equal(workVisibilityHideReasonIsConcrete(note), false, note);
    assert.deepEqual(workVisibilityBlockers({
      properties: {
        "Hide from Website": { type: "checkbox", checkbox: true },
        "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: note }] }
      }
    }), []);
  }
});

test("a child failure does not hide the whole work when another path can remain visible", () => {
  for (const note of [
    "一个规格媒体块缺失，其他规格仍可播放。",
    "某个子页面播放无声音，保留其他已通过版本。",
    "单集无法解码，等待替换，作品其他集正常。",
    "此规格播放无声音，其他版本不受影响。",
    "第 3 集无法播放，其他集正常。",
    "画面有轻微瑕疵，但不影响观看。"
  ]) {
    assert.equal(workVisibilityHideReasonIsConcrete(note), false, note);
  }
  assert.equal(workVisibilityHideReasonIsConcrete("当前唯一可播放版本无法解码，暂不发布。"), false);
  assert.equal(workVisibilityHideReasonIsConcrete("实测当前唯一可播放版本无法解码，暂不发布。"), true);
  assert.equal(workVisibilityHideReasonIsConcrete("实测整个条目无法播放，暂不发布。"), true);
  assert.equal(workVisibilityHideReasonIsConcrete("实测播放无声音。"), false);
  assert.equal(workVisibilityHideReasonIsConcrete("实测第 2 集无法解码。"), false);
  assert.equal(workVisibilityHideReasonIsConcrete("整个条目没有任何可播放版本，等待制作。"), false);
});

test("resolved playback risk in old note history does not keep a work hidden", () => {
  const note = [
    "【AI(^_^) 2026-09-01T00:00:00.000Z】 实测 Edge 播放无声音，当前唯一可播放规格受影响，暂不发布。",
    "【AI(^_^) 2026-09-19T00:00:00.000Z】 已重新压制并通过声音复核，资料补全继续。"
  ].join("\n");
  assert.equal(latestWorkflowNoteSegment(note), "【AI(^_^) 2026-09-19T00:00:00.000Z】 已重新压制并通过声音复核，资料补全继续。");
  assert.equal(shouldAutoReleaseWorkVisibility(releasablePage({
    "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: note }] }
  })), true);
});

test("human publish approval resolves an older visibility risk", () => {
  for (const note of [
    "【AI(^_^) 2026-09-01T00:00:00.000Z】 实测 Edge 播放无声音，当前唯一可播放规格受影响，暂不发布。\n我确认可以发布到网站。",
    "【AI(^_^) 2026-09-01T00:00:00.000Z】 当前视频无法解码，等待替换版本。\n质检通过，放出网站。",
    "【AI(^_^) 2026-09-01T00:00:00.000Z】 网站播放严重偏色，保持隐藏。\n已经修好，允许同步。"
  ]) {
    assert.equal(workVisibilityHideReasonIsConcrete(note), false, note);
    assert.equal(shouldAutoReleaseWorkVisibility(releasablePage({
      "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: note }] }
    })), true, note);
  }
});

test("small repairable defects are fail-open when the note says to release first", () => {
  for (const note of [
    "有一点瑕疵以后再补，先放出网站。",
    "小问题后续补，先发布。",
    "轻微缺陷不影响观看，之后修。"
  ]) {
    assert.equal(visibilityHideReasonIsConcrete(note), false, note);
    assert.equal(workVisibilityHideReasonIsConcrete(note), false, note);
  }
});

test("release-first human guidance is not mistaken for a visibility hold", () => {
  for (const note of [
    "资料还有缺失，但不影响正常观看，先放出，后续再补。",
    "不要因为资料不全而隐藏，先让用户观看，后续补齐。",
    "只要影视条目不影响观看，就应该尽量放出来；有一点缺陷以后补。",
    "不要轻易勾选 Hide from Website。"
  ]) {
    const page = releasablePage({
      "Workflow Note": { type: "rich_text", rich_text: [{ plain_text: note }] }
    });
    assert.equal(explicitVisibilityHoldFromPage(page), false, note);
    assert.deepEqual(workVisibilityBlockers(page), [], note);
  }
});

test("publish approval does not erase a newer unresolved playback risk", () => {
  const note = "【AI(^_^) 2026-09-01T00:00:00.000Z】 实测唯一可播放规格播放无声音，暂不发布。\n可以发布到网站。\n复测后唯一可播放规格仍然无声音。";
  assert.equal(workVisibilityHideReasonIsConcrete(note), true);
});

test("work completion still requires metadata and issue gates", () => {
  const candidate = releasablePage({
    "Needs Review": { type: "checkbox", checkbox: true },
    "AI Issue": { type: "rich_text", rich_text: [{ plain_text: "海报待修" }] },
    "Workflow Note": {
      type: "rich_text",
      rich_text: [{ plain_text: "【AI(^_^) 2026-08-28T00:00:00.000Z】 已检查。\n海报待修，后续补齐。" }]
    }
  });
  assert.deepEqual(workReleaseBlockers(candidate), ["needs_review", "ai_issue", "pending_human_note"]);
  assert.deepEqual(workCompletionBlockers(candidate), ["needs_review", "ai_issue", "pending_human_note"]);
});
