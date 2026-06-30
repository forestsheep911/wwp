import type {
  CacheAsset,
  CacheAssetLookupResponse,
  CacheJob,
  MemberAccessCode,
  SearchResult
} from "@wwpdw/shared";

export type ResultWithCache = SearchResult & { cache?: CacheAsset };
export type AppTab = "library" | "cached" | "history" | "admin" | "tasks";
export type LibraryViewMode = "gallery" | "list";
export type BadgeVariant = "default" | "secondary" | "warning" | "danger" | "muted";

export interface PlaybackHistoryEntry {
  assetKey: string;
  title: string;
  playedAt: string;
  contentType?: string;
  contentLength?: number;
  result?: SearchResult;
}

export interface TrackedCacheItem {
  job: CacheJob;
  asset?: CacheAsset;
  result?: SearchResult;
}

export type ManagedMemberCode = MemberAccessCode & { code?: string };

export type HistoryAssetStatusMap = Record<string, CacheAssetLookupResponse | undefined>;
