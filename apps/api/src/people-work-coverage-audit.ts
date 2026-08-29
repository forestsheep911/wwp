import type { MovieCreditEntry, SearchResult } from "@wwpdw/shared";

export type PeopleWorkCoverageStatus =
  | "missing_credits"
  | "unlinked_only"
  | "partially_linked"
  | "fully_linked";

export interface PeopleWorkCoverageRecord {
  workId: string;
  title: string;
  kind?: string;
  sourcePageId?: string;
  externalIds: Record<string, string>;
  status: PeopleWorkCoverageStatus;
  creditCount: number;
  linkedCreditCount: number;
  unlinkedCreditCount: number;
  departmentCounts: Record<string, number>;
  recommendedLane: "metadata_then_people" | "people_identity_linking" | "people_expansion" | "none";
}

export interface PeopleWorkCoverageReport {
  totalWorks: number;
  summary: Record<PeopleWorkCoverageStatus, number>;
  candidates: PeopleWorkCoverageRecord[];
  works: PeopleWorkCoverageRecord[];
}

export function auditPeopleWorkCoverage(results: SearchResult[], candidateLimit = 100): PeopleWorkCoverageReport {
  const byWorkId = new Map<string, SearchResult>();

  for (const result of results) {
    const workId = result.metadata?.work?.workId ?? result.metadata?.workId;
    if (!workId) continue;
    const current = byWorkId.get(workId);
    if (!current || creditCount(result) > creditCount(current)) {
      byWorkId.set(workId, result);
    }
  }

  const works = deduplicateExternalWorks([...byWorkId.values()]).map(toCoverageRecord).sort(compareCoverage);
  const summary: Record<PeopleWorkCoverageStatus, number> = {
    missing_credits: 0,
    unlinked_only: 0,
    partially_linked: 0,
    fully_linked: 0
  };
  for (const work of works) summary[work.status] += 1;

  return {
    totalWorks: works.length,
    summary,
    candidates: works.filter((work) => work.status !== "fully_linked").slice(0, Math.max(0, candidateLimit)),
    works
  };
}

function deduplicateExternalWorks(results: SearchResult[]) {
  const byExternalIdentity = new Map<string, SearchResult>();
  const withoutStrongIdentity: SearchResult[] = [];

  for (const result of results) {
    const work = result.metadata?.work;
    const externalIds = work?.externalIds ?? result.metadata?.externalIds ?? {};
    const imdb = typeof externalIds.imdb === "string" ? externalIds.imdb.trim().toLowerCase() : "";
    const kind = String(work?.kind ?? result.metadata?.kind ?? "").trim().toLowerCase();
    const year = String(work?.release?.year ?? "").trim();
    if (!imdb || !kind || !year) {
      withoutStrongIdentity.push(result);
      continue;
    }

    const key = `${kind}:${year}:${imdb}`;
    const current = byExternalIdentity.get(key);
    if (!current || preferCanonicalExternalWork(result, current)) {
      byExternalIdentity.set(key, result);
    }
  }

  return [...withoutStrongIdentity, ...byExternalIdentity.values()];
}

function preferCanonicalExternalWork(candidate: SearchResult, current: SearchResult) {
  const candidateCredits = creditCount(candidate);
  const currentCredits = creditCount(current);
  if (candidateCredits !== currentCredits) return candidateCredits > currentCredits;
  const candidateLegacy = isLegacyCarrier(candidate);
  const currentLegacy = isLegacyCarrier(current);
  if (candidateLegacy !== currentLegacy) return !candidateLegacy;
  return candidate.updatedAt > current.updatedAt;
}

function isLegacyCarrier(result: SearchResult) {
  return /仅供下载|legacy|旧版|download[- ]only/i.test(result.title);
}

function toCoverageRecord(result: SearchResult): PeopleWorkCoverageRecord {
  const work = result.metadata?.work;
  const credits = work?.credits ?? result.metadata?.credits ?? [];
  const linkedCreditCount = credits.filter((credit) => Boolean(credit.personId)).length;
  const unlinkedCreditCount = credits.length - linkedCreditCount;
  const status = coverageStatus(credits.length, linkedCreditCount);
  const externalIds = Object.fromEntries(
    Object.entries(work?.externalIds ?? result.metadata?.externalIds ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
  );

  return {
    workId: work?.workId ?? result.metadata!.workId!,
    title: result.title,
    kind: work?.kind ?? result.metadata?.kind,
    sourcePageId: result.sourcePageId,
    externalIds,
    status,
    creditCount: credits.length,
    linkedCreditCount,
    unlinkedCreditCount,
    departmentCounts: countDepartments(credits),
    recommendedLane: recommendedLane(status)
  };
}

function creditCount(result: SearchResult) {
  return (result.metadata?.work?.credits ?? result.metadata?.credits ?? []).length;
}

function coverageStatus(creditCountValue: number, linkedCreditCount: number): PeopleWorkCoverageStatus {
  if (creditCountValue === 0) return "missing_credits";
  if (linkedCreditCount === 0) return "unlinked_only";
  if (linkedCreditCount < creditCountValue) return "partially_linked";
  return "fully_linked";
}

function recommendedLane(status: PeopleWorkCoverageStatus): PeopleWorkCoverageRecord["recommendedLane"] {
  if (status === "missing_credits") return "metadata_then_people";
  if (status === "unlinked_only") return "people_identity_linking";
  if (status === "partially_linked") return "people_expansion";
  return "none";
}

function countDepartments(credits: MovieCreditEntry[]) {
  const counts: Record<string, number> = {};
  for (const credit of credits) counts[credit.department] = (counts[credit.department] ?? 0) + 1;
  return counts;
}

function compareCoverage(left: PeopleWorkCoverageRecord, right: PeopleWorkCoverageRecord) {
  const priority: Record<PeopleWorkCoverageStatus, number> = {
    missing_credits: 0,
    unlinked_only: 1,
    partially_linked: 2,
    fully_linked: 3
  };
  return priority[left.status] - priority[right.status]
    || Number(Boolean(right.externalIds.imdb)) - Number(Boolean(left.externalIds.imdb))
    || right.unlinkedCreditCount - left.unlinkedCreditCount
    || left.title.localeCompare(right.title, "zh-CN");
}
