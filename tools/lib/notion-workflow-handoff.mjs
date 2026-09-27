import {
  AI_ACTIONABLE_WORKFLOW_STATES,
  assertWorkflowHandoffState,
  assertWorkflowHandoffTransition
} from "./film-ledger-domain.mjs";

export const WORKFLOW_STATUS_PROPERTY = "Workflow Status";
export const WORKFLOW_NOTE_PROPERTY = "Workflow Note";
export const HUMAN_ISSUE_PROPERTY = "Human Issue";
export const AI_ISSUE_PROPERTY = "AI Issue";
export const AI_NOTE_PREFIX = "【AI(^_^)";

export const WORKFLOW_STATUS_OPTIONS = Object.freeze([
  { name: "待 AI 处理", color: "blue" },
  { name: "AI 处理中", color: "purple" },
  { name: "待人工上传", color: "yellow" },
  { name: "人工上传中", color: "orange" },
  { name: "已上传待 AI 收尾", color: "blue" },
  { name: "待人工确认", color: "yellow" },
  { name: "已确认待 AI 发布", color: "green" },
  { name: "已完成", color: "green" },
  { name: "暂缓", color: "gray" }
]);

function plainText(items) {
  return (items ?? []).map((item) => item?.plain_text ?? item?.text?.content ?? "").join("");
}

export function propertyText(property) {
  if (property?.type === "title") return plainText(property.title);
  if (property?.type === "rich_text") return plainText(property.rich_text);
  return "";
}

export function pageTitle(page) {
  const title = Object.values(page?.properties ?? {}).find((property) => property?.type === "title");
  return propertyText(title) || "Untitled";
}

export function workflowStateFromPage(page) {
  return page?.properties?.[WORKFLOW_STATUS_PROPERTY]?.select?.name ?? "";
}

export function workflowNoteFromPage(page) {
  return propertyText(page?.properties?.[WORKFLOW_NOTE_PROPERTY]);
}

export function isAiWorkflowNoteLine(line) {
  const value = String(line ?? "").trimStart();
  return value.startsWith(AI_NOTE_PREFIX)
    // Pre-protocol history used timestamped actor labels. Treat only machine
    // labels as an acknowledgement boundary; old human entries stay human text.
    || /^\[\d{4}-\d{2}-\d{2}(?:T[^\]]+)?\s(?:AI|codex|系统)\]/u.test(value)
    // A short period before the shared-note protocol used unbracketed
    // date-prefixed machine completion records. Match only their distinctive
    // operational vocabulary so dated human notes remain actionable.
    || /^\d{4}-\d{2}-\d{2}\s.*(?:自动上传|Media Assets|网站发布|现场读回|账本\s*sync_ready|hvc1)/iu.test(value);
}

// Human instructions are the plain-text tail after the most recent AI marker.
// This preserves the full shared history without relying on a second issue field.
export function pendingHumanWorkflowNote(value) {
  const lines = String(value ?? "").replaceAll("\r\n", "\n").split("\n");
  let lastAiLine = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (isAiWorkflowNoteLine(lines[index])) lastAiLine = index;
  }
  return lines.slice(lastAiLine + 1).join("\n").trim();
}

export function pendingHumanWorkflowNoteFromPage(page) {
  return pendingHumanWorkflowNote(workflowNoteFromPage(page));
}

export function humanIssueFromPage(page) {
  return propertyText(page?.properties?.[HUMAN_ISSUE_PROPERTY]);
}

export function explicitVisibilityHoldFromPage(page) {
  const note = pendingHumanWorkflowNoteFromPage(page);
  // A release-first instruction must override an older or poorly worded
  // warning. Only an unambiguous hold is allowed to keep the whole work
  // hidden; metadata and repair notes are not human visibility holds.
  if (/(?:不影响(?:正常)?(?:观看|播放)|尽量(?:先)?放出|先放(?:出|着)|以后(?:再)?补|后续(?:再)?修|不要(?:轻易|因为[^。\n]{0,24}而)?(?:隐藏|下线|不公开)|不应(?:轻易)?(?:隐藏|下线|不公开))/u.test(note)) {
    return false;
  }
  return /(?:暂不|先不|禁止|勿|不要(?:立即|现在|先)?).{0,5}(?:发布|放出|上线|同步)|(?:保持|继续|保留).{0,8}(?:隐藏|下线|不公开)/u.test(note);
}

