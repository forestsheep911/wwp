import OpenCC from "opencc-js";
import type {
  MovieCreditDepartment,
  PersonBiographyText,
  PersonCatalogIssue,
  PersonCatalogState,
  PersonProfile
} from "@wwpdw/shared";
import {
  biographyHasSubstantiveLength,
  biographyLooksLikeWorkflowCopy,
  reviewChineseBiography,
  reviewEnglishBiography,
  reviewPersonCoreProfile
} from "./person-biography-quality.js";
import { assessPersonQuality, PERSON_QUALITY_POLICY_VERSION } from "./person-quality-score.js";

export type PeopleRepairPriority = "P0" | "P1" | "P2" | "P3";

export interface PeopleRepairCandidate {
  personId: string;
  displayName: string;
  priority: PeopleRepairPriority;
  score: number;
  reasons: string[];
  linkedWorkCount: number;
  departments: MovieCreditDepartment[];
  stableIdentity: boolean;
  qualityScore: number;
  qualityPolicyVersion: string;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  reviewDue: boolean;
  status: "queued" | "observed";
}

export interface PeopleRepairAuditReport {
  totalPeople: number;
  summary: Record<PeopleRepairPriority, number>;
  actionableCount: number;
  optionalObservationCount: number;
  candidates: PeopleRepairCandidate[];
  queue: PeopleRepairCandidate[];
}

const coreCreatorDepartments = new Set<MovieCreditDepartment>([
  "directing",
  "writing",
  "production",
  "camera",
  "editing",
  "music"
]);
const traditionalToSimplified = OpenCC.Converter({ from: "t", to: "cn" });

const reasonPriority = new Map<string, PeopleRepairPriority>([
  ["identity_conflict", "P0"],
  ["external_id_conflict", "P0"],
  ["duplicate_person_binding", "P0"],
  ["non_human_identity", "P0"],
  ["notion_azure_drift", "P0"],
  ["notion_row_invalid", "P0"],
  ["missing_catalog_profile", "P0"],
  ["broken_reverse_link", "P0"],
  ["wrong_display_name", "P1"],
  ["traditional_public_name", "P1"],
  ["known_factual_error", "P1"],
  ["wrong_work_title", "P1"],
  ["wrong_identity_biography", "P1"],
  ["generic_biography", "P2"],
  ["short_zh_biography", "P2"],
  ["short_en_biography", "P2"],
  ["single_source_biography", "P2"],
  ["missing_stable_external_id", "P2"],
  ["missing_verified_zh_name", "P2"],
  ["missing_verified_en_name", "P2"],
  ["missing_verified_department", "P2"],
  ["missing_verified_zh_biography", "P2"],
  ["missing_verified_en_biography", "P2"],
  ["biography_verification_incomplete", "P2"],
  ["quality_score_below_80", "P2"],
  ["review_stale", "P2"],
  ["missing_portrait", "P3"],
  ["missing_birth_date", "P3"],
  ["missing_birth_place", "P3"],
  ["missing_original_name", "P3"],
  ["missing_alias", "P3"]
]);

export function auditPeopleRepairCandidates(
  state: PersonCatalogState,
  candidateLimit = 100
): PeopleRepairAuditReport {
  const candidates: PeopleRepairCandidate[] = [];
  const catalogReasons = catalogIssueReasons(state.issues);

  for (const [personId, entry] of Object.entries(state.people)) {
    const profile = entry.profile;
    const reasons = new Set(catalogReasons.get(personId) ?? []);
    if (profile.dataQuality.status === "conflict") reasons.add("identity_conflict");
    addRecordedQualityReasons(reasons, profile.dataQuality.issues ?? []);
    addCoreQualityReasons(reasons, profile);
    addBiographyReasons(reasons, profile);
    addPublicNameReasons(reasons, profile);

    const linkedCredits = state.creditsByPersonId[personId] ?? [];
    const linkedWorkCount = new Set([...entry.workIds, ...linkedCredits.map((credit) => credit.workId)]).size;
    const departments = uniqueDepartments([
      ...(profile.departments ?? []),
      ...linkedCredits.map((credit) => credit.department)
    ]);
    const stableIdentity = hasStableIdentity(profile);
    const quality = assessPersonQuality(profile);

    if (quality.score < 80) reasons.add("quality_score_below_80");
    else if (quality.reviewDue) reasons.add("review_stale");

    if (![...reasons].some((reason) => reasonPriority.get(reason) !== "P3")) {
      addOptionalReasons(reasons, profile);
    }
    if (reasons.size === 0) continue;

    candidates.push(toCandidate({
      personId,
      displayName: displayName(profile),
      reasons: [...reasons],
      linkedWorkCount,
      departments,
      stableIdentity,
      quality
    }));
  }

  for (const orphan of orphanedLinkedPeople(state)) {
    if (state.people[orphan.personId]) continue;
    candidates.push(toCandidate({
      ...orphan,
      reasons: ["missing_catalog_profile"],
      stableIdentity: false,
      quality: {
        score: 0,
        policyVersion: PERSON_QUALITY_POLICY_VERSION,
        components: { identity: 0, namesAndDepartments: 0, biographyAndEvidence: 0, optionalMetadata: 0 },
        reviewDue: true
      }
    }));
  }

  candidates.sort(compareCandidates);
  const summary: Record<PeopleRepairPriority, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const candidate of candidates) summary[candidate.priority] += 1;
  const actionable = candidates.filter((candidate) => candidate.priority !== "P3");

  return {
    totalPeople: Object.keys(state.people).length,
    summary,
    actionableCount: actionable.length,
    optionalObservationCount: summary.P3,
    candidates,
    queue: actionable.slice(0, Math.max(0, candidateLimit))
  };
}

