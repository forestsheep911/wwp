import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  MovieCreditEntry,
  MovieWorkProfile,
  PersonCatalogEntry,
  PersonCatalogIssue,
  PersonCatalogState,
  PersonCreditRef,
  PersonExternalIds,
  PersonNameEntry,
  PersonProfile,
  PersonWorkCreditRef
} from "@wwpdw/shared";
import {
  normalizePersonExternalIds,
  normalizePersonNameSearchKey
} from "@wwpdw/shared";

export interface PersonCatalogBuildOptions {
  generatedAt?: string;
  sourceKind?: NonNullable<PersonCatalogState["source"]>["kind"];
}

export interface PersonCatalogBuildSummary {
  workCount: number;
  personCount: number;
  linkedCreditCount: number;
  unresolvedCreditCount: number;
  issueCount: number;
}

export interface PersonCatalogStore {
  readonly description: string;
  getState(): Promise<PersonCatalogState>;
  replaceState(state: PersonCatalogState): Promise<void>;
}

export class LocalPersonCatalogStore implements PersonCatalogStore {
  readonly description: string;

  constructor(private readonly statePath: string) {
    this.description = `local:${statePath}`;
  }

  async getState() {
    try {
      const raw = await readFile(this.statePath, "utf8");
      const state = JSON.parse(raw) as Partial<PersonCatalogState>;
      if (state.schemaVersion !== 1) {
        throw new Error(`Unsupported person catalog schema version: ${String(state.schemaVersion)}`);
      }
      return state as PersonCatalogState;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return emptyPersonCatalogState();
      throw error;
    }
  }

  async replaceState(state: PersonCatalogState) {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
  }
}

export function emptyPersonCatalogState(generatedAt = new Date().toISOString()): PersonCatalogState {
  return {
    schemaVersion: 1,
    generatedAt,
    people: {},
    redirects: {},
    externalIdIndex: { tmdb: {}, imdb: {}, wikidata: {} },
    aliasIndex: {},
    creditsByWorkId: {},
    creditsByPersonId: {},
    issues: []
  };
}

export function buildPersonCatalogFromWorks(
  works: MovieWorkProfile[],
  profiles: PersonProfile[] = [],
  options: PersonCatalogBuildOptions = {}
) {
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const state: PersonCatalogState = {
    ...emptyPersonCatalogState(generatedAt),
    source: { kind: options.sourceKind ?? "movie-catalog", workCount: works.length }
  };

  for (const profile of profiles) {
    state.people[profile.personId] = catalogEntry(profile);
  }

  for (const work of works) {
    const credits = new Map<string, PersonCreditRef>();
    for (const credit of work.credits ?? []) {
      if (!credit.personId) {
        state.issues.push(unresolvedCreditIssue(work, credit));
        continue;
      }

      const linkedCredit = { ...credit, personId: credit.personId };

      const entry = state.people[credit.personId] ?? catalogEntry(profileFromCredit(linkedCredit, work.updatedAt));
      recordCreditExternalIdConflicts(state, entry.profile, linkedCredit.externalIds, work.workId);
      addCreditName(entry.profile, linkedCredit, work.updatedAt);
      entry.workIds = uniqueSorted([...entry.workIds, work.workId]);
      entry.updatedAt = latestIso(entry.updatedAt, work.updatedAt);
      entry.profile.updatedAt = latestIso(entry.profile.updatedAt, work.updatedAt);
      state.people[credit.personId] = entry;

      const ref = creditRef(linkedCredit);
      credits.set(creditRelationshipKey(ref), ref);
    }

    const workCredits = [...credits.values()].sort(compareCredits);
    if (workCredits.length > 0) state.creditsByWorkId[work.workId] = workCredits;
    for (const credit of workCredits) {
      const reverse: PersonWorkCreditRef = {
        ...credit,
        workId: work.workId,
        workTitle: work.display?.title ?? work.titles[0]?.title
      };
      state.creditsByPersonId[credit.personId] = [
        ...(state.creditsByPersonId[credit.personId] ?? []),
        reverse
      ];
    }
  }

  for (const entry of Object.values(state.people)) {
    indexExternalIds(state, entry.profile);
    indexAliases(state, entry.profile);
  }
  for (const personId of Object.keys(state.creditsByPersonId)) {
    state.creditsByPersonId[personId].sort(compareWorkCredits);
  }

  const summary = summarizePersonCatalog(state, works.length);
  return { state, summary };
}