const DIRECT_VIEWING_RISK = /(?:无法播放|不能播放|播放失败|播放无声|播放没声音|播放卡死|黑屏|无声音|没有声音|静音|无法解码|解码失败|编码不兼容|色彩严重错误|严重偏色|媒体块缺失|媒体块错误|错误影片被播放|播放了错误影片|播放结构导致无法打开|页面映射导致无法打开|网站无法(?:呈现|打开)视频)/iu;
// A suspected or unconfirmed risk is follow-up work, not proof that the
// public path is unsafe. Keep the catalog visible until a later note records
// an observed failure or an explicit human visibility hold.
const UNCERTAIN_VIEWING_RISK = /(?:可能|或许|疑似|疑虑|不确定|尚未确认|待确认|需要确认|无法判断|未知|风险|待复核|待检查)/iu;
const OBSERVED_VIEWING_EVIDENCE = /(?:实测|复测|测试(?:播放|解码|声音|画面)|实际(?:播放|测试|验证)|确认(?:无法播放|不能播放|播放失败|播放无声|播放没声音|无法解码|解码失败|严重偏色)|检查发现(?:播放|解码|声音|画面))/iu;
const POSITIVE_VISIBILITY_REVIEW = /(?:已修复|已恢复|播放正常|声音正常|解码正常|通过[^。\n]{0,24}(?:复核|质检)|(?:可以|能够|允许|同意|确认|通过|放行).{0,8}(?:发布|放出|网站|同步)|(?:发布|放出|上线)(?:到|至)?(?:网站|站点)?|(?:小|一点|轻微).{0,8}(?:缺陷|瑕疵|问题).{0,12}(?:以后|后续|之后).{0,8}(?:补|修)|先(?:发布|放出|上线).{0,12}(?:以后|后续|再).{0,8}(?:补|修))/gu;

// Workflow Note is append-only. A later human approval may resolve an older
// AI playback warning, but only when that approval line itself contains no new
// viewing risk. This keeps the default fail-open policy from being defeated by
// stale history while preserving a newer "still no sound" warning.
function unresolvedVisibilityNote(note) {
  const lines = String(note ?? "").replaceAll("\r\n", "\n").split("\n");
  let lastResolution = -1;
  for (let index = 0; index < lines.length; index += 1) {
    POSITIVE_VISIBILITY_REVIEW.lastIndex = 0;
    const normalized = lines[index].replace(POSITIVE_VISIBILITY_REVIEW, "").trim();
    if (normalized !== lines[index].trim() && !DIRECT_VIEWING_RISK.test(normalized)) lastResolution = index;
  }
  return lines.slice(lastResolution + 1).join("\n").replace(POSITIVE_VISIBILITY_REVIEW, "").trim();
}

export function visibilityHideReasonIsConcrete(note) {
  const value = unresolvedVisibilityNote(note);
  if (!value) return false;
  if (/(?:不影响(?:正常)?(?:观看|播放)|不影响用户观看|仍可正常(?:观看|播放)|可以正常(?:观看|播放)|(?:小|一点|轻微).{0,8}(?:缺陷|瑕疵|问题).{0,12}(?:以后|后续|之后).{0,8}(?:补|修)|先(?:发布|放出|上线).{0,12}(?:以后|后续|再).{0,8}(?:补|修))/iu.test(value)) return false;
  if (UNCERTAIN_VIEWING_RISK.test(value)) return false;
  if (!OBSERVED_VIEWING_EVIDENCE.test(value)) return false;

  // Visibility is a playback-safety gate, not a generic quality/review gate.
  // Keep this allowlist deliberately narrow: "字幕待补", "资料不全", a
  // naming issue, an empty optional sibling, or a page still being整理 are
  // follow-up work and must not hide an otherwise usable catalog entry.
  return /(?:无法播放|不能播放|播放失败|播放无声|播放没声音|播放卡死|黑屏|无声音|没有声音|静音|无法解码|解码失败|编码不兼容|色彩严重错误|严重偏色|媒体块缺失|媒体块错误|错误影片被播放|播放了错误影片|播放结构导致无法打开|页面映射导致无法打开|网站无法(?:呈现|打开)视频|明确(?:暂不发布|暂不公开|保持隐藏|人工保留隐藏))/iu.test(value);
}

