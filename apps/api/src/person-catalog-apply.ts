import type {
  MovieCreditEntry,
  MovieDataQuality,
  MovieExternalIds,
  PersonCatalogIssue,
  PersonCatalogState,
  PersonCreditRef,
  PersonExternalIds,
  PersonProfile,
  SearchResult
} from "@wwpdw/shared";
import { normalizePersonExternalIds, normalizePersonNameSearchKey } from "@wwpdw/shared";
import { mergePersonCatalogEntries, rebuildDerivedPersonIndexes } from "@wwpdw/cache-store";
import { assertVerifiedPersonProfileQuality, reviewPersonCoreProfile } from "./person-biography-quality.js";
import { withPersonQualityAssessment } from "./person-quality-score.js";

export interface ReviewedCreditReplacementGuard {
  mode: "replace-contaminated";
  reason: "cross-work-contamination";
  expectedAssetKey: string;
  expectedSourceCreditCount: number;
  expectedLinkedPersonIds: string[];
  preserveExistingPersonIds?: string[];
  expectedWorkExternalIds: Partial<MovieExternalIds>;
  authoritativeSource: "wikidata" | "imdb" | "tmdb";
  authoritativeSourceWorkId: string;
}

export interface ReviewedPeopleReport {
  generatedAt: string;
  proposedProfiles: PersonProfile[];
  /** Discovery profiles used only to match aliases on unmaterialized credits. */
  creditIdentityProfiles?: PersonProfile[];
  proposedCredits: Array<{
    workId: string;
    title: string;
    credits: MovieCreditEntry[];
    sourceWorkExternalIds?: Partial<MovieExternalIds>;
    creditReplacement?: ReviewedCreditReplacementGuard;
    metadataOnlyWork?: {
      mode: "metadata-only";
      sourcePageId: string;
      completeCreditSet: true;
    };
  }>;
  identityIssues: PersonCatalogIssue[];
  unresolved?: Array<{ workId?: string; creditName?: string; reason: string }>;
}

export interface PersonCatalogApplyPlan {
  nextCatalog: PersonCatalogState;
  originalResults: SearchResult[];
  updatedResults: SearchResult[];
  summary: {
    profileCount: number;
    affectedWorkCount: number;
    linkedCreditCount: number;
    unlinkedCreditCount: number;
    unresolvedCount: number;
    catalogChanged: boolean;
  };
}

