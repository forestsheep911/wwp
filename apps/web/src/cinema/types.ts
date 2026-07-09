import type {
  CacheAsset,
  CacheAssetLookupResponse,
  CacheJob,
  MemberAccessCode,
  MemberInvitation,
  SearchResult
} from "@wwpdw/shared";
export { defaultCreditPolicy, playbackCreditCost } from "@wwpdw/shared";

export type ResultWithCache = SearchResult & { cache?: CacheAsset };
export type AppTab =
  | "library"
  | "cached"
  | "history"
  | "favorites"
  | "watchlist"
  | "nowPlaying"
  | "help"
  | "admin"
  | "tasks"
  | "forum";
export type BrowseChannel = "recommended" | "movie" | "tv" | "animation";
export type BrowseViewId =
  | "lucky"
  | "recent"
  | "newGood"
  | "popular"
  | "topRated"
  | "mostWatched"
  | "doubanRank"
  | "imdbRank"
  | "rottenRank"
  | "tspdtRank";
export type LibraryViewMode = "gallery" | "list";
export type BadgeVariant = "default" | "secondary" | "warning" | "danger" | "muted";
export type AppTheme = "dark" | "light";

export interface PlaybackHistoryEntry {
  assetKey: string;
  title: string;
  playedAt: string;
  contentType?: string;
  contentLength?: number;
  result?: SearchResult;
}

export interface FavoriteEntry {
  assetKey: string;
  title: string;
  addedAt: string;
  favoriteAt?: string;
  wantToWatchAt?: string;
  watchedAt?: string;
  result: ResultWithCache;
}

export type CollectionMark = "favorite" | "wantToWatch" | "watched";

export interface TrackedCacheItem {
  job: CacheJob;
  asset?: CacheAsset;
  result?: SearchResult;
}

export type ManagedMemberCode = MemberAccessCode & { code?: string };
export type ManagedMemberInvitation = MemberInvitation & { code?: string };

export type HistoryAssetStatusMap = Record<string, CacheAssetLookupResponse | undefined>;

export function formatCreditAmount(amount: number | undefined, unitSymbol: string) {
  if (amount === undefined) {
    return "信息缺失";
  }

  return `${amount}${unitSymbol}`;
}
