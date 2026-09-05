import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const ENRICHMENT_STAGES = Object.freeze(["base-metadata", "people", "honors", "highlights"]);
export const ENRICHMENT_STAGE_STATUSES = Object.freeze([
  "pending",
  "in_progress",
  "draft",
  "completed",
  "blocked",
  "waiting_user",
  "deferred",
  "skipped"
]);

const TERMINAL_STAGE_STATUSES = new Set(["completed", "skipped"]);
const ACTION_BY_STAGE = Object.freeze({
  "base-metadata": "run_wwp_metadata_backfiller",
  people: "run_wwp_people_curator",
  honors: "run_wwp_honors_curator",
  highlights: "run_wwp_highlight_curator"
});

export function emptyEnrichmentCampaign(now = new Date().toISOString()) {
  return { schemaVersion: 1, createdAt: now, updatedAt: now, works: [] };
}

function cleanString(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function cleanInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function uniqueStrings(values = []) {
  return [...new Set(values.map(cleanString).filter(Boolean))];
}

function stage(status = "pending", details = {}) {
  return {
    status,
    reason: cleanString(details.reason),
    missingFields: uniqueStrings(details.missingFields),
    humanConfirmationReasons: uniqueStrings(details.humanConfirmationReasons),
    nextReviewAt: cleanString(details.nextReviewAt),
    updatedAt: cleanString(details.updatedAt)
  };
}

function initialStages(input, now) {
  const metadataComplete = input.metadataStatus === "verified";
  const peopleComplete = input.peopleStatus === "verified"
    || (input.peopleStatus === "partial" && input.keyCreatorsVerified === true);
  const honorsComplete = input.honorsStatus === "verified" || input.honorsStatus === "checked_none_found";
  const humanReasons = uniqueStrings(input.humanConfirmationReasons);
  const metadataBlocked = input.metadataStatus === "conflict";
  const peopleBlocked = input.peopleStatus === "conflict";
  const honorsBlocked = input.honorsStatus === "conflict";
  const metadataMissing = uniqueStrings(input.metadataMissingFields);
  const peopleMissing = uniqueStrings(input.peopleMissingFields);
  const honorsMissing = uniqueStrings(input.honorsMissingFields);
  const firstIncomplete = !metadataComplete ? "base-metadata" : !peopleComplete ? "people" : !honorsComplete ? "honors" : "highlights";

  const result = {
    "base-metadata": stage(metadataComplete ? "completed" : metadataBlocked ? "blocked" : "pending", {
      reason: metadataBlocked ? "metadata_conflict" : null,
      missingFields: metadataMissing,
      updatedAt: now
    }),
    people: stage(peopleComplete ? "completed" : peopleBlocked ? "blocked" : "pending", {
      reason: peopleBlocked ? "people_conflict" : null,
      missingFields: peopleMissing,
      updatedAt: now
    }),
    honors: stage(honorsComplete ? "completed" : honorsBlocked ? "blocked" : "pending", {
      reason: honorsBlocked ? "honors_conflict" : null,
      missingFields: honorsMissing,
      updatedAt: now
    }),
    highlights: stage(
      ["reviewed", "verified"].includes(input.highlightStatus)
        ? "completed"
        : input.highlightStatus === "draft"
          ? "draft"
          : input.highlightHumanLocked === true
            ? "skipped"
            : "pending",
      { reason: input.highlightHumanLocked === true ? "human_locked" : null, updatedAt: now }
    )
  };
  if (humanReasons.length > 0 && !TERMINAL_STAGE_STATUSES.has(result[firstIncomplete].status)) {
    result[firstIncomplete] = stage("waiting_user", {
      reason: "human_confirmation_required",
      missingFields: result[firstIncomplete].missingFields,
      humanConfirmationReasons: humanReasons,
      updatedAt: now
    });
  }
  return result;
}

function itemKey(input) {
  const externalWorkId = cleanString(input.externalWorkId ?? input.workId);
  const pageId = cleanString(input.pageId ?? input.notionWorkPageId);
  const ledgerWorkId = cleanInteger(input.ledgerWorkId);
  if (externalWorkId) return `ww:${externalWorkId}`;
  if (pageId) return `notion:${pageId}`;
  if (ledgerWorkId) return `ledger:${ledgerWorkId}`;
  throw new Error("enrichment work requires externalWorkId/workId, pageId, or ledgerWorkId");
}

function mergeIdentity(existing, incoming) {
  return {
    ...existing,
    ledgerWorkId: cleanInteger(incoming.ledgerWorkId) ?? existing.ledgerWorkId ?? null,
    externalWorkId: cleanString(incoming.externalWorkId ?? incoming.workId) ?? existing.externalWorkId ?? null,
    pageId: cleanString(incoming.pageId ?? incoming.notionWorkPageId) ?? existing.pageId ?? null,
    title: cleanString(incoming.title ?? incoming.canonicalTitle) ?? existing.title ?? null
  };
}

export function enqueueEnrichmentWorks(state, inputs, { source = "manual", now = new Date().toISOString() } = {}) {
  const campaign = state?.schemaVersion === 1 ? structuredClone(state) : emptyEnrichmentCampaign(now);
  const added = [];
  const existing = [];
  for (const input of inputs ?? []) {
    const key = itemKey(input);
    const found = campaign.works.find((work) => work.key === key
      || (cleanInteger(input.ledgerWorkId) && work.ledgerWorkId === cleanInteger(input.ledgerWorkId))
      || (cleanString(input.externalWorkId ?? input.workId) && work.externalWorkId === cleanString(input.externalWorkId ?? input.workId))
      || (cleanString(input.pageId ?? input.notionWorkPageId) && work.pageId === cleanString(input.pageId ?? input.notionWorkPageId)));
    if (found) {
      Object.assign(found, mergeIdentity(found, input));
      found.sources = uniqueStrings([...(found.sources ?? []), source]);
      found.updatedAt = now;
      existing.push(found.key);
      continue;
    }
    const work = mergeIdentity({
      key,
      sources: [source],
      stages: initialStages(input, now),
      createdAt: now,
      updatedAt: now
    }, input);
    campaign.works.push(work);
    added.push(work.key);
  }
  campaign.updatedAt = now;
  return { state: campaign, added, existing };
}

export function updateEnrichmentStage(state, selector, update, { now = new Date().toISOString() } = {}) {
  if (!ENRICHMENT_STAGES.includes(update.stage)) throw new Error(`unsupported enrichment stage: ${update.stage}`);
  if (!ENRICHMENT_STAGE_STATUSES.includes(update.status)) throw new Error(`unsupported enrichment stage status: ${update.status}`);
  const campaign = structuredClone(state);
  const work = campaign.works.find((candidate) =>
    (selector.key && candidate.key === selector.key)
    || (selector.externalWorkId && candidate.externalWorkId === selector.externalWorkId)
    || (selector.pageId && candidate.pageId === selector.pageId)
    || (selector.ledgerWorkId && candidate.ledgerWorkId === Number(selector.ledgerWorkId)));
  if (!work) throw new Error("enrichment work item not found");
  const previous = work.stages[update.stage] ?? stage();
  const nextReason = update.reason ?? previous.reason;
  const nextMissingFields = update.missingFields ?? previous.missingFields;
  const nextHumanReasons = update.humanConfirmationReasons ?? previous.humanConfirmationReasons;
  const nextReviewAt = update.nextReviewAt ?? previous.nextReviewAt;
  if (update.status === "deferred" && (!nextReviewAt || Number.isNaN(Date.parse(nextReviewAt)))) {
    throw new Error("deferred enrichment stage requires a valid nextReviewAt");
  }
  if (update.status === "blocked" && !cleanString(nextReason) && uniqueStrings(nextMissingFields).length === 0) {
    throw new Error("blocked enrichment stage requires a reason or missing field");
  }
  if (update.status === "waiting_user" && !cleanString(nextReason) && uniqueStrings(nextHumanReasons).length === 0) {
    throw new Error("waiting_user enrichment stage requires a reason or human confirmation");
  }
  if (update.status === "in_progress") {
    const currentStage = currentEnrichmentStage(work);
    if (currentStage !== update.stage) throw new Error(`cannot start ${update.stage} before current stage ${currentStage ?? "complete"}`);
    const otherActive = campaign.works.find((candidate) => candidate.key !== work.key
      && ENRICHMENT_STAGES.some((name) => candidate.stages?.[name]?.status === "in_progress"));
    if (otherActive) throw new Error(`another enrichment work is already in progress: ${otherActive.key}`);
  }
  work.stages[update.stage] = stage(update.status, {
    reason: update.status === "completed" ? null : nextReason,
    missingFields: update.status === "completed" ? [] : nextMissingFields,
    humanConfirmationReasons: update.status === "completed" ? [] : nextHumanReasons,
    nextReviewAt: update.status === "completed" ? null : nextReviewAt,
    updatedAt: now
  });
  work.updatedAt = now;
  campaign.updatedAt = now;
  return { state: campaign, work };
}

export function currentEnrichmentStage(work) {
  return ENRICHMENT_STAGES.find((name) => !TERMINAL_STAGE_STATUSES.has(work.stages?.[name]?.status ?? "pending")) ?? null;
}

function isDue(stageState, now) {
  if (["pending", "in_progress", "draft"].includes(stageState.status)) return true;
  if (stageState.status !== "deferred") return false;
  return Boolean(stageState.nextReviewAt && stageState.nextReviewAt <= now);
}

function publicWork(work, now) {
  const currentStage = currentEnrichmentStage(work);
  const current = currentStage ? work.stages[currentStage] : null;
  return {
    key: work.key,
    ledgerWorkId: work.ledgerWorkId ?? null,
    externalWorkId: work.externalWorkId ?? null,
    pageId: work.pageId ?? null,
    title: work.title ?? null,
    sources: work.sources ?? [],
    currentStage,
    currentStatus: current?.status ?? "completed",
    nextAction: currentStage ? ACTION_BY_STAGE[currentStage] : "none",
    actionableNow: Boolean(current && isDue(current, now)),
    reason: current?.reason ?? null,
    missingFields: current?.missingFields ?? [],
    humanConfirmationReasons: current?.humanConfirmationReasons ?? [],
    nextReviewAt: current?.nextReviewAt ?? null,
    stages: work.stages
  };
}

export function buildEnrichmentCampaignReport(state, { limit = 3, now = new Date().toISOString() } = {}) {
  const works = (state?.works ?? []).map((work) => publicWork(work, now));
  const due = works.filter((work) => work.actionableNow).slice(0, limit);
  const waitingForHuman = works.filter((work) => work.currentStatus === "waiting_user");
  const blocked = works.filter((work) => work.currentStatus === "blocked");
  const scheduledReviews = works.filter((work) => work.currentStatus === "deferred" && !work.actionableNow);
  const completed = works.filter((work) => work.currentStage === null);
  return {
    statePath: null,
    summary: {
      total: works.length,
      actionableNow: works.filter((work) => work.actionableNow).length,
      waitingForHuman: waitingForHuman.length,
      blocked: blocked.length,
      scheduledReview: scheduledReviews.length,
      completed: completed.length
    },
    due,
    waitingForHuman,
    blocked,
    scheduledReviews,
    completed: completed.slice(0, limit)
  };
}

export function readEnrichmentCampaign(filePath) {
  if (!existsSync(filePath)) return emptyEnrichmentCampaign();
  const state = JSON.parse(readFileSync(filePath, "utf8"));
  if (state?.schemaVersion !== 1 || !Array.isArray(state.works)) throw new Error(`unsupported enrichment campaign file: ${filePath}`);
  return state;
}

export function writeEnrichmentCampaign(filePath, state) {
  const resolved = path.resolve(filePath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return resolved;
}

export function reportEnrichmentCampaignFile(filePath, options = {}) {
  const report = buildEnrichmentCampaignReport(readEnrichmentCampaign(filePath), options);
  report.statePath = path.resolve(filePath);
  return report;
}