// Work-level visibility is narrower than child asset/spec visibility. A bad
// child must not hide the whole title while another playable path remains.
export function workVisibilityHideReasonIsConcrete(note) {
  const value = unresolvedVisibilityNote(note);
  if (!value) return false;
  // "尚无可播放版本" describes an unfinished catalog/production state, not
  // an unsafe path exposed to visitors. Keep the work visible by default and
  // hide only the empty child spec/episode if the caller needs that isolation.
  if (/(?:没有(?:任何|可用的)?(?:可播放|播放)|尚无(?:任何|可用的)?可播放|暂无(?:可播放|播放)|等待(?:首个|第一个)(?:可播放|压制|上传)|还没有(?:可播放|播放))/iu.test(value)) {
    return false;
  }
  if (/(?:明确(?:暂不发布|暂不公开|保持隐藏|人工保留隐藏))/iu.test(value)) return true;
  if (UNCERTAIN_VIEWING_RISK.test(value)) return false;
  // A playback symptom alone is not enough to hide a catalog entry. Require
  // current observed evidence; speculation, inherited warnings, and untested
  // reports stay visible until reproduced.
  if (!OBSERVED_VIEWING_EVIDENCE.test(value)) return false;
  if (/(?:整个(?:条目|作品)|全片|全部(?:规格|版本|集)|唯一(?:可播放|已上传))/iu.test(value)) return true;
  if (/(?:不影响(?:正常)?(?:观看|播放)|不影响用户观看|仍可正常(?:观看|播放)|可以正常(?:观看|播放)|(?:小|一点|轻微).{0,8}(?:缺陷|瑕疵|问题).{0,12}(?:以后|后续|之后).{0,8}(?:补|修)|先(?:发布|放出|上线).{0,12}(?:以后|后续|再).{0,8}(?:补|修))/iu.test(value)) return false;
  // A work-level flag must not be triggered by a defect that is explicitly
  // scoped to one child path.  The child page/asset can remain hidden while
  // the parent catalog entry stays visible for every usable variant.
  if (/(?:一个|某个|某条|此(?:规格|版本|集)|该(?:规格|版本|集)|这(?:个|条)(?:规格|版本|集)|单集|子页面|第\s*\d+\s*集|\d+\s*集|某(?:规格|版本|集)|其中)/iu.test(value)) {
    return false;
  }
  // A work-level hide requires explicit scope evidence that every exposed
  // playable path is affected. A reproduced symptom without that scope is
  // isolated to its child path and must fail open at work level.
  return false;
}

// Workflow Note is an append-only history.  Visibility repair must inspect
// the current handoff, not a resolved playback problem recorded months ago.
export function latestWorkflowNoteSegment(note) {
  const lines = String(note ?? "").replaceAll("\r\n", "\n").split("\n");
  let lastAiLine = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (isAiWorkflowNoteLine(lines[index])) lastAiLine = index;
  }
  return lines.slice(Math.max(0, lastAiLine)).join("\n").trim();
}

// Hidden work pages created by older workflow versions must not stay hidden
// merely because nobody has cleared the old checkbox.  A work-level hide is
// valid only when the current record still contains a concrete viewing risk
// or an explicit human hold.
export function shouldAutoReleaseWorkVisibility(page) {
  const properties = page?.properties ?? {};
  if (properties["Hide from Website"]?.checkbox !== true) return false;
  if (explicitVisibilityHoldFromPage(page)) return false;
  return !workVisibilityHideReasonIsConcrete(latestWorkflowNoteSegment(workflowNoteFromPage(page)));
}

