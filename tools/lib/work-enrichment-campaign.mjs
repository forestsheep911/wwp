import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { assertAuthorizedPersonPreflight } from "./person-report-authorization.mjs";

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
export const DEFAULT_STALE_IN_PROGRESS_MS = 6 * 60 * 60 * 1000;

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
    coverageResiduals: Array.isArray(details.coverageResiduals) ? structuredClone(details.coverageResiduals) : [],
    nextTrigger: cleanString(details.nextTrigger),
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
  const matches = selector.key
    ? campaign.works.filter((candidate) => candidate.key === selector.key)
    : campaign.works.filter((candidate) =>
      (selector.externalWorkId && candidate.externalWorkId === selector.externalWorkId)
      || (selector.pageId && candidate.pageId === selector.pageId)
      || (selector.ledgerWorkId && candidate.ledgerWorkId === Number(selector.ledgerWorkId)));
  if (matches.length === 0) throw new Error("enrichment work item not found");
  if (matches.length > 1) {
    throw new Error(`enrichment work selector is ambiguous; use --item-key (${matches.map((candidate) => candidate.key).join(", ")})`);
  }
  const [work] = matches;
  const previous = work.stages[update.stage] ?? stage();
  const nextReason = update.reason ?? previous.reason;
  const nextMissingFields = update.missingFields ?? previous.missingFields;
  const nextHumanReasons = update.humanConfirmationReasons ?? previous.humanConfirmationReasons;
  const nextReviewAt = update.nextReviewAt ?? previous.nextReviewAt;
  const nextCoverageResiduals = update.coverageResiduals ?? previous.coverageResiduals;
  const nextTrigger = update.nextTrigger ?? previous.nextTrigger;
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
    if (currentStage !== update.stage) {
      const current = currentStage ? work.stages[currentStage] : null;
      const stableEarlierStage = current && (
        current.status === "blocked"
        || current.status === "waiting_user"
        || (current.status === "deferred" && !isDue(current, now))
      );
      if (!stableEarlierStage) throw new Error(`cannot start ${update.stage} before current stage ${currentStage ?? "complete"}`);
    }
    const otherActive = campaign.works.find((candidate) => candidate.key !== work.key
      && ENRICHMENT_STAGES.some((name) => candidate.stages?.[name]?.status === "in_progress"));
    if (otherActive) throw new Error(`another enrichment work is already in progress: ${otherActive.key}`);
  }
  work.stages[update.stage] = stage(update.status, {
    reason: update.status === "completed" ? null : nextReason,
    missingFields: update.status === "completed" ? [] : nextMissingFields,
    humanConfirmationReasons: update.status === "completed" ? [] : nextHumanReasons,
    nextReviewAt: update.status === "completed" ? null : nextReviewAt,
    coverageResiduals: update.status === "completed" ? [] : nextCoverageResiduals,
    nextTrigger: update.status === "completed" ? null : nextTrigger,
    updatedAt: now
  });
  work.updatedAt = now;
  campaign.updatedAt = now;
  return { state: campaign, work };
}

/**
 * Recover abandoned worker claims without pretending that the stage completed.
 * A live worker refreshes updatedAt through the normal record command; only an
 * old in_progress claim is converted to a resumable deferred item.
 */
export function recoverStaleInProgress(
  state,
  { now = new Date().toISOString(), maxAgeMs = DEFAULT_STALE_IN_PROGRESS_MS } = {}
) {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs) || !Number.isFinite(maxAgeMs) || maxAgeMs <= 0) {
    throw new Error("recoverStaleInProgress requires a valid now and positive maxAgeMs");
  }
  let nextState = structuredClone(state);
  const recovered = [];
  for (const work of nextState.works ?? []) {
    const stageName = ENRICHMENT_STAGES.find((name) => work.stages?.[name]?.status === "in_progress");
    if (!stageName) continue;
    const current = work.stages[stageName];
    const updatedMs = Date.parse(current.updatedAt ?? work.updatedAt ?? "");
    if (!Number.isFinite(updatedMs) || nowMs - updatedMs < maxAgeMs) continue;
    const priorReason = cleanString(current.reason) ?? "未记录阶段结果";
    const nextReviewAt = new Date(nowMs + 60 * 60 * 1000).toISOString();
    const result = updateEnrichmentStage(nextState, { key: work.key }, {
      stage: stageName,
      status: "deferred",
      reason: `回收过期的 AI处理中认领；原记录：${priorReason}`,
      missingFields: current.missingFields,
      humanConfirmationReasons: current.humanConfirmationReasons,
      nextReviewAt,
      nextTrigger: "检查上一轮进程/网络结果；若没有新证据，按原阶段重新认领并记录结果"
    }, { now });
    nextState = result.state;
    recovered.push({ key: work.key, stage: stageName, nextReviewAt });
  }
  return { state: nextState, recovered };
}

export function resumeAuthorizedPeopleStage(
  state,
  selector,
  { preflight, reportPath, reason = "clean_people_preflight_authorized_by_current_objective", now = new Date().toISOString() } = {}
) {
  assertAuthorizedPersonPreflight(preflight, reportPath);
  const matches = selectEnrichmentWorks(state, selector);
  if (matches.length === 0) throw new Error("enrichment work item not found");
  if (matches.length > 1) {
    throw new Error(`enrichment work selector is ambiguous; use --item-key (${matches.map((candidate) => candidate.key).join(", ")})`);
  }
  const [work] = matches;
  if (currentEnrichmentStage(work) !== "people" || work.stages?.people?.status !== "waiting_user") {
    throw new Error("authorize-people requires the selected work to be waiting_user at the people stage");
  }
  return updateEnrichmentStage(state, selector, {
    stage: "people",
    status: "in_progress",
    reason,
    humanConfirmationReasons: []
  }, { now });
}

