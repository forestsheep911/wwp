import type { SearchResult } from "@wwpdw/shared";
import type { CacheStore, SearchIndexStore } from "@wwpdw/cache-store";
import { preserveIndexedPersonCredits } from "./person-credit-index-merge.js";
import { mergeCachedPosters } from "./poster-refresh.js";

// Every Notion -> index write must retain matching owned images and cache new
// maintained files. Refreshing metadata alone must not replace Blob references
// with rotating Notion URLs. An explicit empty file field still means deletion.
export async function prepareIndexedAssetRefresh(
  incoming: SearchResult,
  searchIndex: Pick<SearchIndexStore, "getResult">,
  cacheStore: Pick<CacheStore, "cacheMoviePosters">,
  options: Parameters<CacheStore["cacheMoviePosters"]>[1] = {}
) {
  const existing = await searchIndex.getResult(incoming.assetKey);
  const personSafe = preserveIndexedPersonCredits(incoming, existing);
  const posterSafe = existing ? mergeCachedPosters(existing, personSafe) : personSafe;
  return cacheStore.cacheMoviePosters(posterSafe, options);
}