export function summarizePersonCatalog(state: PersonCatalogState, workCount = state.source?.workCount ?? 0): PersonCatalogBuildSummary {
  const unresolvedCreditCount = state.issues.filter((issue) => issue.kind === "unresolved_credit").length;
  return {
    workCount,
    personCount: Object.keys(state.people).length,
    linkedCreditCount: Object.values(state.creditsByWorkId).reduce((sum, credits) => sum + credits.length, 0),
    unresolvedCreditCount,
    issueCount: state.issues.length
  };
}

export function resolvePersonId(state: PersonCatalogState, personId: string) {
  const seen = new Set<string>();
  let current = personId;
  while (state.redirects[current]) {
    if (seen.has(current)) throw new Error(`Person redirect cycle detected at ${current}.`);
    seen.add(current);
    current = state.redirects[current];
  }
  return current;
}

export function mergePersonCatalogEntries(
  input: PersonCatalogState,
  canonicalPersonId: string,
  retiredPersonId: string
) {
  const state = structuredClone(input);
  const canonicalId = resolvePersonId(state, canonicalPersonId);
  const retiredId = resolvePersonId(state, retiredPersonId);
  if (canonicalId === retiredId) return state;

  const canonical = state.people[canonicalId];
  const retired = state.people[retiredId];
  if (!canonical) throw new Error(`Canonical person does not exist: ${canonicalId}`);
  if (!retired) throw new Error(`Retired person does not exist: ${retiredId}`);
  assertNoSameNamespaceConflict(canonical.profile, retired.profile);

  canonical.profile.names = uniqueNames([...canonical.profile.names, ...retired.profile.names]);
  canonical.profile.externalIds = mergePersonExternalIds(canonical.profile.externalIds, retired.profile.externalIds);
  canonical.profile.departments = uniqueSorted([...(canonical.profile.departments ?? []), ...(retired.profile.departments ?? [])]);
  canonical.profile.sourceRefs = uniqueSourceRefs([...(canonical.profile.sourceRefs ?? []), ...(retired.profile.sourceRefs ?? [])]);
  canonical.profile.profileImages = uniqueImages([...(canonical.profile.profileImages ?? []), ...(retired.profile.profileImages ?? [])]);
  canonical.profile.lockedFields = uniqueSorted([...(canonical.profile.lockedFields ?? []), ...(retired.profile.lockedFields ?? [])]);
  canonical.profile.updatedAt = latestIso(canonical.profile.updatedAt, retired.profile.updatedAt);
  canonical.workIds = uniqueSorted([...canonical.workIds, ...retired.workIds]);
  canonical.updatedAt = latestIso(canonical.updatedAt, retired.updatedAt);
  delete state.people[retiredId];

  state.redirects[retiredId] = canonicalId;
  for (const [sourceId, targetId] of Object.entries(state.redirects)) {
    if (targetId === retiredId) state.redirects[sourceId] = canonicalId;
  }

  for (const [workId, credits] of Object.entries(state.creditsByWorkId)) {
    const merged = new Map<string, PersonCreditRef>();
    for (const credit of credits) {
      const next = credit.personId === retiredId ? { ...credit, personId: canonicalId } : credit;
      merged.set(creditRelationshipKey(next), next);
    }
    state.creditsByWorkId[workId] = [...merged.values()].sort(compareCredits);
  }

  rebuildDerivedPersonIndexes(state);
  return state;
}

function catalogEntry(profile: PersonProfile): PersonCatalogEntry {
  return { profile: structuredClone(profile), workIds: [], updatedAt: profile.updatedAt };
}