export function planReviewedPeopleReportApply(
  currentCatalog: PersonCatalogState,
  searchResults: SearchResult[],
  report: ReviewedPeopleReport,
  generatedAt = new Date().toISOString(),
  options: { preferReviewedPersonIds?: boolean; reviewedNotionPageIds?: Record<string, string> } = {}
): PersonCatalogApplyPlan {
  if (report.identityIssues.length > 0) {
    throw new Error(`Reviewed report has ${report.identityIssues.length} unresolved identity issue(s).`);
  }
  const originalCatalog = structuredClone(currentCatalog);

  // Reuse an existing canonical profile when a reviewed report rediscovers the
  // same stable external identity. This is safe only for an unambiguous ID
  // match; conflicting matches remain an explicit error for human review.
  if (options.preferReviewedPersonIds) {
    currentCatalog = canonicalizeCatalogToReviewedProfiles(
      currentCatalog,
      report.proposedProfiles,
      options.reviewedNotionPageIds
    );
  } else {
    report = remapReviewedReportToExistingPeople(currentCatalog, report);
  }

  const nextCatalog = structuredClone(currentCatalog);
  const proposedIds = new Set(report.proposedProfiles.map((profile) => profile.personId));
  if (proposedIds.size !== report.proposedProfiles.length) throw new Error("Reviewed report contains duplicate personId profiles.");
  for (const profile of report.proposedProfiles) {
    assertStablePersonId(profile.personId);
    assertVerifiedPersonProfileQuality(profile);
    const currentEntry = nextCatalog.people[profile.personId];
    const mergedProfile = mergeReviewedProfileWithNotionOverlay(currentEntry?.profile, profile);
    nextCatalog.people[profile.personId] = {
      profile: mergedProfile,
      workIds: currentEntry?.workIds ?? [],
      updatedAt: mergedProfile.updatedAt
    };
  }

  assertNoDuplicateExternalIds(nextCatalog);
  const resultsByWorkId = new Map<string, SearchResult[]>();
  for (const result of searchResults) {
    const workId = result.metadata?.work?.workId;
    if (!workId) continue;
    resultsByWorkId.set(workId, [...(resultsByWorkId.get(workId) ?? []), result]);
  }

  const affectedWorkIds = new Set<string>();
  const workTitles: Record<string, string> = {};
  const originalResults: SearchResult[] = [];
  const updatedResults: SearchResult[] = [];
  let linkedCreditCount = 0;
  let unlinkedCreditCount = 0;
  for (const work of report.proposedCredits) {
    if (affectedWorkIds.has(work.workId)) throw new Error(`Reviewed report contains duplicate work: ${work.workId}`);
    affectedWorkIds.add(work.workId);
    const matches = resultsByWorkId.get(work.workId) ?? [];
    if (matches.length === 0 && work.metadataOnlyWork) {
      assertMetadataOnlyWorkGuard(work, report);
      const linked = work.credits.map((credit) => {
        if (!credit.personId) throw new Error(`Metadata-only credit ${credit.name} in ${work.workId} is not linked.`);
        assertStablePersonId(credit.personId);
        if (!nextCatalog.people[credit.personId]) {
          throw new Error(`Credit ${credit.name} in ${work.workId} references missing person ${credit.personId}.`);
        }
        return credit as MovieCreditEntry & { personId: string };
      });
      linkedCreditCount += linked.length;
      nextCatalog.creditsByWorkId[work.workId] = dedupeCredits(linked);
      workTitles[work.workId] = work.title;
      continue;
    }
    if (matches.length !== 1) throw new Error(`Expected exactly one search result for work ${work.workId}; found ${matches.length}.`);

    const original = matches[0];
    if (!original.metadata?.work) throw new Error(`Search result for ${work.workId} has no structured work metadata.`);
    assertSourceWorkIdentity(original, work.sourceWorkExternalIds);
    const sourceCredits = structuredClone(original.metadata.work.credits ?? original.metadata.credits ?? []);
    const mergedCreditsWithAliases = work.creditReplacement
      ? replaceContaminatedCredits(original, sourceCredits, work.credits, work.creditReplacement)
      : mergeReviewedCredits(
          sourceCredits,
          work.credits,
          report.proposedProfiles,
          [
            ...(report.creditIdentityProfiles ?? []),
            ...Object.values(nextCatalog.people).map((entry) => entry.profile)
          ]
        );
    const mergedCredits = dedupeLinkedCreditRows(mergedCreditsWithAliases, [
      ...(report.proposedProfiles ?? []),
      ...(report.creditIdentityProfiles ?? []),
      ...Object.values(nextCatalog.people).map((entry) => entry.profile)
    ]);
    const linked = mergedCredits.filter((credit): credit is MovieCreditEntry & { personId: string } => Boolean(credit.personId)).map((credit) => {
      assertStablePersonId(credit.personId);
      if (!nextCatalog.people[credit.personId]) {
        throw new Error(`Credit ${credit.name} in ${work.workId} references missing person ${credit.personId}.`);
      }
      return credit;
    });
    linkedCreditCount += linked.length;
    unlinkedCreditCount += mergedCredits.length - linked.length;
    nextCatalog.creditsByWorkId[work.workId] = dedupeCredits(linked);

    const updated = structuredClone(original);
    const originalMetadata = original.metadata;
    const originalWork = original.metadata.work;
    workTitles[work.workId] = originalWork.titles?.find((entry) => entry.kind === "primary")?.title ?? work.title;
    const workDataQuality = dataQualityAfterCreditRepair(
      originalWork.dataQuality,
      Boolean(Object.values(originalWork.externalIds ?? {}).some(Boolean)),
      generatedAt
    );
    const metadataDataQuality = dataQualityAfterCreditRepair(
      originalMetadata.dataQuality,
      Boolean(Object.values(originalMetadata.externalIds ?? originalWork.externalIds ?? {}).some(Boolean)),
      generatedAt
    );
    updated.metadata = {
      ...originalMetadata,
      credits: structuredClone(mergedCredits),
      ...(metadataDataQuality ? { dataQuality: metadataDataQuality } : {}),
      work: {
        ...originalWork,
        credits: structuredClone(mergedCredits),
        ...(workDataQuality ? { dataQuality: workDataQuality } : {}),
        updatedAt: generatedAt
      }
    };
    if (
      !sameJson(original.metadata.work.credits ?? [], mergedCredits)
      || !sameJson(original.metadata.credits ?? [], mergedCredits)
      || !sameJson(original.metadata.dataQuality, metadataDataQuality)
      || !sameJson(original.metadata.work.dataQuality, workDataQuality)
    ) {
      originalResults.push(structuredClone(original));
      updatedResults.push(updated);
    }
  }

  const retainedIssues = nextCatalog.issues.filter((issue) => !issue.workId || !affectedWorkIds.has(issue.workId));
  nextCatalog.issues = [
    ...retainedIssues,
    ...(report.unresolved ?? []).map((entry): PersonCatalogIssue => ({
      kind: "unresolved_credit",
      message: entry.reason,
      ...(entry.workId ? { workId: entry.workId } : {}),
      ...(entry.creditName ? { creditName: entry.creditName } : {})
    }))
  ];
  rebuildDerivedPersonIndexes(nextCatalog, workTitles);
  assertNoDuplicateExternalIds(nextCatalog);
  const catalogChanged = !sameJson(catalogComparable(originalCatalog), catalogComparable(nextCatalog));
  if (catalogChanged) {
    nextCatalog.generatedAt = generatedAt;
    nextCatalog.source = {
      kind: currentCatalog.source?.kind === "manual" ? "mixed" : (currentCatalog.source?.kind ?? "mixed"),
      workCount: Object.keys(nextCatalog.creditsByWorkId).length
    };
  } else {
    nextCatalog.generatedAt = currentCatalog.generatedAt;
    nextCatalog.source = structuredClone(currentCatalog.source);
  }

  return {
    nextCatalog,
    originalResults,
    updatedResults,
    summary: {
      profileCount: report.proposedProfiles.length,
      affectedWorkCount: affectedWorkIds.size,
      linkedCreditCount,
      unlinkedCreditCount,
      unresolvedCount: report.unresolved?.length ?? 0,
      catalogChanged
    }
  };
}