function addCoreQualityReasons(reasons: Set<string>, profile: PersonProfile) {
  const mapping: Record<string, string> = {
    missing_stable_external_id: "missing_stable_external_id",
    missing_verified_chinese_name: "missing_verified_zh_name",
    missing_verified_english_name: "missing_verified_en_name",
    missing_verified_department: "missing_verified_department",
    missing_verified_chinese_biography: "missing_verified_zh_biography",
    missing_verified_english_biography: "missing_verified_en_biography"
  };
  for (const issue of reviewPersonCoreProfile(profile).issues) reasons.add(mapping[issue] ?? issue);
}

function addBiographyReasons(reasons: Set<string>, profile: PersonProfile) {
  const zh = selectedBiography(profile, /^zh(?:-|$)/iu);
  const en = selectedBiography(profile, /^en(?:-|$)/iu);
  if (zh) {
    const review = reviewChineseBiography({ text: zh.value, method: zh.method, sourceRefs: zh.supportingSourceRefs });
    if (!biographyHasSubstantiveLength(zh.value, "Biography ZH")) reasons.add("short_zh_biography");
    if (biographyLooksLikeWorkflowCopy(zh.value, "Biography ZH")) reasons.add("generic_biography");
    if (review.independentSources.length < 2) reasons.add("single_source_biography");
  }
  if (en) {
    const review = reviewEnglishBiography({ text: en.value, method: en.method, sourceRefs: en.supportingSourceRefs });
    if (!biographyHasSubstantiveLength(en.value, "Biography EN")) reasons.add("short_en_biography");
    if (biographyLooksLikeWorkflowCopy(en.value, "Biography EN")) reasons.add("generic_biography");
    if (review.independentSources.length < 2) reasons.add("single_source_biography");
  }
}

function addPublicNameReasons(reasons: Set<string>, profile: PersonProfile) {
  const chinese = profile.names
    .filter((name) => /^zh(?:-|$)/iu.test(name.language ?? "") && name.status === "verified")
    .sort((left, right) => Number(right.kind === "display") - Number(left.kind === "display"))[0]?.value.trim();
  if (chinese && traditionalToSimplified(chinese) !== chinese) reasons.add("traditional_public_name");
}

function addOptionalReasons(reasons: Set<string>, profile: PersonProfile) {
  if (!(profile.profileImages?.length)) reasons.add("missing_portrait");
  if (!profile.biography?.birthDate) reasons.add("missing_birth_date");
  if (!profile.biography?.birthPlace) reasons.add("missing_birth_place");
  if (!profile.names.some((name) => name.kind === "original" && name.value.trim())) reasons.add("missing_original_name");
  if (!profile.names.some((name) => ["alternate", "stage"].includes(name.kind) && name.value.trim())) reasons.add("missing_alias");
}

function addRecordedQualityReasons(reasons: Set<string>, issues: string[]) {
  for (const raw of issues) {
    const issue = raw.trim().toLowerCase().replace(/[\s-]+/gu, "_");
    if (reasonPriority.has(issue)) reasons.add(issue);
    else if (issue.includes("external_id") && issue.includes("conflict")) reasons.add("external_id_conflict");
    else if (issue.includes("identity") && issue.includes("conflict")) reasons.add("identity_conflict");
    else if (issue.includes("notion") && issue.includes("drift")) reasons.add("notion_azure_drift");
    else if (issue.includes("wrong") && issue.includes("name")) reasons.add("wrong_display_name");
    else if (issue.includes("factual") && issue.includes("error")) reasons.add("known_factual_error");
  }
}

function catalogIssueReasons(issues: PersonCatalogIssue[]) {
  const result = new Map<string, Set<string>>();
  for (const issue of issues) {
    const reason = issue.kind === "external_id_conflict" ? "external_id_conflict"
      : issue.kind === "redirect_conflict" || issue.kind === "notion_identity_conflict" ? "identity_conflict"
        : issue.kind === "notion_row_invalid" ? "notion_row_invalid"
          : issue.kind === "biography_verification_incomplete" ? "biography_verification_incomplete"
            : undefined;
    if (!reason) continue;
    for (const personId of issue.personIds ?? []) {
      const reasons = result.get(personId) ?? new Set<string>();
      reasons.add(reason);
      result.set(personId, reasons);
    }
  }
  return result;
}

