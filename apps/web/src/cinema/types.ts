import type {
  CacheAsset,
  CacheAssetLookupResponse,
  CacheJob,
  CreditPolicyResponse,
  MemberAccessCode,
  MemberInvitation,
  SearchResult
} from "@wwpdw/shared";

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
  result: ResultWithCache;
}

export interface TrackedCacheItem {
  job: CacheJob;
  asset?: CacheAsset;
  result?: SearchResult;
}

export type ManagedMemberCode = MemberAccessCode & { code?: string };
export type ManagedMemberInvitation = MemberInvitation & { code?: string };

export type HistoryAssetStatusMap = Record<string, CacheAssetLookupResponse | undefined>;

export const defaultCreditPolicy: CreditPolicyResponse = {
  unitSymbol: "🍀",
  cacheCredits: 1,
  playbackCreditBytes: 1000 * 1000 * 1000,
  playbackReplayFreeHours: 24
};

export function playbackCreditCost(contentLength: number | undefined, policy: CreditPolicyResponse) {
  if (!contentLength || !Number.isFinite(contentLength) || contentLength <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(contentLength / policy.playbackCreditBytes));
}

export function formatCreditAmount(amount: number, unitSymbol: string) {
  return `${amount}${unitSymbol}`;
}
