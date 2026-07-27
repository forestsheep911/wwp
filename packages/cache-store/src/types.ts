import type {
  CacheAsset,
  CacheJob,
  EnsureCacheResponse,
  MoviePoster,
  PlaybackResponse,
  SearchResult
} from "@wwpdw/shared";

export type CacheBackend = "local" | "filesystem" | "azure";

export interface LocalMediaFile {
  absolutePath: string;
  contentLength: number;
  contentType: string;
}

export interface LocalPosterFile extends LocalMediaFile {}

export interface CleanupExpiredResult {
  scannedAssets: number;
  expiredAssets: number;
  idleExpiredAssets: number;
  deletedAssets: number;
  deletedJobs: number;
  deletedBlobs: number;
  errors: string[];
}

export interface DeleteCacheEntryInput {
  assetKey?: string;
  jobId?: string;
}

export interface DeleteCacheEntryResult {
  assetKey?: string;
  jobId?: string;
  deletedAsset: boolean;
  deletedJob: boolean;
  deletedBlob: boolean;
  errors: string[];
}

export interface GetAssetOptions {
  fresh?: boolean;
}

export interface CacheMoviePostersOptions {
  refreshPosters?: () => Promise<MoviePoster[] | undefined>;
}

export interface CacheStore {
  readonly backend: CacheBackend;
  readonly description: string;
  getHealth(): Promise<Record<string, unknown>>;
  listAssets(assetKeys: string[]): Promise<Record<string, CacheAsset>>;
  listCachedAssets(limit: number): Promise<CacheAsset[]>;
  getAsset(assetKey: string, options?: GetAssetOptions): Promise<CacheAsset | undefined>;
  getJob(jobId: string): Promise<CacheJob | undefined>;
  ensureCache(result: SearchResult): Promise<EnsureCacheResponse>;
  syncQueue(maxMessages: number): Promise<void>;
  listActiveJobs(limit: number): Promise<CacheJob[]>;
  listRecentJobs(limit: number): Promise<CacheJob[]>;
  retryJob(jobId: string, refreshedResult?: SearchResult): Promise<EnsureCacheResponse | undefined>;
  deleteCacheEntry(input: DeleteCacheEntryInput): Promise<DeleteCacheEntryResult>;
  saveJob(job: CacheJob): Promise<void>;
  saveAsset(asset: CacheAsset): Promise<void>;
  finalizeReadyAsset(job: CacheJob): Promise<CacheAsset>;
  cacheMoviePosters(result: SearchResult, options?: CacheMoviePostersOptions): Promise<SearchResult>;
  hydrateMoviePosterUrls(result: SearchResult): Promise<SearchResult>;
  getPlayback(assetKey: string): Promise<PlaybackResponse | undefined>;
  getMediaFile?(assetKey: string): Promise<LocalMediaFile | undefined>;
  getPosterFile?(posterKey: string): Promise<LocalPosterFile | undefined>;
  cleanupExpired(now?: Date): Promise<CleanupExpiredResult>;
}
