import type {
  MovieCreditEntry,
  PersonCatalogIssue,
  PersonCatalogState,
  PersonCreditRef,
  PersonProfile,
  SearchResult
} from "@wwpdw/shared";
import { normalizePersonExternalIds, normalizePersonNameSearchKey } from "@wwpdw/shared";
import { rebuildDerivedPersonIndexes } from "@wwpdw/cache-store";

export interface ReviewedPeopleReport {
  generatedAt: string;
  proposedProfiles: PersonProfile[];
  proposedCredits: Array<{ workId: string; title: string; credits: MovieCreditEntry[] }>;
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
  generatedAt = new Date().toISOString()
): PersonCatalogApplyPlan {
  if (report.identityIssues.length > 0) {
    throw new Error(`Reviewed report has ${report.identityIssues.length} unresolved identity issue(s).`);
  }

  const nextCatalog = structuredClone(currentCatalog);
  const proposedIds = new Set(report.proposedProfiles.map((profile) => profile.personId));
  if (proposedIds.size !== report.proposedProfiles.length) throw new Error("Reviewed report contains duplicate personId profiles.");
  for (const profile of report.proposedProfiles) {
    assertStablePersonId(profile.personId);
    nextCatalog.people[profile.personId] = {
      profile: structuredClone(profile),
      workIds: nextCatalog.people[profile.personId]?.workIds ?? [],
      updatedAt: profile.updatedAt
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
    workTitles[work.workId] = work.title;
    const matches = resultsByWorkId.get(work.workId) ?? [];
    if (matches.length !== 1) throw new Error(`Expected exactly one search result for work ${work.workId}; found ${matches.length}.`);

    const linked = work.credits.filter((credit): credit is MovieCreditEntry & { personId: string } => Boolean(credit.personId)).map((credit) => {
      assertStablePersonId(credit.personId);
      if (!nextCatalog.people[credit.personId]) {
        throw new Error(`Credit ${credit.name} in ${work.workId} references missing person ${credit.personId}.`);
      }
      return credit;
    });
    linkedCreditCount += linked.length;
    unlinkedCreditCount += work.credits.length - linked.length;
    nextCatalog.creditsByWorkId[work.workId] = dedupeCredits(linked);

    const original = matches[0];
    if (!original.metadata?.work) throw new Error(`Search result for ${work.workId} has no structured work metadata.`);
    const updated = structuredClone(original);
    const originalMetadata = original.metadata;
    const originalWork = original.metadata.work;
    updated.metadata = {
      ...originalMetadata,
      credits: structuredClone(work.credits),
      work: { ...originalWork, credits: structuredClone(work.credits), updatedAt: generatedAt }
    };
    if (!sameJson(original.metadata.work.credits ?? [], work.credits) || !sameJson(original.metadata.credits ?? [], work.credits)) {
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
  const catalogChanged = !sameJson(catalogComparable(currentCatalog), catalogComparable(nextCatalog));
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