function orphanedLinkedPeople(state: PersonCatalogState) {
  const byPerson = new Map<string, { personId: string; displayName: string; linkedWorkIds: Set<string>; departments: Set<MovieCreditDepartment> }>();
  for (const [workId, credits] of Object.entries(state.creditsByWorkId)) {
    for (const credit of credits) {
      if (!credit.personId || state.people[credit.personId]) continue;
      const current = byPerson.get(credit.personId) ?? {
        personId: credit.personId,
        displayName: credit.name,
        linkedWorkIds: new Set<string>(),
        departments: new Set<MovieCreditDepartment>()
      };
      current.linkedWorkIds.add(workId);
      current.departments.add(credit.department);
      byPerson.set(credit.personId, current);
    }
  }
  return [...byPerson.values()].map((entry) => ({
    personId: entry.personId,
    displayName: entry.displayName,
    linkedWorkCount: entry.linkedWorkIds.size,
    departments: [...entry.departments].sort()
  }));
}

function selectedBiography(profile: PersonProfile, language: RegExp) {
  return (profile.biography?.texts ?? [])
    .filter((entry) => language.test(entry.language) && entry.value.trim())
    .sort((left, right) => biographyRank(right) - biographyRank(left))[0];
}

function biographyRank(entry: PersonBiographyText) {
  const status = entry.status === "verified" ? 30 : entry.status === "strong" ? 20 : entry.status === "provisional" ? 10 : 0;
  return status + (entry.method === "editorial-rewrite" ? 3 : 0);
}

function displayName(profile: PersonProfile) {
  const rank = (language: RegExp, verifiedOnly: boolean) => profile.names
    .filter((name) => language.test(name.language ?? "") && (!verifiedOnly || name.status === "verified") && name.value.trim())
    .sort((left, right) => Number(right.kind === "display") - Number(left.kind === "display"))[0]?.value.trim();
  return rank(/^zh(?:-|$)/iu, true)
    ?? rank(/^zh(?:-|$)/iu, false)
    ?? rank(/^en(?:-|$)/iu, true)
    ?? rank(/^en(?:-|$)/iu, false)
    ?? profile.names.find((name) => name.value.trim())?.value.trim()
    ?? "未命名人物";
}

function hasStableIdentity(profile: PersonProfile) {
  return Object.values(profile.externalIds ?? {}).some((value) => Boolean(value?.trim()));
}

function uniqueDepartments(values: MovieCreditDepartment[]) {
  return [...new Set(values)].sort();
}

function toCandidate(input: {
  personId: string;
  displayName: string;
  reasons: string[];
  linkedWorkCount: number;
  departments: MovieCreditDepartment[];
  stableIdentity: boolean;
  quality: ReturnType<typeof assessPersonQuality>;
}): PeopleRepairCandidate {
  const reasons = [...new Set(input.reasons)].sort();
  const priority = highestPriority(reasons);
  const base = priority === "P0" ? 1000 : priority === "P1" ? 500 : priority === "P2" ? 200 : 0;
  const score = base
    + Math.min(input.linkedWorkCount, 10) * 10
    + (input.departments.some((department) => coreCreatorDepartments.has(department)) ? 20 : 0)
    + (input.stableIdentity ? 10 : 0)
    + Math.max(0, 100 - input.quality.score)
    + (input.quality.reviewDue ? 30 : 0);
  return {
    personId: input.personId,
    displayName: input.displayName,
    linkedWorkCount: input.linkedWorkCount,
    departments: input.departments,
    stableIdentity: input.stableIdentity,
    qualityScore: input.quality.score,
    qualityPolicyVersion: input.quality.policyVersion,
    ...(input.quality.reviewedAt ? { lastReviewedAt: input.quality.reviewedAt } : {}),
    ...(input.quality.nextReviewAt ? { nextReviewAt: input.quality.nextReviewAt } : {}),
    reviewDue: input.quality.reviewDue,
    reasons,
    priority,
    score,
    status: priority === "P3" ? "observed" : "queued"
  };
}

function highestPriority(reasons: string[]): PeopleRepairPriority {
  const rank: Record<PeopleRepairPriority, number> = { P0: 4, P1: 3, P2: 2, P3: 1 };
  return reasons.reduce<PeopleRepairPriority>((current, reason) => {
    const candidate = reasonPriority.get(reason) ?? "P2";
    return rank[candidate] > rank[current] ? candidate : current;
  }, "P3");
}

function compareCandidates(left: PeopleRepairCandidate, right: PeopleRepairCandidate) {
  return right.score - left.score
    || right.linkedWorkCount - left.linkedWorkCount
    || left.personId.localeCompare(right.personId, "en");
}
