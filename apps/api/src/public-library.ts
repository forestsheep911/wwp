import type { MediaVariant, SearchResult } from "@wwpdw/shared";

export function isPublicPlayableVariant(variant: MediaVariant) {
  const metadata = variant.metadata;
  return Boolean(variant.assetKey && variant.sourceUrl)
    && metadata?.hideFromWebsite !== true
    && (!metadata?.assetType || metadata.assetType === "playable_video")
    && (!metadata?.availability || metadata.availability === "playable");
}

export function publicWorkIdentity(result: SearchResult) {
  const workId = result.metadata?.work?.workId ?? result.metadata?.workId;
  if (workId) return `work:${workId}`;
  if (result.sourcePageId) return `page:${result.sourcePageId.replaceAll("-", "").toLowerCase()}`;
  return `asset:${result.assetKey}`;
}

// A playable leaf is useful to the player but is not a library work. Do not
// count it as another film, or require cache readiness/editorial completion.
export function publicLibraryResults(results: SearchResult[]): SearchResult[] {
  const works = new Map<string, SearchResult>();
  for (const result of results) {
    if (result.metadata?.hideFromWebsite === true) continue;
    const variants = result.variants?.filter(isPublicPlayableVariant) ?? [];
    if (!variants.length) continue;
    const identity = publicWorkIdentity(result);
    const previous = works.get(identity);
    const merged = new Map((previous?.variants ?? []).map(variant => [variant.assetKey, variant]));
    for (const variant of variants) merged.set(variant.assetKey, variant);
    works.set(identity, { ...(previous ?? result), variants: [...merged.values()] });
  }
  return [...works.values()];
}
