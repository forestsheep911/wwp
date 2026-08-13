import type { PersonExternalIds } from "./person-names.js";

export type PersonExternalIdSource = keyof PersonExternalIds;

export interface PersonIdentityCandidate {
  personId: string;
  externalIds?: PersonExternalIds;
}

export type PersonIdentityDecision =
  | { action: "match"; personId: string; matchedBy: PersonExternalIdSource[] }
  | { action: "new"; externalIds: PersonExternalIds }
  | { action: "unresolved"; reason: "missing_stable_external_id" }
  | {
      action: "conflict";
      reason: "ids_match_multiple_people" | "same_namespace_id_conflict";
      personIds: string[];
      sources: PersonExternalIdSource[];
    };

const sources: PersonExternalIdSource[] = ["tmdb", "imdb", "wikidata"];

export function normalizePersonExternalIds(value: PersonExternalIds | undefined): PersonExternalIds {
  const tmdb = normalizeTmdbPersonId(value?.tmdb);
  const imdb = normalizeImdbPersonId(value?.imdb);
  const wikidata = normalizeWikidataId(value?.wikidata);
  return {
    ...(tmdb ? { tmdb } : {}),
    ...(imdb ? { imdb } : {}),
    ...(wikidata ? { wikidata } : {})
  };
}

export function decidePersonIdentity(
  incomingValue: PersonExternalIds | undefined,
  candidates: PersonIdentityCandidate[]
): PersonIdentityDecision {
  const incoming = normalizePersonExternalIds(incomingValue);
  const incomingSources = sources.filter((source) => incoming[source]);
  if (incomingSources.length === 0) {
    return { action: "unresolved", reason: "missing_stable_external_id" };
  }

  const matches = candidates
    .map((candidate) => {
      const externalIds = normalizePersonExternalIds(candidate.externalIds);
      const matchedBy = incomingSources.filter((source) => externalIds[source] === incoming[source]);
      const conflicts = incomingSources.filter((source) => externalIds[source] && externalIds[source] !== incoming[source]);
      return { candidate, externalIds, matchedBy, conflicts };
    })
    .filter((entry) => entry.matchedBy.length > 0);

  const matchedPersonIds = unique(matches.map((entry) => entry.candidate.personId));
  if (matchedPersonIds.length > 1) {
    return {
      action: "conflict",
      reason: "ids_match_multiple_people",
      personIds: matchedPersonIds,
      sources: unique(matches.flatMap((entry) => entry.matchedBy))
    };
  }

  if (matches.length === 1 && matches[0].conflicts.length > 0) {
    return {
      action: "conflict",
      reason: "same_namespace_id_conflict",
      personIds: [matches[0].candidate.personId],
      sources: matches[0].conflicts
    };
  }

  if (matches.length >= 1) {
    return {
      action: "match",
      personId: matches[0].candidate.personId,
      matchedBy: unique(matches.flatMap((entry) => entry.matchedBy))
    };
  }

  return { action: "new", externalIds: incoming };
}

export function normalizeTmdbPersonId(value?: string) {
  const normalized = value?.trim();
  return normalized && /^\d+$/.test(normalized) ? normalized.replace(/^0+(?=\d)/, "") : undefined;
}

export function normalizeImdbPersonId(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^nm\d+$/.test(normalized) ? normalized : undefined;
}

export function normalizeWikidataId(value?: string) {
  const normalized = value?.trim().toUpperCase();
  return normalized && /^Q\d+$/.test(normalized) ? normalized : undefined;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