function profileFromCredit(credit: MovieCreditEntry & { personId: string }, observedAt: string): PersonProfile {
  const names: PersonNameEntry[] = [{
    value: credit.name,
    kind: "display",
    source: credit.source ?? "external",
    status: "provisional",
    observedAt
  }];
  if (credit.originalName && normalizePersonNameSearchKey(credit.originalName) !== normalizePersonNameSearchKey(credit.name)) {
    names.push({
      value: credit.originalName,
      kind: "original",
      source: credit.source ?? "external",
      status: "provisional",
      observedAt
    });
  }
  return {
    personId: credit.personId,
    names,
    externalIds: normalizedIdsOrUndefined(credit.externalIds),
    departments: [credit.department],
    dataQuality: { status: "partial", updatedAt: observedAt },
    createdAt: observedAt,
    updatedAt: observedAt
  };
}

function addCreditName(profile: PersonProfile, credit: MovieCreditEntry, observedAt: string) {
  const key = normalizePersonNameSearchKey(credit.name);
  if (key && !profile.names.some((entry) => normalizePersonNameSearchKey(entry.value) === key)) {
    profile.names.push({
      value: credit.name,
      kind: "alternate",
      source: credit.source ?? "external",
      status: "strong",
      observedAt
    });
  }
  profile.departments = uniqueSorted([...(profile.departments ?? []), credit.department]);
  profile.externalIds = mergePersonExternalIds(profile.externalIds, credit.externalIds);
}

function creditRef(credit: MovieCreditEntry & { personId: string }): PersonCreditRef {
  return {
    personId: credit.personId,
    name: credit.name,
    department: credit.department,
    ...(credit.job ? { job: credit.job } : {}),
    ...(credit.character ? { character: credit.character } : {}),
    ...(credit.order !== undefined ? { order: credit.order } : {}),
    ...(credit.source ? { source: credit.source } : {})
  };
}

function unresolvedCreditIssue(work: MovieWorkProfile, credit: MovieCreditEntry): PersonCatalogIssue {
  return {
    kind: "unresolved_credit",
    message: "Credit has no stable personId and was not assigned during pure catalog rebuild.",
    workId: work.workId,
    creditName: credit.name
  };
}

function indexExternalIds(state: PersonCatalogState, profile: PersonProfile) {
  const externalIds = normalizePersonExternalIds(profile.externalIds);
  for (const source of ["tmdb", "imdb", "wikidata"] as const) {
    const id = externalIds[source];
    if (!id) continue;
    const existing = state.externalIdIndex[source][id];
    if (existing && existing !== profile.personId) {
      state.issues.push({
        kind: "external_id_conflict",
        message: "One normalized external person ID belongs to multiple people.",
        personIds: uniqueSorted([existing, profile.personId]),
        externalId: { source, id }
      });
      continue;
    }
    state.externalIdIndex[source][id] = profile.personId;
  }
}

function indexAliases(state: PersonCatalogState, profile: PersonProfile) {
  for (const name of profile.names) {
    if (name.status === "rejected" || name.status === "conflict") continue;
    const key = normalizePersonNameSearchKey(name.value);
    if (!key) continue;
    state.aliasIndex[key] = uniqueSorted([...(state.aliasIndex[key] ?? []), profile.personId]);
  }
}

