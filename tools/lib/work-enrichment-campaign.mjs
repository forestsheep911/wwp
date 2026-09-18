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
export const DEFAULT_TRANSIENT_RETRY_MS = 6 * 60 * 60 * 1000;

const TRANSIENT_PROVIDER_REASON = /(timeout|timed\s*out|429|rate.?limit|temporar(?:y|ily)\s+(?:unavailable|failure)|network|connection|api\s+(?:unavailable|error|failure)|notion.*(?:unavailable|error|timeout)|(?:不可用|暂时失败|超时|限流|网络错误|连接失败)|(?:notion|精确\s*Notion|exact\s*readback).*(?:readback|读回).*(?:missing|omitted|not expose|缺少|未返回)|(?:canonical|search|movie)\s*(?:index|索引).*(?:not found|missing|unavailable|failure|找不到|缺少|失败))/i;

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

export function isTransientEnrichmentFailure(reason) {
  return TRANSIENT_PROVIDER_REASON.test(String(reason ?? ""));
}

/**
 * Repair campaign rows written before transient provider failures had an
 * explicit deferred state. Stable identity and permission blockers are left
 * untouched; only a reason matching the transient provider classifier moves
 * to a scheduled retry.
 */
export function reclassifyTransientBlockedStages(
  state,
  { now = new Date().toISOString(), retryAfterMs = DEFAULT_TRANSIENT_RETRY_MS } = {}
) {
  const campaign = structuredClone(state);
  const nextReviewAt = new Date(Date.parse(now) + retryAfterMs).toISOString();
  const repaired = [];
  for (const work of campaign.works ?? []) {
    for (const stageName of ENRICHMENT_STAGES) {
      const current = work.stages?.[stageName];
      if (!current || current.status !== "blocked" || !isTransientEnrichmentFailure(current.reason)) continue;
      current.status = "deferred";
      current.reason = `历史临时供应商/API故障，已改为定时复核；原记录：${current.reason}`;
      current.nextReviewAt = nextReviewAt;
      current.nextTrigger = current.nextTrigger
        ?? "到达 nextReviewAt 后重试同一资料阶段，并重新读取外部服务状态";
      current.updatedAt = now;
      repaired.push({
        key: work.key,
        stage: stageName,
        nextReviewAt
      });
    }
    if (repaired.some((entry) => entry.key === work.key)) work.updatedAt = now;
  }
  if (repaired.length > 0) campaign.updatedAt = now;
  return { state: campaign, repaired, nextReviewAt };
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
    coverageAttempts: Number.isInteger(details.coverageAttempts) && details.coverageAttempts > 0 ? details.coverageAttempts : 0,
    coverageFingerprint: cleanString(details.coverageFingerprint),
    nextTrigger: cleanString(details.nextTrigger),
    updatedAt: cleanString(details.updatedAt)
  };
}

