import { buildMovieCatalogFromResults } from "@wwpdw/cache-store";
import { selectPersonDisplayNames, type PersonCatalogState, type SearchResult } from "@wwpdw/shared";
import type { IdentityCandidate } from "./public-identities.js";
export function publicIdentityCandidates(results: SearchResult[], people: PersonCatalogState): IdentityCandidate[] {
  const catalog = buildMovieCatalogFromResults(results).state;
  const byAsset = new Map(results.map(result => [result.assetKey, result]));
  const redirects = new Map<string, string[]>();
  for (const [source, target] of Object.entries(people.redirects)) redirects.set(target, [...(redirects.get(target) ?? []), source]);
  const candidates: IdentityCandidate[] = Object.values(catalog.works).map(entry => ({
    kind: "work", key: entry.assetKeys[0], title: entry.work.display?.title ?? byAsset.get(entry.assetKeys[0])?.title ?? "作品",
    aliases: [entry.work.workId, ...entry.assetKeys, ...(entry.mergedWorkIds ?? []), ...Object.entries(entry.work.externalIds ?? {}).filter(([, id]) => Boolean(id)).map(([source, id]) => `${source}:${id}`)]
  }));
  for (const entry of Object.values(people.people)) {
    if (entry.profile.hiddenFromWebsite) continue;
    const title = selectPersonDisplayNames(entry.profile.names).primary;
    if (title) candidates.push({ kind: "person", key: entry.profile.personId, title, aliases: redirects.get(entry.profile.personId) ?? [] });
  }
  for (const result of results) for (const item of [result, ...(result.variants ?? [])]) candidates.push({ kind: "video", key: item.assetKey, title: result.title });
  return [...new Map(candidates.map(candidate => [`${candidate.kind}:${candidate.key}`, candidate])).values()];
}
