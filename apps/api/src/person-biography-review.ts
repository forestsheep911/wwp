import type { PersonEnrichmentReport } from "./person-enrichment.js";
import type { PersonNameEntry, PersonProfile } from "@wwpdw/shared";
import { normalizePersonNameSearchKey } from "@wwpdw/shared";
import { reviewChineseBiography, reviewEnglishBiography, reviewPersonCoreProfile } from "./person-biography-quality.js";

export interface ReviewedChineseBiography {
  personId: string;
  chineseName: string;
  englishName?: string;
  originalName?: string;
  biographyZh: string;
  biographyEn?: string;
  sourceRefs: string[];
}

export interface BiographyReviewPackage {
  biographies: ReviewedChineseBiography[];
  creditNameOverrides?: Record<string, string>;
}

export function applyReviewedChineseBiographies<T extends Pick<PersonEnrichmentReport, "proposedProfiles">>(
  report: T,
  reviews: ReviewedChineseBiography[],
  observedAt = new Date().toISOString()
): T {
  const reviewByPersonId = new Map(reviews.map((review) => [review.personId, review]));
  if (reviewByPersonId.size !== reviews.length) throw new Error("Biography review contains duplicate personId entries.");
  const profileIds = new Set(report.proposedProfiles.map((profile) => profile.personId));
  for (const review of reviews) {
    if (!profileIds.has(review.personId)) throw new Error(`Biography review references unknown person ${review.personId}.`);
    const result = reviewChineseBiography({
      text: review.biographyZh,
      method: "editorial-rewrite",
      sourceRefs: review.sourceRefs
    });
    if (!result.eligibleForVerified) throw new Error(`${review.personId}: ${result.issues.join(" ")}`);
    const englishResult = reviewEnglishBiography({
      text: review.biographyEn,
      method: "editorial-rewrite",
      sourceRefs: review.sourceRefs
    });
    if (!englishResult.eligibleForVerified) throw new Error(`${review.personId}: ${englishResult.issues.join(" ")}`);
  }
  return {
    ...report,
    proposedProfiles: report.proposedProfiles.map((profile) => {
      const review = reviewByPersonId.get(profile.personId);
      return review ? applyReview(profile, review, observedAt) : profile;
    })
  };
}

export function applyReviewedCreditNames<T extends Pick<PersonEnrichmentReport, "proposedCredits">>(
  report: T,
  reviews: ReviewedChineseBiography[],
  externalOverrides: Record<string, string> = {}
): T {
  const canonicalByPersonId = new Map(reviews.map((review) => [review.personId, review.chineseName.trim()]));
  return {
    ...report,
    proposedCredits: report.proposedCredits.map((work) => ({
      ...work,
      credits: work.credits.map((credit) => {
        const canonicalName = credit.personId ? canonicalByPersonId.get(credit.personId) : undefined;
        const overrideName = credit.externalIds?.wikidata ? externalOverrides[credit.externalIds.wikidata] : undefined;
        return canonicalName || overrideName ? { ...credit, name: canonicalName ?? overrideName! } : credit;
      })
    }))
  };
}

function applyReview(profile: PersonProfile, review: ReviewedChineseBiography, observedAt: string): PersonProfile {
  const names = [
    manualName(review.chineseName, "zh-CN", "display", observedAt),
    ...(review.englishName ? [manualName(review.englishName, "en", "display", observedAt)] : []),
    ...(review.originalName ? [manualName(review.originalName, undefined, "original", observedAt)] : []),
    ...profile.names
  ];
  const reviewed: PersonProfile = {
    ...profile,
    names: uniqueNames(names),
    biography: {
      ...profile.biography,
      texts: [
        {
          value: review.biographyZh.trim(),
          language: "zh-CN",
          source: "manual",
          status: "verified",
          method: "editorial-rewrite",
          supportingSourceRefs: review.sourceRefs,
          observedAt
        },
        ...(review.biographyEn ? [{
          value: review.biographyEn.trim(),
          language: "en",
          source: "manual" as const,
          status: "verified" as const,
          method: "editorial-rewrite" as const,
          supportingSourceRefs: review.sourceRefs,
          observedAt
        }] : []),
        ...(profile.biography?.texts ?? [])
      ]
    },
    sourceRefs: [
      ...(profile.sourceRefs ?? []),
      ...review.sourceRefs.map((url) => ({ source: "external" as const, url, observedAt }))
    ],
    dataQuality: {
      ...profile.dataQuality,
      updatedAt: observedAt
    },
    updatedAt: observedAt
  };
  const coreReview = reviewPersonCoreProfile(reviewed);
  return {
    ...reviewed,
    dataQuality: {
      status: profile.dataQuality.status === "conflict"
        ? "conflict"
        : coreReview.eligibleForVerified ? "verified" : "partial",
      ...(coreReview.issues.length ? { issues: coreReview.issues } : {}),
      updatedAt: observedAt
    }
  };
}

function manualName(value: string, language: string | undefined, kind: PersonNameEntry["kind"], observedAt: string): PersonNameEntry {
  return { value: value.trim(), ...(language ? { language } : {}), kind, source: "manual", status: "verified", observedAt };
}

function uniqueNames(values: PersonNameEntry[]) {
  const seen = new Set<string>();
  return values.flatMap((entry) => {
    const value = entry.value.trim().replace(/[，,]+$/u, "").trim();
    const key = `${normalizePersonNameSearchKey(value)}:${entry.language ?? ""}:${entry.kind}:${entry.source}:${entry.status}`;
    if (!normalizePersonNameSearchKey(value) || seen.has(key)) return [];
    seen.add(key);
    return [{ ...entry, value }];
  });
}
