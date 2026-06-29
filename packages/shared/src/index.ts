export type CacheStatus =
  | "queued"
  | "fetching"
  | "downloading"
  | "processing"
  | "uploading"
  | "ready"
  | "failed";

export type ResolverLayer = "official_api" | "rule" | "browser" | "ai";

export type ResolveKind =
  | "direct_file"
  | "embedded_player"
  | "needs_browser"
  | "needs_ai"
  | "failed";

export interface ResolveResult {
  kind: ResolveKind;
  layer: ResolverLayer;
  confidence: number;
  observedAt: string;
  url?: string;
  iframeUrl?: string;
  snapshotId?: string;
  reason?: string;
  notes?: string;
}

export interface SearchResult {
  assetKey: string;
  title: string;
  source: string;
  sourceUrl: string;
  durationLabel: string;
  updatedAt: string;
  summary: string;
}

export interface CacheAsset {
  assetKey: string;
  title: string;
  source: string;
  status: CacheStatus;
  jobId?: string;
  playbackUrl?: string;
  expiresAt?: string;
  lastRequestedAt: string;
}

export interface CacheJob {
  id: string;
  assetKey: string;
  title: string;
  source: string;
  status: CacheStatus;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  resolve?: ResolveResult;
  completedAt?: string;
  error?: string;
}

export interface LocalCacheState {
  assets: Record<string, CacheAsset>;
  jobs: Record<string, CacheJob>;
}

export interface SearchResponse {
  results: Array<SearchResult & { cache?: CacheAsset }>;
}

export interface EnsureCacheRequest {
  assetKey: string;
}

export interface CacheTriggerStatus {
  status: "disabled" | "skipped" | "started" | "failed";
  message: string;
}

export interface EnsureCacheResponse {
  asset: CacheAsset;
  job: CacheJob;
  trigger?: CacheTriggerStatus;
}

export interface PlaybackResponse {
  assetKey: string;
  title: string;
  playbackUrl: string;
  expiresAt: string;
}

export const mockSearchResults: SearchResult[] = [
  {
    assetKey: "notion-page-ww-001-block-video-a",
    title: "Moonlit archive test clip",
    source: "Notion collection",
    sourceUrl: "https://example.local/notion/files/moonlit-archive-test.mp4?download=1",
    durationLabel: "08:12",
    updatedAt: "2026-06-21",
    summary: "A representative item for testing cache hit, cache miss, and playback-ready states."
  },
  {
    assetKey: "notion-page-ww-002-block-video-c",
    title: "Family room recording sample",
    source: "Notion collection",
    sourceUrl: "https://example.local/notion/files/family-room-recording.mp4?download=1",
    durationLabel: "03:44",
    updatedAt: "2026-06-18",
    summary: "Used to exercise the shared cache pool when the same result is requested twice."
  },
  {
    assetKey: "notion-page-ww-003-block-video-b",
    title: "Travel notes reel placeholder",
    source: "Notion collection",
    sourceUrl: "https://example.local/notion/preview/travel-notes-reel",
    durationLabel: "11:05",
    updatedAt: "2026-06-09",
    summary: "A longer mock result that makes the status page feel closer to the real flow."
  }
];

export const emptyCacheState = (): LocalCacheState => ({
  assets: {},
  jobs: {}
});
