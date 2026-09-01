import type { PersonBiographyText, PersonProfile } from "@wwpdw/shared";
import {
  biographyLooksLikeWorkflowCopy,
  reviewChineseBiography,
  reviewEnglishBiography
} from "./person-biography-quality.js";

export const PERSON_QUALITY_POLICY_VERSION = "people-quality-v1";

export interface PersonQualityAssessment {
  score: number;
  policyVersion: typeof PERSON_QUALITY_POLICY_VERSION;
  components: NonNullable<PersonProfile["dataQuality"]["scoreComponents"]>;
  reviewedAt?: string;
  nextReviewAt?: string;
  reviewDue: boolean;
}

const p0Patterns = [
  /identity.*conflict|conflict.*identity/iu,
  /external.*id.*conflict/iu,
  /duplicate.*person/iu,
  /non[_ -]?human/iu,
  /notion.*azure.*drift/iu,
  /missing.*catalog.*profile/iu,
  /broken.*reverse.*link/iu
];
const p1Patterns = [
  /wrong.*display.*name/iu,
  /traditional.*public.*name/iu,
  /known.*factual.*error/iu,
  /wrong.*work.*title/iu,
  /wrong.*identity.*biography/iu
];

export function assessPersonQuality(profile: PersonProfile, now = new Date()): PersonQualityAssessment {
  const zh = selectedBiography(profile, /^zh(?:-|$)/iu);
  const en = selectedBiography(profile, /^en(?:-|$)/iu);
  const zhReview = reviewChineseBiography({ text: zh?.value, method: zh?.method, sourceRefs: zh?.supportingSourceRefs });
  const enReview = reviewEnglishBiography({ text: en?.value, method: en?.method, sourceRefs: en?.supportingSourceRefs });
  const issues = profile.dataQuality.issues ?? [];
  const identityConflict = profile.dataQuality.status === "conflict"
    || profile.names.some((name) => name.status === "conflict")
    || issues.some((issue) => p0Patterns.some((pattern) => pattern.test(issue)));
  const publicCorrectnessIssue = issues.some((issue) => p1Patterns.some((pattern) => pattern.test(issue)));
  const stableIdentity = Object.values(profile.externalIds ?? {}).some((value) => Boolean(value?.trim()));

  const identity = (stableIdentity ? 15 : 0) + (!identityConflict ? 10 : 0);
  const namesAndDepartments =
    (hasVerifiedName(profile, /^zh(?:-|$)/iu) ? 5 : 0)
    + (hasVerifiedName(profile, /^en(?:-|$)/iu) ? 5 : 0)
    + ((profile.departments?.length ?? 0) > 0 ? 5 : 0);
  const sourceFamilies = new Set([...zhReview.independentSources, ...enReview.independentSources]);
  const generic = Boolean(zh?.value && biographyLooksLikeWorkflowCopy(zh.value, "Biography ZH"))
    || Boolean(en?.value && biographyLooksLikeWorkflowCopy(en.value, "Biography EN"));
  const biographyAndEvidence =
    (zhReview.eligibleForVerified && Boolean(zh?.value) ? 15 : 0)
    + (enReview.eligibleForVerified && Boolean(en?.value) ? 15 : 0)
    + (sourceFamilies.size >= 2 ? 10 : 0)
    + (!generic && Boolean(zh?.value || en?.value) ? 5 : 0);
  const optionalMetadata =
    ((profile.profileImages?.length ?? 0) > 0 ? 3 : 0)
    + (profile.biography?.birthDate ? 3 : 0)
    + (profile.biography?.birthPlace ? 3 : 0)
    + (profile.names.some((name) => name.kind === "original" && name.value.trim()) ? 3 : 0)
    + (profile.names.some((name) => ["alternate", "stage"].includes(name.kind) && name.value.trim()) ? 3 : 0);
  const components = { identity, namesAndDepartments, biographyAndEvidence, optionalMetadata };
  let score = Object.values(components).reduce((sum, value) => sum + value, 0);
  if (identityConflict) score = Math.min(score, 39);
  else if (publicCorrectnessIssue) score = Math.min(score, 69);
  else if (!zhReview.eligibleForVerified || !enReview.eligibleForVerified || !zh?.value || !en?.value) score = Math.min(score, 79);

  const reviewedAt = profile.dataQuality.reviewedAt ?? inferPersonReviewedAt(profile);
  const intervalMonths = reviewIntervalMonths(profile, score, identityConflict || publicCorrectnessIssue);
  const nextReviewAt = reviewedAt && intervalMonths > 0 ? addUtcMonths(reviewedAt, intervalMonths) : reviewedAt;
  const reviewDue = identityConflict || publicCorrectnessIssue || score < 80 || !reviewedAt
    || Boolean(nextReviewAt && Date.parse(nextReviewAt) <= now.getTime());

  return {
    score,
    policyVersion: PERSON_QUALITY_POLICY_VERSION,
    components,
    ...(reviewedAt ? { reviewedAt } : {}),
    ...(nextReviewAt ? { nextReviewAt } : {}),
    reviewDue
  };
}

export function withPersonQualityAssessment(
  profile: PersonProfile,
  options: { reviewedAt?: string; now?: Date } = {}
): PersonProfile {
  const input = options.reviewedAt
    ? { ...profile, dataQuality: { ...profile.dataQuality, reviewedAt: options.reviewedAt } }
    : profile;
  const assessment = assessPersonQuality(input, options.now);
  return {
    ...profile,
    dataQuality: {
      ...profile.dataQuality,
      score: assessment.score,
      scoreVersion: assessment.policyVersion,
      scoreComponents: assessment.components,
      ...(assessment.reviewedAt ? { reviewedAt: assessment.reviewedAt } : {})
    }
  };
}

export function inferPersonReviewedAt(profile: PersonProfile) {
  const zh = selectedBiography(profile, /^zh(?:-|$)/iu);
  const en = selectedBiography(profile, /^en(?:-|$)/iu);
  const zhEligible = reviewChineseBiography({ text: zh?.value, method: zh?.method, sourceRefs: zh?.supportingSourceRefs }).eligibleForVerified;
  const enEligible = reviewEnglishBiography({ text: en?.value, method: en?.method, sourceRefs: en?.supportingSourceRefs }).eligibleForVerified;
  if (!zh || !en || !zhEligible || !enEligible) return undefined;
  const times = [zh.observedAt, en.observedAt].map(Date.parse).filter(Number.isFinite);
  if (times.length !== 2) return undefined;
  return new Date(Math.min(...times)).toISOString();
}

function reviewIntervalMonths(profile: PersonProfile, score: number, urgent: boolean) {
  if (urgent || score < 80) return 0;
  if (profile.biography?.deathDate) return 60;
  return score >= 90 ? 24 : 12;
}

function addUtcMonths(value: string, months: number) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

function hasVerifiedName(profile: PersonProfile, language: RegExp) {
  return profile.names.some((name) => language.test(name.language ?? "") && name.status === "verified" && name.value.trim());
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