export function rebuildDerivedPersonIndexes(
  state: PersonCatalogState,
  suppliedWorkTitles: Record<string, string> = {}
) {
  const workTitles = new Map<string, string>();
  for (const credits of Object.values(state.creditsByPersonId)) {
    for (const credit of credits) {
      if (credit.workTitle) workTitles.set(credit.workId, credit.workTitle);
    }
  }
  for (const [workId, title] of Object.entries(suppliedWorkTitles)) {
    if (title) workTitles.set(workId, title);
  }
  state.externalIdIndex = { tmdb: {}, imdb: {}, wikidata: {} };
  state.aliasIndex = {};
  state.creditsByPersonId = {};
  state.issues = state.issues.filter((issue) => issue.kind !== "external_id_conflict");
  for (const entry of Object.values(state.people)) {
    entry.workIds = [];
    indexExternalIds(state, entry.profile);
    indexAliases(state, entry.profile);
  }
  for (const [workId, credits] of Object.entries(state.creditsByWorkId)) {
    for (const credit of credits) {
      const canonicalId = resolvePersonId(state, credit.personId);
      const normalizedCredit = canonicalId === credit.personId ? credit : { ...credit, personId: canonicalId };
      const reverse: PersonWorkCreditRef = {
        ...normalizedCredit,
        workId,
        ...(workTitles.get(workId) ? { workTitle: workTitles.get(workId) } : {})
      };
      state.creditsByPersonId[canonicalId] = [...(state.creditsByPersonId[canonicalId] ?? []), reverse];
      const entry = state.people[canonicalId];
      if (entry) entry.workIds = uniqueSorted([...entry.workIds, workId]);
    }
  }
  for (const credits of Object.values(state.creditsByPersonId)) credits.sort(compareWorkCredits);
}

function assertNoSameNamespaceConflict(left: PersonProfile, right: PersonProfile) {
  const leftIds = normalizePersonExternalIds(left.externalIds);
  const rightIds = normalizePersonExternalIds(right.externalIds);
  for (const source of ["tmdb", "imdb", "wikidata"] as const) {
    if (leftIds[source] && rightIds[source] && leftIds[source] !== rightIds[source]) {
      throw new Error(`Cannot merge people with conflicting ${source} IDs: ${leftIds[source]} != ${rightIds[source]}`);
    }
  }
}

function recordCreditExternalIdConflicts(
  state: PersonCatalogState,
  profile: PersonProfile,
  incomingValue: PersonExternalIds | undefined,
  workId: string
) {
  const existing = normalizePersonExternalIds(profile.externalIds);
  const incoming = normalizePersonExternalIds(incomingValue);
  for (const source of ["tmdb", "imdb", "wikidata"] as const) {
    if (!existing[source] || !incoming[source] || existing[source] === incoming[source]) continue;
    state.issues.push({
      kind: "external_id_conflict",
      message: "A linked credit conflicts with the person's existing ID in the same namespace.",
      personIds: [profile.personId],
      workId,
      externalId: { source, id: incoming[source] }
    });
  }
}

function mergePersonExternalIds(left?: PersonExternalIds, right?: PersonExternalIds): PersonExternalIds | undefined {
  const merged = normalizePersonExternalIds({ ...right, ...left });
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizedIdsOrUndefined(value?: PersonExternalIds) {
  const normalized = normalizePersonExternalIds(value);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function uniqueNames(values: PersonNameEntry[]) {
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = [normalizePersonNameSearchKey(entry.value), entry.language ?? "", entry.kind, entry.source, entry.status].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueSourceRefs(values: NonNullable<PersonProfile["sourceRefs"]>) {
  const seen = new Set<string>();
  return values.filter((entry) => {
    const key = `${entry.source}:${entry.id ?? entry.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueImages(values: NonNullable<PersonProfile["profileImages"]>) {
  const seen = new Set<string>();
  return values.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

function creditRelationshipKey(credit: PersonCreditRef) {
  return [
    credit.personId,
    credit.department,
    normalizePersonNameSearchKey(credit.job ?? ""),
    normalizePersonNameSearchKey(credit.character ?? "")
  ].join(":");
}

function compareCredits(left: PersonCreditRef, right: PersonCreditRef) {
  return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
    || creditRelationshipKey(left).localeCompare(creditRelationshipKey(right), "und");
}

function compareWorkCredits(left: PersonWorkCreditRef, right: PersonWorkCreditRef) {
  return left.workId.localeCompare(right.workId, "und") || compareCredits(left, right);
}

function latestIso(left: string, right: string) {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function uniqueSorted<T extends string>(values: T[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right, "und"));
}