function dedupeLinkedCreditRows(credits: MovieCreditEntry[], profiles: PersonProfile[] = []) {
  const result: MovieCreditEntry[] = [];
  const linkedKeys = new Set<string>();
  const profilesByPersonId = new Map(profiles.map((profile) => [profile.personId, profile]));
  const linkedCredits = credits.filter((credit) => Boolean(credit.personId));
  for (const credit of credits) {
    if (!credit.personId) {
      const duplicateOfLinked = linkedCredits.some((linked) => (
        linked.personId
        && linked.department === credit.department
        && compatibleCreditJobs(linked, credit)
        && creditMatchesPersonAliases(credit, profilesByPersonId.get(linked.personId))
      ));
      if (duplicateOfLinked) continue;
      result.push(credit);
      continue;
    }
    const key = [
      credit.personId,
      credit.department,
      normalizePersonNameSearchKey(credit.job ?? ""),
      normalizePersonNameSearchKey(credit.character ?? "")
    ].join(":");
    if (linkedKeys.has(key)) continue;
    linkedKeys.add(key);
    result.push(credit);
  }
  return result;
}

function compatibleCreditJobs(left: MovieCreditEntry, right: MovieCreditEntry) {
  const leftJob = normalizePersonNameSearchKey(left.job ?? "");
  const rightJob = normalizePersonNameSearchKey(right.job ?? "");
  if (leftJob === rightJob) return true;
  const actingJobs = new Set(["actor", "voiceactor"]);
  return left.department === "acting" && actingJobs.has(leftJob) && actingJobs.has(rightJob);
}

function creditMatchesPersonAliases(credit: MovieCreditEntry, profile?: PersonProfile) {
  if (!profile) return false;
  const creditNames = [credit.name, credit.originalName].filter(Boolean)
    .map((value) => normalizePersonNameSearchKey(value!));
  const profileNames = (profile.names ?? []).map((entry) => normalizePersonNameSearchKey(entry.value));
  return creditNames.some((name) => name && profileNames.includes(name));
}

