import type {
  MovieCreditDepartment,
  PersonCatalogState,
  PublicPersonDetail,
  PublicPersonListResponse,
  PublicPersonSummary
} from "@wwpdw/shared";
import { normalizePersonNameSearchKey, selectPersonDisplayNames } from "@wwpdw/shared";
import { resolvePersonId } from "@wwpdw/cache-store";

export function listPublicPeople(
  state: PersonCatalogState,
  options: { query?: string; department?: MovieCreditDepartment; limit?: number; offset?: number; visibleWorkIds?: Set<string> } = {}
): PublicPersonListResponse {
  const query = normalizePersonNameSearchKey(options.query ?? "");
  const candidateIds = query ? matchingPersonIds(state, query, options.visibleWorkIds) : Object.keys(state.people);
  const people = candidateIds
    .map((personId) => publicSummary(state, personId, options.visibleWorkIds))
    .filter((person): person is PublicPersonSummary => Boolean(person))
    .filter((person) => !options.department || person.departments.includes(options.department))
    .sort(comparePeople);
  const requestedLimit = Number(options.limit ?? 20);
  const requestedOffset = Number(options.offset ?? 0);
  const limit = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 20));
  const offset = Math.min(people.length, Math.max(0, Number.isFinite(requestedOffset) ? Math.floor(requestedOffset) : 0));
  const nextOffset = offset + limit < people.length ? offset + limit : undefined;
  return {
    people: people.slice(offset, offset + limit),
    total: people.length,
    offset,
    ...(nextOffset !== undefined ? { nextOffset } : {}),
    workRelationshipCount: people.reduce((count, person) => count + person.workCount, 0)
  };
}

export function getPublicPerson(
  state: PersonCatalogState,
  requestedPersonId: string,
  options: { visibleWorkIds?: Set<string> } = {}
): PublicPersonDetail | undefined {
  let personId: string;
  try {
    personId = resolvePersonId(state, requestedPersonId);
  } catch {
    return undefined;
  }
  const summary = publicSummary(state, personId, options.visibleWorkIds);
  const entry = state.people[personId];
  if (!summary || !entry) return undefined;
  const works = (state.creditsByPersonId[personId] ?? [])
    .filter((credit) => !options.visibleWorkIds || options.visibleWorkIds.has(credit.workId))
    .map((credit) => ({
    workId: credit.workId,
    ...(credit.workTitle ? { title: credit.workTitle } : {}),
    department: credit.department,
    ...(credit.job ? { job: credit.job } : {}),
    ...(credit.character ? { character: credit.character } : {})
    }));
  return {
    ...summary,
    ...(entry.profile.biography ? { biography: entry.profile.biography } : {}),
    ...(entry.profile.externalIds ? { externalIds: entry.profile.externalIds } : {}),
    works
  };
}

export function listPublicPersonIssues(state: PersonCatalogState) {
  return {
    generatedAt: state.generatedAt,
    total: state.issues.length,
    issues: state.issues.map((issue) => ({
      kind: issue.kind,
      message: issue.message,
      personIds: issue.personIds,
      workId: issue.workId,
      creditName: issue.creditName,
      ...(issue.notionPageId ? { notionPageId: issue.notionPageId } : {}),
      externalId: issue.externalId
    }))
  };
}

function publicSummary(state: PersonCatalogState, personId: string, visibleWorkIds?: Set<string>): PublicPersonSummary | undefined {
  const entry = state.people[personId];
  if (!entry || entry.profile.hiddenFromWebsite) return undefined;
  const names = selectPersonDisplayNames(entry.profile.names);
  if (!names.primary) return undefined;
  const credits = (state.creditsByPersonId[personId] ?? []).filter((credit) => !visibleWorkIds || visibleWorkIds.has(credit.workId));
  const representativeWorks = unique(credits.map((credit) => credit.workTitle).filter((title): title is string => Boolean(title))).slice(0, 3);
  return {
    personId,
    names,
    departments: unique([...(entry.profile.departments ?? []), ...credits.map((credit) => credit.department)]).sort(),
    ...(entry.profile.profileImages?.[0]?.url ? { profileUrl: entry.profile.profileImages[0].url } : {}),
    dataStatus: entry.profile.dataQuality.status,
    biographyLanguages: unique((entry.profile.biography?.texts ?? []).map((text) => text.language.toLocaleLowerCase("und"))),
    workCount: new Set(credits.map((credit) => credit.workId)).size,
    representativeWorks
  };
}

function matchingPersonIds(state: PersonCatalogState, query: string, visibleWorkIds?: Set<string>) {
  const result = new Set<string>();
  for (const [alias, personIds] of Object.entries(state.aliasIndex)) {
    if (!alias.includes(query)) continue;
    for (const personId of personIds) result.add(personId);
  }
  for (const [personId, credits] of Object.entries(state.creditsByPersonId)) {
    if (credits.some((credit) => (!visibleWorkIds || visibleWorkIds.has(credit.workId))
      && normalizePersonNameSearchKey(credit.workTitle ?? "").includes(query))) {
      result.add(personId);
    }
  }
  return [...result];
}

function comparePeople(left: PublicPersonSummary, right: PublicPersonSummary) {
  return right.workCount - left.workCount
    || (left.names.primary ?? "").localeCompare(right.names.primary ?? "", "zh-CN")
    || left.personId.localeCompare(right.personId);
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
