import type {
  CacheAsset,
  CacheJob,
  EnsureCacheResponse,
  PlaybackResponse,
  SearchResult
} from "@wwpdw/shared";

export type CacheBackend = "local" | "azure";

export interface CleanupExpiredResult {
  scannedAssets: number;
  expiredAssets: number;
  deletedAssets: number;
  deletedJobs: number;
  deletedBlobs: number;
  errors: string[];
}

export interface CacheStore {
  readonly backend: CacheBackend;
  readonly description: string;
  getHealth(): Promise<Record<string, unknown>>;
  listAssets(assetKeys: string[]): Promise<Record<string, CacheAsset>>;
  getAsset(assetKey: string): Promise<CacheAsset | undefined>;
  getJob(jobId: string): Promise<CacheJob | undefined>;
  ensureCache(result: SearchResult): Promise<EnsureCacheResponse>;
  syncQueue(maxMessages: number): Promise<void>;
  listActiveJobs(limit: number): Promise<CacheJob[]>;
  saveJob(job: CacheJob): Promise<void>;
  saveAsset(asset: CacheAsset): Promise<void>;
  finalizeReadyAsset(job: CacheJob): Promise<CacheAsset>;
  getPlayback(assetKey: string): Promise<PlaybackResponse | undefined>;
  cleanupExpired(now?: Date): Promise<CleanupExpiredResult>;
}
