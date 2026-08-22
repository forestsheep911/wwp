import type { MovieCreditEntry, SearchResult } from "@wwpdw/shared";

export function preserveIndexedPersonCredits(incoming: SearchResult, existing: SearchResult | undefined): SearchResult {
  const existingCredits = existing?.metadata?.credits ?? existing?.metadata?.work?.credits ?? [];
  if (!existingCredits.some(isPersonEnrichedCredit)) return incoming;

  const incomingCredits = incoming.metadata?.credits ?? incoming.metadata?.work?.credits ?? [];
  const credits = mergeCredits(existingCredits, incomingCredits);
  const result = structuredClone(incoming);
  if (!result.metadata) return result;
  result.metadata.credits = structuredClone(credits);
  if (result.metadata.work) result.metadata.work.credits = structuredClone(credits);
  return result;
}

function mergeCredits(existing: MovieCreditEntry[], incoming: MovieCreditEntry[]) {
  const merged = existing.map((credit) => structuredClone(credit));
  for (const credit of incoming.filter(isPersonEnrichedCredit)) {
    const index = merged.findIndex((candidate) => sameIdentity(candidate, credit));
    if (index >= 0) {
      merged[index] = {
        ...structuredClone(credit),
        ...merged[index],
        ...(credit.order !== undefined ? { order: credit.order } : {})
      };
    } else {
      merged.push(structuredClone(credit));
    }
  }
  return merged;
}

function isPersonEnrichedCredit(credit: MovieCreditEntry) {
  return Boolean(
    credit.personId
    || credit.externalIds?.tmdb
    || credit.externalIds?.imdb
    || credit.externalIds?.wikidata
    || (credit.source && credit.source !== "notion")
  );
}

function sameIdentity(left: MovieCreditEntry, right: MovieCreditEntry) {
  if (left.personId && right.personId) return left.personId === right.personId;
  for (const source of ["tmdb", "imdb", "wikidata"] as const) {
    const leftId = left.externalIds?.[source];
    const rightId = right.externalIds?.[source];
    if (leftId && rightId && leftId === rightId) return true;
  }
  return false;
}
