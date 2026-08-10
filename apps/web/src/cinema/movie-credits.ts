import type { MovieCreditDepartment, SearchResult } from "@wwpdw/shared";

export interface MoviePreviewCredits {
  directors: string[];
  writers: string[];
  cast: string[];
}

export function moviePreviewCredits(result: SearchResult): MoviePreviewCredits {
  const metadata = result.metadata;
  const work = metadata?.work;

  return {
    directors: preferNames(
      creditNames(result, "directing"),
      metadata?.directors,
      metadata?.external?.omdb?.directors,
      namesFromLine(work?.display?.directorLine ?? metadata?.display?.directorLine)
    ).slice(0, 3),
    writers: preferNames(
      creditNames(result, "writing"),
      metadata?.external?.omdb?.writers
    ).slice(0, 3),
    cast: preferNames(
      creditNames(result, "acting"),
      metadata?.people,
      metadata?.external?.omdb?.actors,
      namesFromLine(work?.display?.castLine ?? metadata?.display?.castLine)
    ).slice(0, 5)
  };
}

function creditNames(result: SearchResult, department: MovieCreditDepartment) {
  return (result.metadata?.work?.credits ?? [])
    .filter((credit) => credit.department === department)
    .sort((left, right) => (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER))
    .map((credit) => credit.name);
}

function preferNames(...candidates: Array<string[] | undefined>) {
  for (const candidate of candidates) {
    const names = uniqueNames(candidate ?? []);
    if (names.length > 0) {
      return names;
    }
  }
  return [];
}

function namesFromLine(line?: string) {
  return line?.split(/[\/、|]/u) ?? [];
}

function uniqueNames(names: string[]) {
  const seen = new Set<string>();
  return names
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}