function findPeopleCoverageCandidate(coverage, work) {
  if (!coverage || (!Array.isArray(coverage.works) && !Array.isArray(coverage.candidates))) {
    throw new Error("people coverage report must contain a works or candidates array");
  }
  // Complete works are intentionally absent from candidates, so settlement
  // must prefer the authoritative all-works collection when it is available.
  const records = Array.isArray(coverage.works) ? coverage.works : coverage.candidates;
  const matches = records.filter((candidate) =>
    (work.externalWorkId && candidate.workId === work.externalWorkId)
    || (work.pageId && candidate.sourcePageId === work.pageId));
  if (matches.length === 0) throw new Error(`people coverage candidate not found for ${work.key}`);
  if (matches.length > 1) throw new Error(`people coverage candidate is ambiguous for ${work.key}`);
  return matches[0];
}

function coverageCount(value, name) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`people coverage ${name} must be a non-negative integer`);
  }
  return count;
}

export function settlePeopleStageFromCoverage(
  state,
  selector,
  coverage,
  { now = new Date().toISOString() } = {}
) {
  const matches = selectEnrichmentWorks(state, selector);
  if (matches.length === 0) throw new Error("enrichment work item not found");
  if (matches.length > 1) {
    throw new Error(`enrichment work selector is ambiguous; use --item-key (${matches.map((candidate) => candidate.key).join(", ")})`);
  }
  const [work] = matches;
  const candidate = findPeopleCoverageCandidate(coverage, work);
  const creditCount = coverageCount(candidate.creditCount, "creditCount");
  const linkedCreditCount = coverageCount(candidate.linkedCreditCount, "linkedCreditCount");
  const unlinkedCreditCount = coverageCount(candidate.unlinkedCreditCount, "unlinkedCreditCount");
  if (linkedCreditCount + unlinkedCreditCount !== creditCount) {
    throw new Error("people coverage counts are inconsistent");
  }
  if (candidate.status === "fully_linked" && creditCount > 0 && unlinkedCreditCount === 0) {
    return updateEnrichmentStage(state, selector, { stage: "people", status: "completed" }, { now });
  }
  const reason = creditCount === 0
    ? "Post-publish coverage has no canonical credits yet; keep People pending until a reliable credit source is available."
    : `Post-publish coverage is ${linkedCreditCount}/${creditCount} linked with ${unlinkedCreditCount} canonical credits remaining; continue the same work before advancing.`;
  const residuals = Array.isArray(candidate.unlinkedCredits)
    ? candidate.unlinkedCredits.map((credit) => ({
      name: cleanString(credit.name) ?? "unknown",
      department: cleanString(credit.department),
      job: cleanString(credit.job),
      character: cleanString(credit.character),
      externalIds: credit.externalIds && typeof credit.externalIds === "object"
        ? structuredClone(credit.externalIds)
        : {}
    }))
    : [];
  const residualSuffix = residuals.length > 0
    ? ` Residual credits are saved in coverageResiduals; next trigger: research these exact names with a stable identity and work-credit source, then rerun exact coverage.`
    : " Next trigger: rerun exact coverage and create a bounded targeted supplement from the residual list.";
  return updateEnrichmentStage(state, selector, {
    stage: "people",
    status: "pending",
    reason: `${reason}${residualSuffix}`,
    missingFields: [creditCount === 0 ? "canonical people credits" : `${unlinkedCreditCount} unlinked canonical credits`],
    humanConfirmationReasons: [],
    coverageResiduals: residuals,
    nextTrigger: residuals.length > 0
      ? "research coverageResiduals with stable identity and exact work-credit evidence, then rerun exact coverage"
      : "rerun exact coverage and create a bounded targeted supplement",
    nextReviewAt: null
  }, { now });
}

function selectEnrichmentWorks(state, selector) {
  if (selector.key) return state.works.filter((candidate) => candidate.key === selector.key);
  return state.works.filter((candidate) =>
    (selector.externalWorkId && candidate.externalWorkId === selector.externalWorkId)
    || (selector.pageId && candidate.pageId === selector.pageId)
    || (selector.ledgerWorkId && candidate.ledgerWorkId === Number(selector.ledgerWorkId)));
}

export function currentEnrichmentStage(work) {
  const active = ENRICHMENT_STAGES.find((name) => work.stages?.[name]?.status === "in_progress");
  if (active) return active;
  return ENRICHMENT_STAGES.find((name) => !TERMINAL_STAGE_STATUSES.has(work.stages?.[name]?.status ?? "pending")) ?? null;
}

function isDue(stageState, now) {
  // An in-progress stage is already owned by the current worker. Stale
  // claims are recovered separately by recoverStaleInProgress().
  if (["pending", "draft"].includes(stageState.status)) return true;
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
  const inProgress = works.filter((work) => work.currentStatus === "in_progress");
  const scheduledReviews = works.filter((work) => work.currentStatus === "deferred" && !work.actionableNow);
  const completed = works.filter((work) => work.currentStage === null);
  return {
    statePath: null,
    summary: {
      total: works.length,
      actionableNow: works.filter((work) => work.actionableNow).length,
      waitingForHuman: waitingForHuman.length,
      blocked: blocked.length,
      inProgress: inProgress.length,
      scheduledReview: scheduledReviews.length,
      completed: completed.length
    },
    due,
    waitingForHuman,
    blocked,
    inProgress,
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