function assertMetadataOnlyWorkGuard(
  work: ReviewedPeopleReport["proposedCredits"][number],
  report: ReviewedPeopleReport
) {
  if (!/^wwm_[A-Za-z0-9_-]+$/.test(work.workId)) {
    throw new Error(`Metadata-only work requires a stable wwm_* work ID; received ${work.workId}.`);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(work.metadataOnlyWork!.sourcePageId)) {
    throw new Error(`Metadata-only work ${work.workId} requires an exact Notion source page ID.`);
  }
  if (!work.metadataOnlyWork!.completeCreditSet) {
    throw new Error(`Metadata-only work ${work.workId} requires a complete reviewed credit set.`);
  }
  if (!Object.values(work.sourceWorkExternalIds ?? {}).some((value) => typeof value === "string" && value.trim())) {
    throw new Error(`Metadata-only work ${work.workId} requires a stable external work identity.`);
  }
  if (work.credits.length === 0 || work.credits.some((credit) => !credit.personId)) {
    throw new Error(`Metadata-only work ${work.workId} requires a non-empty, fully linked credit set.`);
  }
  if ((report.unresolved ?? []).some((entry) => !entry.workId || entry.workId === work.workId)) {
    throw new Error(`Metadata-only work ${work.workId} still has unresolved credits.`);
  }
}

function assertSourceWorkIdentity(original: SearchResult, sourceIds: Partial<MovieExternalIds> | undefined) {
  if (!sourceIds) return;
  const canonicalIds = original.metadata?.work?.externalIds ?? original.metadata?.externalIds ?? {};
  for (const source of ["imdb", "tmdb", "douban"] as const) {
    const supplied = sourceIds[source];
    const canonical = canonicalIds[source];
    if (supplied && canonical && supplied !== canonical) {
      throw new Error(`Source work identity conflict for ${source}: expected ${canonical}, received ${supplied}.`);
    }
  }
}

function replaceContaminatedCredits(
  original: SearchResult,
  sourceCredits: MovieCreditEntry[],
  reviewedCredits: MovieCreditEntry[],
  guard: ReviewedCreditReplacementGuard
) {
  if (original.assetKey !== guard.expectedAssetKey) {
    throw new Error(`Credit replacement asset guard failed: expected ${guard.expectedAssetKey}, found ${original.assetKey}.`);
  }
  const actualExternalIds = original.metadata?.work?.externalIds ?? original.metadata?.externalIds ?? {};
  for (const [source, expected] of Object.entries(guard.expectedWorkExternalIds)) {
    if (expected && actualExternalIds[source as keyof MovieExternalIds] !== expected) {
      throw new Error(`Credit replacement work identity guard failed for ${source}.`);
    }
  }
  if (!guard.authoritativeSourceWorkId.trim() || reviewedCredits.length === 0) {
    throw new Error("Credit replacement requires a named source work and a non-empty authoritative credit set.");
  }
  const unsafeCredits = reviewedCredits.filter((credit) => (
    credit.source !== guard.authoritativeSource || !credit.externalIds?.[guard.authoritativeSource]
  ));
  if (unsafeCredits.length > 0) {
    throw new Error(`Credit replacement contains ${unsafeCredits.length} credit(s) without ${guard.authoritativeSource} identity evidence.`);
  }
  const replacement = structuredClone(reviewedCredits);
  const replacementPersonIds = new Set(replacement.map((credit) => credit.personId).filter(Boolean));
  for (const personId of guard.preserveExistingPersonIds ?? []) {
    if (replacementPersonIds.has(personId)) continue;
    const preserved = sourceCredits.filter((credit) => credit.personId === personId);
    if (preserved.length !== 1) {
      throw new Error(`Credit replacement preserve guard expected one source row for ${personId}; found ${preserved.length}.`);
    }
    replacement.push(structuredClone(preserved[0]));
    replacementPersonIds.add(personId);
  }
  if (sameJson(sourceCredits, replacement)) return replacement;
  if (sourceCredits.length !== guard.expectedSourceCreditCount) {
    throw new Error(`Credit replacement count guard failed: expected ${guard.expectedSourceCreditCount}, found ${sourceCredits.length}.`);
  }
  const actualLinkedPersonIds = [...new Set(sourceCredits.map((credit) => credit.personId).filter(Boolean) as string[])].sort();
  const expectedLinkedPersonIds = [...new Set(guard.expectedLinkedPersonIds)].sort();
  if (!sameJson(actualLinkedPersonIds, expectedLinkedPersonIds)) {
    throw new Error("Credit replacement linked-person guard failed.");
  }
  return replacement;
}

