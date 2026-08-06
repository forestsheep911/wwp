import {
  AI_ACTIONABLE_WORKFLOW_STATES,
  assertWorkflowHandoffState,
  assertWorkflowHandoffTransition
} from "./film-ledger-domain.mjs";

export const WORKFLOW_STATUS_PROPERTY = "Workflow Status";
export const WORKFLOW_NOTE_PROPERTY = "Workflow Note";
export const HUMAN_ISSUE_PROPERTY = "Human Issue";
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