export function workVisibilityBlockers(page) {
  const properties = page?.properties ?? {};
  const blockers = [];
  if (properties["Hide from Website"]?.type !== "checkbox") blockers.push("hide_property_missing");
  if (explicitVisibilityHoldFromPage(page)) blockers.push("visibility_hold");
  if (!explicitVisibilityHoldFromPage(page)
    && workVisibilityHideReasonIsConcrete(latestWorkflowNoteSegment(workflowNoteFromPage(page)))) {
    blockers.push("concrete_visibility_risk");
  }
  return blockers;
}

export function workVisibilityReleaseBlockers(page) {
  const properties = page?.properties ?? {};
  const blockers = [];
  if (properties["Hide from Website"]?.type !== "checkbox") blockers.push("hide_property_missing");
  // The caller must verify an exact usable media path before an explicit
  // release. Historical/work-level playback notes cannot override that proof;
  // only a current human hold can veto the release.
  if (explicitVisibilityHoldFromPage(page)) blockers.push("visibility_hold");
  return blockers;
}

// These are final-completion blockers, not website-visibility blockers.
// A playable work may remain in AI 处理中 while metadata or follow-up issues
// are repaired; callers must use workVisibilityBlockers for that decision.
export function workCompletionBlockers(page) {
  const properties = page?.properties ?? {};
  const blockers = workVisibilityBlockers(page).filter((blocker) => blocker !== "visibility_hold");
  if (properties["Metadata Status"]?.select?.name !== "verified") blockers.push("metadata_not_verified");
  if (properties["Needs Review"]?.checkbox !== false) blockers.push("needs_review");
  if (humanIssueFromPage(page)) blockers.push("human_issue");
  if (propertyText(properties[AI_ISSUE_PROPERTY])) blockers.push("ai_issue");
  if (pendingHumanWorkflowNoteFromPage(page)) blockers.push("pending_human_note");
  return blockers;
}

// Compatibility export for older callers. Keep the old name as an alias so
// external scripts do not silently change behavior during the migration.
export const workReleaseBlockers = workCompletionBlockers;

export function buildActionableWorkflowFilter(statuses = AI_ACTIONABLE_WORKFLOW_STATES) {
  const unique = [...new Set(statuses)];
  for (const status of unique) assertWorkflowHandoffState(status);
  return {
    or: unique.map((status) => ({
      property: WORKFLOW_STATUS_PROPERTY,
      select: { equals: status }
    }))
  };
}

export function appendWorkflowNote(current, { actor, note, at = new Date().toISOString() }) {
  const normalizedNote = String(note ?? "").trim();
  if (!normalizedNote) return String(current ?? "");
  const entry = actor === "ai"
    ? `${AI_NOTE_PREFIX} ${at}】 ${normalizedNote}`
    : normalizedNote;
  const combined = [String(current ?? "").trim(), entry].filter(Boolean).join("\n");
  return combined.length <= 8000 ? combined : combined.slice(combined.length - 8000);
}

export function richTextPayload(value) {
  const text = String(value ?? "");
  const chunks = [];
  for (let offset = 0; offset < text.length; offset += 1900) {
    chunks.push({ type: "text", text: { content: text.slice(offset, offset + 1900) } });
  }
  return chunks;
}

export function buildWorkflowUpdate(page, { status, note, actor = "ai", at, enforceTransition = true }) {
  assertWorkflowHandoffState(status);
  const currentStatus = workflowStateFromPage(page);
  if (enforceTransition) assertWorkflowHandoffTransition(currentStatus, status);
  const currentNote = workflowNoteFromPage(page);
  const nextNote = note == null ? currentNote : appendWorkflowNote(currentNote, { actor, note, at });
  return {
    currentStatus,
    nextStatus: status,
    currentNote,
    nextNote,
    properties: {
      [WORKFLOW_STATUS_PROPERTY]: { select: { name: status } },
      ...(note == null ? {} : { [WORKFLOW_NOTE_PROPERTY]: { rich_text: richTextPayload(nextNote) } })
    }
  };
}
