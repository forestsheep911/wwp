import type { MovieCreditEntry } from "@wwpdw/shared";

export function prioritizePeopleCandidates(discovered: MovieCreditEntry[], anchors: MovieCreditEntry[] = []) {
  const departmentPriority: Record<string, number> = {
    directing: 0,
    writing: 1,
    production: 3,
    camera: 4,
    editing: 5,
    music: 6,
    acting: anchors.length > 0 ? 2 : 7
  };
  const anchorKeys = anchors.map((credit) => ({ department: credit.department, keys: creditKeys(credit) }));

  return [...discovered].sort((left, right) => {
    const departmentOrder = (departmentPriority[left.department] ?? 9) - (departmentPriority[right.department] ?? 9);
    if (departmentOrder !== 0) return departmentOrder;
    if (left.department === "acting" && right.department === "acting" && anchors.length > 0) {
      const leftAnchor = matchingAnchorIndex(left, anchorKeys);
      const rightAnchor = matchingAnchorIndex(right, anchorKeys);
      if (leftAnchor !== rightAnchor) return leftAnchor - rightAnchor;
    }
    return (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER);
  });
}

export function prioritizePeopleCandidateBatch(discovered: MovieCreditEntry[], anchors: MovieCreditEntry[] = []) {
  const ordered = prioritizePeopleCandidates(discovered, anchors);
  if (!anchors.some((credit) => credit.department === "acting")) return ordered;

  const leading = [
    ...ordered.filter((credit) => credit.department === "directing").slice(0, 2),
    ...ordered.filter((credit) => credit.department === "writing").slice(0, 2),
    ...ordered.filter((credit) => credit.department === "acting").slice(0, 3)
  ];
  const seen = new Set<string>();
  return [...leading, ...ordered].filter((credit) => {
    const key = candidateKey(credit);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateKey(credit: MovieCreditEntry) {
  return credit.externalIds?.wikidata
    ?? credit.externalIds?.tmdb
    ?? credit.externalIds?.imdb
    ?? `${credit.department}:${normalizeName(credit.originalName ?? credit.name)}`;
}

function matchingAnchorIndex(credit: MovieCreditEntry, anchorKeys: Array<{ department: string; keys: Set<string> }>) {
  const keys = creditKeys(credit);
  const index = anchorKeys.findIndex((anchor) => anchor.department === credit.department
    && [...keys].some((key) => anchor.keys.has(key)));
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function creditKeys(credit: MovieCreditEntry) {
  return new Set([
    credit.externalIds?.wikidata && `wikidata:${credit.externalIds.wikidata}`,
    credit.externalIds?.tmdb && `tmdb:${credit.externalIds.tmdb}`,
    credit.externalIds?.imdb && `imdb:${credit.externalIds.imdb}`,
    credit.name && `name:${normalizeName(credit.name)}`,
    credit.originalName && `name:${normalizeName(credit.originalName)}`
  ].filter((value): value is string => Boolean(value)));
}

function normalizeName(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replaceAll(/[^\p{L}\p{N}]+/gu, "");
}
