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
  const merged = incoming.map((credit) => structuredClone(credit));
  for (const credit of existing.filter(isPersonEnrichedCredit)) {
    const index = merged.findIndex((candidate) => sameIdentity(candidate, credit) || sameCredit(candidate, credit));
    if (index >= 0) {
      merged[index] = {
        ...merged[index],
        ...structuredClone(credit),
        department: merged[index].department,
        ...(merged[index].job ? { job: merged[index].job } : {}),
        ...(merged[index].order !== undefined ? { order: merged[index].order } : {})
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
  if (left.department !== right.department) return false;
  if (left.job && right.job && normalize(left.job) !== normalize(right.job)) return false;
  if (left.personId && right.personId) return left.personId === right.personId;
  for (const source of ["tmdb", "imdb", "wikidata"] as const) {
    const leftId = left.externalIds?.[source];
    const rightId = right.externalIds?.[source];
    if (leftId && rightId && leftId === rightId) return true;
  }
  return false;
}

function sameCredit(left: MovieCreditEntry, right: MovieCreditEntry) {
  if (left.department !== right.department) return false;
  if (left.job && right.job && normalize(left.job) !== normalize(right.job)) return false;
  const leftNames = new Set([left.name, left.originalName].filter(Boolean).map((value) => normalize(value!)));
  return [right.name, right.originalName]
    .filter(Boolean)
    .some((value) => leftNames.has(normalize(value!)));
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}\s]+/gu, "")
    .trim();
}