function dataQualityAfterCreditRepair(
  current: MovieDataQuality | undefined,
  hasExternalIds: boolean,
  updatedAt: string
) {
  if (!current?.missing?.includes("credits")) return current;
  const missing = current.missing.filter((field) => field !== "credits");
  return {
    ...current,
    status: current.status === "draft" && hasExternalIds ? "partial" : current.status,
    missing,
    updatedAt
  } satisfies MovieDataQuality;
}

export async function applyPersonCatalogPlan(input: {
  plan: PersonCatalogApplyPlan;
  searchStore: { upsertResults(results: SearchResult[], indexedAt?: string): Promise<unknown> };
  personStore: { replaceState(state: PersonCatalogState): Promise<void> };
  indexedAt?: string;
}) {
  if (input.plan.updatedResults.length === 0 && !input.plan.summary.catalogChanged) return;
  let searchWritten = false;
  try {
    if (input.plan.updatedResults.length > 0) {
      await input.searchStore.upsertResults(input.plan.updatedResults, input.indexedAt);
      searchWritten = true;
    }
    if (input.plan.summary.catalogChanged) await input.personStore.replaceState(input.plan.nextCatalog);
  } catch (error) {
    if (searchWritten) {
      try {
        await input.searchStore.upsertResults(input.plan.originalResults, input.indexedAt);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "People apply failed and search-index rollback also failed.");
      }
    }
    throw error;
  }
}

function mergeReviewedCredits(
  sourceCredits: MovieCreditEntry[],
  reviewedCredits: MovieCreditEntry[],
  reviewedProfiles: PersonProfile[] = [],
  creditIdentityProfiles: PersonProfile[] = []
): MovieCreditEntry[] {
  const merged = structuredClone(sourceCredits);
  const sourceCreditCount = merged.length;
  const consumed = new Set<number>();
  const identityProfiles = [...reviewedProfiles, ...creditIdentityProfiles];
  const profilesByPersonId = new Map(identityProfiles.map((profile) => [profile.personId, profile]));
  for (const reviewed of reviewedCredits) {
    const reviewedProfile = reviewed.personId
      ? profilesByPersonId.get(reviewed.personId)
      : findCreditIdentityProfile(reviewed, identityProfiles);
    const sourceIndex = bestCreditIdentityMatch(merged, sourceCreditCount, consumed, reviewed, reviewedProfile);
    if (!reviewed.personId) {
      if (sourceIndex < 0) merged.push(structuredClone(reviewed));
      continue;
    }
    if (sourceIndex < 0) {
      merged.push(structuredClone(reviewed));
      continue;
    }
    consumed.add(sourceIndex);
    merged[sourceIndex] = {
      ...merged[sourceIndex],
      name: reviewed.name,
      ...(reviewed.originalName ? { originalName: reviewed.originalName } : {}),
      ...(reviewed.externalIds ? { externalIds: reviewed.externalIds } : {}),
      personId: reviewed.personId
    };
  }
  return merged;
}

function bestCreditIdentityMatch(
  sourceCredits: MovieCreditEntry[],
  sourceCreditCount: number,
  consumed: Set<number>,
  reviewed: MovieCreditEntry,
  reviewedProfile?: PersonProfile
) {
  const candidates: Array<{ index: number; score: number; linked: boolean }> = [];
  for (let index = 0; index < sourceCreditCount; index += 1) {
    if (consumed.has(index)) continue;
    const source = sourceCredits[index];
    const identityScore = creditIdentityScore(source, reviewed, reviewedProfile);
    if (identityScore === 0) continue;
    candidates.push({ index, score: identityScore, linked: Boolean(source.personId) });
  }
  // When two canonical rows describe one person, prefer the still-unlinked
  // row even if the existing linked row carries stronger IDs. Otherwise an
  // alias repair merely rewrites the relation that was already in place.
  const eligible = reviewed.personId && candidates.some((candidate) => !candidate.linked)
    ? candidates.filter((candidate) => !candidate.linked)
    : candidates;
  eligible.sort((left, right) => right.score - left.score || left.index - right.index);
  return eligible[0]?.index ?? -1;
}