function coverageFingerprint(residuals) {
  return JSON.stringify((residuals ?? []).map((credit) => ({
    name: cleanString(credit.name) ?? "unknown",
    department: cleanString(credit.department),
    job: cleanString(credit.job),
    character: cleanString(credit.character),
    externalIds: Object.fromEntries(Object.entries(credit.externalIds ?? {})
      .filter(([, value]) => cleanString(value))
      .sort(([left], [right]) => left.localeCompare(right)))
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

function initialStages(input, now) {
  // Optional identity/editorial gaps must not hold the independent People
  // lane when the base metadata pass has no explicit missing fields.
  const metadataComplete = input.metadataStatus === "verified"
    || (input.metadataStatus === "partial" && uniqueStrings(input.metadataMissingFields).length === 0);
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
  const nextCoverageAttempts = update.coverageAttempts ?? previous.coverageAttempts;
  const nextCoverageFingerprint = update.coverageFingerprint ?? previous.coverageFingerprint;
  const nextTrigger = update.nextTrigger
    ?? previous.nextTrigger
    ?? defaultNextTrigger(update.stage, update.status);
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
        || current.status === "deferred"
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
    coverageAttempts: update.status === "completed" ? 0 : nextCoverageAttempts,
    coverageFingerprint: update.status === "completed" ? null : nextCoverageFingerprint,
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
  if (!canRunPeopleIndependently(work)) {
    throw new Error("authorize-people requires the selected work to be at the people stage");
  }
  return updateEnrichmentStage(state, selector, {
    stage: "people",
    status: "in_progress",
    reason,
    humanConfirmationReasons: []
  }, { now });
}

function canRunPeopleIndependently(work) {
  const people = work.stages?.people;
  if (!people || TERMINAL_STAGE_STATUSES.has(people.status) || people.status === "in_progress") return false;
  const peopleIndex = ENRICHMENT_STAGES.indexOf("people");
  return ENRICHMENT_STAGES.slice(0, peopleIndex).every((stageName) => {
    const status = work.stages?.[stageName]?.status ?? "pending";
    return ["blocked", "waiting_user", "deferred", "skipped", "completed"].includes(status);
  });
}

function findPeopleCoverageCandidate(coverage, work) {
  if (!coverage) {
    throw new Error("people coverage report must contain a works, targets, or candidates array");
  }
  // Targeted audits include a precise target record alongside the bounded
  // candidate list. Prefer it so an older or truncated candidate snapshot
  // cannot overwrite the exact post-publish coverage for this work.
  const recordSets = [
    Array.isArray(coverage.targets) ? coverage.targets : null,
    Array.isArray(coverage.works) ? coverage.works : null,
    Array.isArray(coverage.candidates) ? coverage.candidates : null
  ].filter(Boolean);
  if (recordSets.length === 0) {
    throw new Error("people coverage report must contain a works, targets, or candidates array");
  }
  for (const records of recordSets) {
    const matches = records.filter((candidate) =>
    (work.externalWorkId && candidate.workId === work.externalWorkId)
    || (work.pageId && candidate.sourcePageId === work.pageId));
    if (matches.length === 0) continue;
    if (matches.length > 1) throw new Error(`people coverage candidate is ambiguous for ${work.key}`);
    return matches[0];
  }
  throw new Error(`people coverage candidate not found for ${work.key}`);
}

function coverageCount(value, name) {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new Error(`people coverage ${name} must be a non-negative integer`);
  }
  return count;
}

function isCompositeCreditResidual(credit) {
  const name = cleanString(credit?.name) ?? "";
  const slashSeparatedNames = name.split(/\s*[\/／]\s*/u).filter(Boolean).length;
  const hasProviderListShape = slashSeparatedNames >= 3 || /(?:导演|编剧|主演)\s*[:：].*(?:\/|／)/u.test(name);
  const hasCombinedDepartmentShape = /(?:directing|writing|acting|导演|编剧|主演).*(?:,|，|;|；).*(?:directing|writing|acting|导演|编剧|主演)/iu.test(
    [credit?.department, credit?.job, name].filter(Boolean).join(" ")
  );
  return hasProviderListShape || hasCombinedDepartmentShape;
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
  const candidateResiduals = Array.isArray(candidate.unlinkedCredits) ? candidate.unlinkedCredits : null;
  const unlinkedCreditCount = coverageCount(
    candidate.unlinkedCreditCount ?? candidateResiduals?.length,
    "unlinkedCreditCount"
  );
  if (linkedCreditCount + unlinkedCreditCount !== creditCount) {
    throw new Error("people coverage counts are inconsistent");
  }
  // Exact post-publish coverage is authoritative even when older audit
  // producers omit the derived status field.
  const fullyLinkedByCounts = creditCount > 0
    && linkedCreditCount === creditCount
    && unlinkedCreditCount === 0;
  if ((candidate.status === "fully_linked" || fullyLinkedByCounts) && creditCount > 0 && unlinkedCreditCount === 0) {
    return updateEnrichmentStage(state, selector, { stage: "people", status: "completed" }, { now });
  }
  const reportedStatus = cleanString(candidate.status);
  const reportedReason = cleanString(candidate.reason ?? candidate.blockerReason ?? candidate.note);
  const reportedNextReviewAt = cleanString(candidate.nextReviewAt ?? candidate.next_review_at);
  const transientProviderFailure = reportedStatus === "blocked" && isTransientEnrichmentFailure(reportedReason);
  const previousPeople = work.stages.people ?? stage();
  // A zero-credit readback is usually an incomplete/stale canonical-index
  // snapshot, not evidence that the People stage is complete. Keep the item
  // recoverable, but do not put it straight back into every current cycle as
  // actionable work. A scheduled retry prevents a broken index from spinning
  // the same work indefinitely while preserving the exact missing field.
  const emptyCanonicalCoverage = creditCount === 0;
  const knownNonPersonResidual = previousPeople.status === "deferred"
    && /(?:非人物|动物演员|non[- ]?person|animal actor|Toto)/iu.test(
      [previousPeople.reason, reportedReason, candidate.nextTrigger, candidate.next_trigger].filter(Boolean).join(" ")
    );
  const stableStatus = transientProviderFailure
    ? "deferred"
    : emptyCanonicalCoverage
      ? "deferred"
      : knownNonPersonResidual
        ? "deferred"
      : ["blocked", "waiting_user", "deferred"].includes(reportedStatus)
        ? reportedStatus
        : "pending";
  const reason = creditCount === 0
    ? "Post-publish coverage has no canonical credits yet; defer People until a reliable credit source is available."
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
  const compositeResiduals = residuals.filter(isCompositeCreditResidual);
  const residualSuffix = residuals.length > 0
    ? ` Residual credits are saved in coverageResiduals; next trigger: research these exact names with a stable identity and work-credit source, then rerun exact coverage.`
    : " Next trigger: rerun exact coverage and create a bounded targeted supplement from the residual list.";
  const reportedTrigger = cleanString(candidate.nextTrigger ?? candidate.next_trigger);
  const nextTrigger = compositeResiduals.length > 0
    ? "normalize composite credit rows into one person/role per row with stable IDs, then rerun exact coverage"
    : reportedTrigger ?? (residuals.length > 0
    ? "research coverageResiduals with stable identity and exact work-credit evidence, then rerun exact coverage"
    : "rerun exact coverage and create a bounded targeted supplement");
  const residualFingerprint = coverageFingerprint(residuals);
  const sameResiduals = residualFingerprint && residualFingerprint === previousPeople.coverageFingerprint;
  const coverageAttempts = sameResiduals ? previousPeople.coverageAttempts + 1 : 1;
  const repeatedUnresolvedResidual = stableStatus === "pending"
    && !knownNonPersonResidual
    && residuals.length > 0
    && sameResiduals
    && coverageAttempts >= 2;
  return updateEnrichmentStage(state, selector, {
    stage: "people",
    status: repeatedUnresolvedResidual ? "blocked" : stableStatus,
    reason: repeatedUnresolvedResidual
      ? `同一批人物残项已连续 ${coverageAttempts} 次权威读回仍无法建立稳定身份；已暂停重复搜索。请等待新来源证据或人工确认：${residuals.map((credit) => credit.name).join("、")}`
      : transientProviderFailure
      ? `临时供应商/API故障，已安排自动复核；原记录：${reportedReason}`
      : emptyCanonicalCoverage
        ? (reportedReason ?? "精确人物覆盖读回暂未返回 canonical credits，暂不重复消耗当前轮次；到复核时间后重新读取来源并生成有界人物补强批次。")
      : compositeResiduals.length > 0
        ? `发现 ${compositeResiduals.length} 条复合人物字段，不能按单个人物补录；先规范化为逐人逐角色信用条目，再继续人物补强。${compositeResiduals.map((credit) => credit.name).join("、")}`
      : reportedReason ?? `${reason}${residualSuffix}`,
    missingFields: [creditCount === 0 ? "canonical people credits" : `${unlinkedCreditCount} unlinked canonical credits`],
    humanConfirmationReasons: Array.isArray(candidate.humanConfirmationReasons)
      ? candidate.humanConfirmationReasons
      : [],
    coverageResiduals: residuals,
    coverageAttempts,
    coverageFingerprint: residualFingerprint,
    nextTrigger: repeatedUnresolvedResidual
      ? "new provider evidence or manual identity confirmation"
      : nextTrigger,
    nextReviewAt: transientProviderFailure || emptyCanonicalCoverage
      ? (reportedNextReviewAt && !Number.isNaN(Date.parse(reportedNextReviewAt))
        ? reportedNextReviewAt
        : new Date(Date.parse(now) + DEFAULT_TRANSIENT_RETRY_MS).toISOString())
      : reportedNextReviewAt
  }, { now });
}

/**
 * Persist a provider/readback failure without leaving the work claimed as
 * active. This is intentionally separate from coverage settlement: a missing
 * or non-authoritative report is not evidence of completion, but it also is
 * not a durable identity blocker. The next bounded cycle can retry the exact
 * readback instead of re-running the whole enrichment batch.
 */
export function deferPeopleStageForCoverageFailure(
  state,
  selector,
  error,
  { now = new Date().toISOString(), retryAfterMs = DEFAULT_TRANSIENT_RETRY_MS } = {}
) {
  const message = cleanString(error?.message ?? error) ?? "authoritative People coverage readback failed";
  return updateEnrichmentStage(state, selector, {
    stage: "people",
    status: "deferred",
    reason: `权威人物覆盖读回失败，已安排定时复核；原错误：${message}`,
    missingFields: ["authoritative people coverage readback"],
    nextReviewAt: new Date(Date.parse(now) + retryAfterMs).toISOString(),
    nextTrigger: "重新生成 Azure 权威 coverage 报告；若仍失败，保留供应商错误并升级为明确的 provider blocker"
  }, { now });
}

export function assertAuthoritativePeopleCoverage(coverage, { allowLocal = false } = {}) {
  const backend = cleanString(coverage?.searchStore ?? coverage?.backend ?? coverage?.catalogBackend);
  if (allowLocal) return backend;
  if (!backend || !/^azure(?::|$)/iu.test(backend)) {
    throw new Error(
      "production People settlement requires an Azure coverage audit (searchStore=azure:*); use --allow-local-coverage only for an intentional local test"
    );
  }
  return backend;
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

function defaultNextTrigger(stageName, status) {
  if (status === "blocked") return `resolve the recorded ${stageName} blocker, then rerun the exact stage`;
  if (status === "waiting_user") return `await the requested human confirmation, then rerun the exact ${stageName} stage`;
  return null;
}

function publicWork(work, now) {
  const currentStage = currentEnrichmentStage(work);
  const current = currentStage ? work.stages[currentStage] : null;
  const hasCoverageResiduals = currentStage === "people"
    && Array.isArray(current?.coverageResiduals)
    && current.coverageResiduals.length > 0;
  const nextTrigger = current?.nextTrigger ?? defaultNextTrigger(currentStage, current?.status);
  return {
    key: work.key,
    ledgerWorkId: work.ledgerWorkId ?? null,
    externalWorkId: work.externalWorkId ?? null,
    pageId: work.pageId ?? null,
    title: work.title ?? null,
    sources: work.sources ?? [],
    currentStage,
    currentStatus: current?.status ?? "completed",
    nextAction: currentStage
      ? hasCoverageResiduals
        ? "run_wwp_people_targeted_supplement"
        : ACTION_BY_STAGE[currentStage]
      : "none",
    actionableNow: Boolean(current && isDue(current, now)),
    reason: current?.reason ?? null,
    missingFields: current?.missingFields ?? [],
    humanConfirmationReasons: current?.humanConfirmationReasons ?? [],
    coverageResiduals: current?.coverageResiduals ?? [],
    coverageAttempts: current?.coverageAttempts ?? 0,
    nextTrigger,
    nextReviewAt: current?.nextReviewAt ?? null,
    stages: work.stages
  };
}

export function buildEnrichmentCampaignReport(state, {
  limit = 3,
  now = new Date().toISOString(),
  prioritizeStage = null
} = {}) {
  const works = (state?.works ?? []).map((work) => publicWork(work, now));
  const dueCandidates = works.filter((work) => work.actionableNow);
  const due = (prioritizeStage
    ? dueCandidates.toSorted((left, right) =>
      Number(right.currentStage === prioritizeStage) - Number(left.currentStage === prioritizeStage)
    )
    : dueCandidates
  ).slice(0, limit);
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
