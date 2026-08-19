import type { PersonExternalIds } from "@wwpdw/shared";

export interface PersonExternalLink {
  label: "TMDB" | "IMDb" | "Wikidata";
  url: string;
}

export function formatPersonDate(value?: string): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;

  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(normalized);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) : undefined;
  const day = match[3] ? Number(match[3]) : undefined;
  if (year < 1 || (month !== undefined && (month < 1 || month > 12))) return undefined;

  if (day !== undefined) {
    const candidate = new Date(Date.UTC(year, (month ?? 1) - 1, day));
    if (
      candidate.getUTCFullYear() !== year ||
      candidate.getUTCMonth() + 1 !== month ||
      candidate.getUTCDate() !== day
    ) return undefined;
  }

  return `${year}年${month === undefined ? "" : `${month}月`}${day === undefined ? "" : `${day}日`}`;
}

export function getPersonExternalLinks(externalIds?: PersonExternalIds): PersonExternalLink[] {
  const links: PersonExternalLink[] = [];

  if (externalIds?.tmdb && /^\d+$/.test(externalIds.tmdb)) {
    links.push({ label: "TMDB", url: `https://www.themoviedb.org/person/${externalIds.tmdb}` });
  }
  if (externalIds?.imdb && /^nm\d+$/.test(externalIds.imdb)) {
    links.push({ label: "IMDb", url: `https://www.imdb.com/name/${externalIds.imdb}/` });
  }
  if (externalIds?.wikidata && /^Q\d+$/i.test(externalIds.wikidata)) {
    links.push({ label: "Wikidata", url: `https://www.wikidata.org/wiki/${externalIds.wikidata.toUpperCase()}` });
  }

  return links;
}