function findCreditIdentityProfile(credit: MovieCreditEntry, profiles: PersonProfile[]) {
  const creditIds = normalizePersonExternalIds(credit.externalIds);
  const matches = profiles.filter((profile) => hasSharedStableExternalId(
    creditIds,
    normalizePersonExternalIds(profile.externalIds)
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

function sameCreditIdentity(left: MovieCreditEntry, right: MovieCreditEntry, reviewedProfile?: PersonProfile) {
  return creditIdentityScore(left, right, reviewedProfile) > 0;
}

function creditIdentityScore(left: MovieCreditEntry, right: MovieCreditEntry, reviewedProfile?: PersonProfile) {
  const leftIds = normalizePersonExternalIds(left.externalIds);
  const rightIds = normalizePersonExternalIds(right.externalIds);
  for (const source of ["tmdb", "imdb", "wikidata"] as const) {
    if (leftIds[source] && rightIds[source] && leftIds[source] === rightIds[source]) return 3;
  }
  const leftNames = [left.name, left.originalName].filter(Boolean).map((value) => normalizePersonNameSearchKey(value!));
  const directRightNames = [
    right.name,
    right.originalName,
    ...((right as MovieCreditEntry & { legacyAliases?: string[] }).legacyAliases ?? [])
  ]
    .filter(Boolean)
    .map((value) => normalizePersonNameSearchKey(value!));
  const exactName = leftNames.some((name) => name && directRightNames.includes(name));
  const reviewedIds = normalizePersonExternalIds(reviewedProfile?.externalIds);
  const sourceHasConflictingId = Object.entries(leftIds).some(([source, value]) => (
    value && reviewedIds[source as keyof typeof reviewedIds] && value !== reviewedIds[source as keyof typeof reviewedIds]
  ));
  if (sourceHasConflictingId) return 0;
  const leftJob = normalizePersonNameSearchKey(left.job ?? "");
  const rightJob = normalizePersonNameSearchKey(right.job ?? "");
  const compatibleActingJobs = new Set(["actor", "voiceactor"]);
  const compatibleWritingJobs = new Set(["writer", "screenwriter"]);
  const sameJob = leftJob === rightJob
    || (left.department === "acting" && compatibleActingJobs.has(leftJob) && compatibleActingJobs.has(rightJob));
  const sameWritingDepartment = left.department === "writing"
    && compatibleWritingJobs.has(leftJob)
    && compatibleWritingJobs.has(rightJob);
  if (left.department !== right.department) return 0;
  // A reviewed stable ID plus an exact source name is stronger than a
  // provider-specific role description. This prevents `Actor` and
  // `Self - Narrator` from becoming duplicate rows for one person.
  if (exactName && Object.values(reviewedIds).some(Boolean)) return 2;
  if (!sameJob && !sameWritingDepartment) return 0;
  if (exactName) return 2;
  const profileNames = (reviewedProfile?.names ?? [])
    .map((entry) => normalizePersonNameSearchKey(entry.value));
  return leftNames.some((name) => name && profileNames.includes(name)) ? 1 : 0;
}

export function canonicalizeCatalogToReviewedProfiles(
  input: PersonCatalogState,
  profiles: PersonProfile[],
  reviewedNotionPageIds: Record<string, string> = {}
) {
  let state = structuredClone(input);
  for (const profile of profiles) {
    const normalizedIds = normalizePersonExternalIds(profile.externalIds);
    const owners = new Set(Object.entries(normalizedIds)
      .map(([provider, value]) => state.externalIdIndex[provider as keyof PersonExternalIds]?.[value])
      .filter((personId): personId is string => Boolean(personId && personId !== profile.personId)));
    if (owners.size > 1) {
      throw new Error(`Reviewed profile ${profile.personId} matches multiple existing people: ${[...owners].join(", ")}.`);
    }
    const retiredPersonId = [...owners][0];
    if (!retiredPersonId) continue;
    if (!state.people[profile.personId]) {
      state.people[profile.personId] = { profile: structuredClone(profile), workIds: [], updatedAt: profile.updatedAt };
    }
    state = mergePersonCatalogEntries(state, profile.personId, retiredPersonId);
  }
  for (const profile of profiles) {
    const notionPageId = reviewedNotionPageIds[profile.personId];
    if (!notionPageId) continue;
    const entry = state.people[profile.personId] ??= {
      profile: structuredClone(profile),
      workIds: [],
      updatedAt: profile.updatedAt
    };
    const existing = entry.profile.sourceRefs?.find((ref) => ref.source === "notion" && ref.id === notionPageId);
    entry.profile.sourceRefs = [
      ...(entry.profile.sourceRefs ?? []).filter((ref) => ref.source !== "notion"),
      existing ?? {
        source: "notion",
        id: notionPageId,
        observedAt: profile.updatedAt
      }
    ];
  }
  return state;
}

function remapReviewedReportToExistingPeople(
  currentCatalog: PersonCatalogState,
  report: ReviewedPeopleReport
): ReviewedPeopleReport {
  const remap = new Map<string, string>();
  for (const reviewed of report.proposedProfiles) {
    const reviewedIds = normalizePersonExternalIds(reviewed.externalIds);
    const matches = Object.values(currentCatalog.people)
      .filter((entry) => hasSharedStableExternalId(reviewedIds, normalizePersonExternalIds(entry.profile.externalIds)))
      .map((entry) => entry.profile.personId);
    const uniqueMatches = [...new Set(matches)];
    if (uniqueMatches.length > 1) {
      throw new Error(`Reviewed profile ${reviewed.personId} matches multiple existing person identities.`);
    }
    if (uniqueMatches.length === 1) remap.set(reviewed.personId, uniqueMatches[0]);
  }
  if (remap.size === 0) return report;

  const proposedProfiles = report.proposedProfiles.map((profile) => ({
    ...structuredClone(profile),
    personId: remap.get(profile.personId) ?? profile.personId
  }));
  const profileIds = new Set<string>();
  for (const profile of proposedProfiles) {
    if (profileIds.has(profile.personId)) {
      throw new Error(`Reviewed report contains duplicate canonical personId ${profile.personId}.`);
    }
    profileIds.add(profile.personId);
  }
  return {
    ...structuredClone(report),
    proposedProfiles,
    proposedCredits: report.proposedCredits.map((work) => ({
      ...structuredClone(work),
      credits: work.credits.map((credit) => ({
        ...structuredClone(credit),
        ...(credit.personId && remap.has(credit.personId) ? { personId: remap.get(credit.personId) } : {})
      }))
    }))
  };
}

function hasSharedStableExternalId(
  left: PersonExternalIds,
  right: PersonExternalIds
) {
  return (["tmdb", "imdb", "wikidata"] as const).some((source) => (
    Boolean(left[source]) && left[source] === right[source]
  ));
}

function dedupeCredits(credits: Array<MovieCreditEntry & { personId: string }>): PersonCreditRef[] {
  const values = new Map<string, PersonCreditRef>();
  for (const credit of credits) {
    const ref: PersonCreditRef = {
      personId: credit.personId,
      name: credit.name,
      department: credit.department,
      ...(credit.job ? { job: credit.job } : {}),
      ...(credit.character ? { character: credit.character } : {}),
      ...(credit.order !== undefined ? { order: credit.order } : {}),
      ...(credit.source ? { source: credit.source } : {})
    };
    const key = [ref.personId, ref.department, normalizePersonNameSearchKey(ref.job ?? ""), normalizePersonNameSearchKey(ref.character ?? "")].join(":");
    values.set(key, ref);
  }
  return [...values.values()].sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER));
}

function mergeReviewedProfileWithNotionOverlay(current: PersonProfile | undefined, reviewed: PersonProfile): PersonProfile {
  if (!current?.sourceRefs?.some((ref) => ref.source === "notion")) return structuredClone(reviewed);

  // Once a profile has a Notion overlay, the Notion sync owns the complete
  // biography object, including any supplemental source texts it retained.
  // Re-composing those texts from an older reviewed report makes replays
  // oscillate by dropping or re-adding same-language source descriptions.
  const biography = mergeReviewedBiography(current, reviewed);
  // Preserve the complete current collections as well. They may contain aliases,
  // images, or references added by a later Notion sync or enrichment pass that
  // were not present in the older reviewed report being replayed. A subsequent
  // targeted Notion sync applies any newly reviewed editorial fields.
  const names = mergeReviewedNames(current.names, reviewed.names);
  const profileImages = structuredClone(current.profileImages ?? []);
  const sourceRefs = structuredClone(current.sourceRefs);

  const merged: PersonProfile = {
    ...structuredClone(reviewed),
    names,
    departments: structuredClone(current.departments),
    ...(biography ? { biography } : {}),
    ...(profileImages.length || current.profileImages ? { profileImages } : {}),
    sourceRefs,
    ...(current.lockedFields ? { lockedFields: structuredClone(current.lockedFields) } : {}),
    ...(current.hiddenFromWebsite !== undefined ? { hiddenFromWebsite: current.hiddenFromWebsite } : {}),
    dataQuality: structuredClone(current.dataQuality),
    updatedAt: current.updatedAt
  };
  if (sameJson(names, current.names) && sameJson(biography, current.biography)) return merged;
  // Re-score only after merging eligible reviewed additions. This preserves
  // Notion-owned fields while allowing a biography repair to clear a stale
  // partial-quality flag.
  const quality = reviewPersonCoreProfile(merged);
  return withPersonQualityAssessment({
    ...merged,
    dataQuality: {
      ...merged.dataQuality,
      status: merged.dataQuality?.status === "conflict"
        ? "conflict"
        : quality.eligibleForVerified ? "verified" : "partial",
      ...(quality.issues.length ? { issues: quality.issues } : {}),
      updatedAt: current.dataQuality?.updatedAt ?? current.updatedAt
    }
  }, { reviewedAt: current.dataQuality?.reviewedAt ?? current.updatedAt });
}

function mergeReviewedBiography(current: PersonProfile, reviewed: PersonProfile) {
  const currentTexts = structuredClone(current.biography?.texts ?? []);
  if (!current.biography) return structuredClone(reviewed.biography);
  const locked = new Set(current.lockedFields ?? []);
  const languages = new Set(currentTexts
    .filter((text) => text.status === "verified")
    .map((text) => text.language));
  const additions = (reviewed.biography?.texts ?? []).filter((text) => (
    text.status === "verified"
    && !languages.has(text.language)
    && !locked.has(text.language === "zh-CN" ? "biographyZh" : "biographyEn")
  ));
  return {
    ...structuredClone(current.biography),
    texts: [...additions.map((text) => structuredClone(text)), ...currentTexts]
  };
}

function mergeReviewedNames(current: PersonProfile["names"], reviewed: PersonProfile["names"]) {
  const verifiedValues = new Set(current
    .filter((entry) => entry.status === "verified")
    .map((entry) => [normalizePersonNameSearchKey(entry.value), entry.language ?? "", entry.kind].join(":")));
  const allValues = new Set(current.map((entry) => [normalizePersonNameSearchKey(entry.value), entry.language ?? "", entry.kind, entry.source, entry.status].join(":")));
  const additions = reviewed.filter((entry) => {
    if (entry.status !== "verified" || entry.source !== "manual") return false;
    const identityKey = [normalizePersonNameSearchKey(entry.value), entry.language ?? "", entry.kind].join(":");
    const exactKey = [identityKey, entry.source, entry.status].join(":");
    if (verifiedValues.has(identityKey) || allValues.has(exactKey)) return false;
    allValues.add(exactKey);
    return true;
  });
  return [...additions.map((entry) => structuredClone(entry)), ...structuredClone(current)];
}

function uniqueNameEntries(values: PersonProfile["names"]): PersonProfile["names"] {
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = [normalizePersonNameSearchKey(entry.value), entry.language ?? "", entry.kind, entry.source, entry.status].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assertStablePersonId(personId: string) {
  if (!/^person_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(personId)) {
    throw new Error(`Invalid stable personId: ${personId}`);
  }
}

function assertNoDuplicateExternalIds(state: PersonCatalogState) {
  const seen = new Map<string, string>();
  for (const entry of Object.values(state.people)) {
    const ids = normalizePersonExternalIds(entry.profile.externalIds);
    for (const source of ["tmdb", "imdb", "wikidata"] as const) {
      const value = ids[source];
      if (!value) continue;
      const key = `${source}:${value}`;
      const previous = seen.get(key);
      if (previous && previous !== entry.profile.personId) {
        throw new Error(`Duplicate ${source} ID ${value} belongs to ${previous} and ${entry.profile.personId}.`);
      }
      seen.set(key, entry.profile.personId);
    }
  }
}

function catalogComparable(state: PersonCatalogState) {
  const value = structuredClone(state);
  value.generatedAt = "";
  delete value.source;
  return value;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
