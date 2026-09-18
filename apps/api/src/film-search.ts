import type { SearchResult } from "@wwpdw/shared";
import { publicLibraryResults } from "./public-library.js";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, "").trim();

// Read only metadata already synchronized with the film. Never query People or
// match plot text, technical specs, URLs, or the legacy full-text index.
export function searchFilms(rows: SearchResult[], query: string, limit = 100): SearchResult[] {
  const needle = normalize(query);
  if (!needle) return [];
  return publicLibraryResults(rows).map(result => {
    const m = result.metadata;
    const w = m?.work;
    const titles = [result.title, m?.display?.title, w?.display?.title,
      ...(m?.titles ?? []).map(t => t.title), ...(w?.titles ?? []).map(t => t.title), m?.external?.omdb?.title]
      .filter((s): s is string => Boolean(s)).map(normalize);
    const credits = [...(m?.credits ?? []), ...(w?.credits ?? [])]
      .filter(c => c.department === "acting" || c.department === "directing")
      .flatMap(c => [c.name, c.originalName]);
    const people = [...credits, ...(m?.directors ?? []), ...(m?.people ?? []),
      m?.display?.directorLine, m?.display?.castLine, w?.display?.directorLine, w?.display?.castLine,
      ...(m?.external?.omdb?.directors ?? []), ...(m?.external?.omdb?.actors ?? []), m?.info]
      .filter((s): s is string => Boolean(s)).map(normalize);
    const score = titles.some(t => t === needle) ? 3 : titles.some(t => t.includes(needle)) ? 2
      : people.some(t => t.includes(needle)) ? 1 : 0;
    return { result, score };
  }).filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.result.title.localeCompare(b.result.title, "zh-CN"))
    .slice(0, limit).map(row => row.result);
}
