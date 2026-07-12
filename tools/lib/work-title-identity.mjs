const YEAR_PATTERN = /[（(]((?:18|19|20)\d{2})[)）]\s*$/;

function clean(value) {
  return String(value ?? "")
    .replace(/^【(?:敬请期待|仅供下载)】\s*/, "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleYear(value) {
  return Number(clean(value).match(YEAR_PATTERN)?.[1]) || undefined;
}

export function normalizeWorkAlias(value) {
  return clean(value)
    .replace(YEAR_PATTERN, "")
    .replace(/\bseason\s*0*(\d+)\b/gi, "第$1季")
    .replace(/\bs0*(\d+)\b/gi, "第$1季")
    .replace(/第([一二三四五六七八九十])季/g, (_, numeral) => `第${"一二三四五六七八九十".indexOf(numeral) + 1}季`)
    .toLocaleLowerCase("zh-CN")
    .replace(/[【】《》\[\]().,，。:：!！?？'"“”‘’·・\s_\-/\\]/g, "");
}

export function collectWorkAliases(input = {}) {
  const values = [
    input.title,
    input.canonicalTitle,
    input.chineseTitle,
    input.englishTitle,
    input.originalTitle,
    input.traditionalTaiwanTitle,
    input.traditionalHongKongTitle,
    ...(input.aliases ?? [])
  ];
  return [...new Set(values.map(normalizeWorkAlias).filter(Boolean))];
}

export function buildCanonicalWorkTitle({ chineseTitle, sourceDisplayTitle, secondaryTitle, year }) {
  const sourced = clean(sourceDisplayTitle);
  if (sourced && titleYear(sourced)) return sourced;
  const chinese = clean(chineseTitle);
  const secondary = clean(secondaryTitle);
  const parts = [chinese, secondary && normalizeWorkAlias(secondary) !== normalizeWorkAlias(chinese) ? secondary : ""]
    .filter(Boolean);
  if (parts.length === 0 || !Number(year)) throw new Error("Canonical work title requires a sourced title and release year.");
  return `${parts.join(" ")} (${Number(year)})`;
}

function idMatches(candidate, existing, key) {
  const left = clean(candidate[key]).toLowerCase();
  const right = clean(existing[key]).toLowerCase();
  return left && right && left === right;
}

export function matchExistingWork(candidate, existing) {
  for (const key of ["doubanId", "imdbId", "tmdbId", "wwWorkId"]) {
    if (idMatches(candidate, existing, key)) return { matched: true, strength: "exact_id", key };
  }

  const candidateAliases = new Set(collectWorkAliases(candidate));
  const sharedAlias = collectWorkAliases(existing).find((alias) => candidateAliases.has(alias));
  if (!sharedAlias) return { matched: false };

  const candidateYear = Number(candidate.year || titleYear(candidate.title));
  const existingYear = Number(existing.year || titleYear(existing.title));
  if (candidateYear && existingYear && candidateYear !== existingYear) return { matched: false };
  return {
    matched: true,
    strength: candidateYear && existingYear ? "alias_and_year" : "alias_needs_review",
    alias: sharedAlias
  };
}

export function findExistingWorkMatches(candidate, existingWorks) {
  return existingWorks.flatMap((existing) => {
    const evidence = matchExistingWork(candidate, existing);
    return evidence.matched ? [{ existing, evidence }] : [];
  });
}
