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

export interface RatingValue {
  label: string;
  value: string;
}

export interface MovieMetadata {
  posterUrl?: string;
  type?: string;
  releaseDate?: string;
  year?: string;
  genres?: string[];
  directors?: string[];
  people?: string[];
  ratings?: RatingValue[];
  ratingLevel?: string[];
  info?: string;
  description?: string;
  imdbId?: string;
}

export interface SearchResult {
  assetKey: string;
  title: string;
  source: string;
  sourceUrl: string;
  durationLabel: string;
  updatedAt: string;
  summary: string;
  metadata?: MovieMetadata;
  variants?: MediaVariant[];
}

export interface MediaVariant {
  assetKey: string;
  label: string;
  sourceUrl: string;
  kind: "file" | "video" | "embed" | "url" | "text";
  summary: string;
  cache?: CacheAsset;
}

export type Mp4FastStartStatus = "faststart" | "late_moov" | "unknown" | "not_mp4";

export interface Mp4Diagnostics {
  status: Mp4FastStartStatus;
  inspectedBytes: number;
  moovOffset?: number;
  mdatOffset?: number;
  notes?: string;
}

export interface MediaDiagnostics {
  checkedAt: string;
  contentType?: string;
  contentLength?: number;
  blobName?: string;
  rangeSupported?: boolean;
  sourceContentType?: string;
  sourceContentLength?: number;
  sourceAcceptRanges?: string;
  mp4?: Mp4Diagnostics;
}

export interface CacheAsset {
  assetKey: string;
  title: string;
  source: string;
  status: CacheStatus;
  jobId?: string;
  playbackUrl?: string;
  expiresAt?: string;
  cachedAt?: string;
  lastRequestedAt: string;
  lastPlayedAt?: string;
  media?: MediaDiagnostics;
}

export interface CacheJob {
  id: string;
  assetKey: string;
  title: string;
  source: string;
  sourceUrl?: string;
  requestId?: string;
  lastRequestId?: string;
  lastRequestedAt?: string;
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
  result?: SearchResult;
}

export interface CacheTriggerStatus {
  status: "disabled" | "skipped" | "started" | "failed";
  message: string;
}

export interface EnsureCacheResponse {
  asset: CacheAsset;
  job: CacheJob;
  trigger?: CacheTriggerStatus;
  charge?: MemberCreditCharge;
  memberCredits?: MemberCreditSummary;
}

export interface PlaybackResponse {
  assetKey: string;
  title: string;
  playbackUrl: string;
  expiresAt: string;
  media?: MediaDiagnostics;
}

export type MemberCreditLimitReason = "total" | "five_hour" | "week";

export interface MemberCreditWindow {
  limit: number;
  used: number;
  remaining: number;
  retryAt?: string;
}

export interface MemberCreditSummary {
  unit: "clover";
  unitSymbol: string;
  total: number;
  used: number;
  remaining: number;
  fiveHour: MemberCreditWindow;
  week: MemberCreditWindow;
}

export interface MemberCreditCharge {
  credits: number;
  reason: "cache_reserved";
  assetKey: string;
  title: string;
  chargedAt: string;
}

export interface CacheAssetLookupResponse {
  asset?: CacheAsset;
  playable: boolean;
}

export interface CachedAssetEntry {
  asset: CacheAsset;
}

export interface CachedAssetsResponse {
  items: CachedAssetEntry[];
}

export type AccessRole = "admin" | "member";

export interface AuthCheckResponse {
  ok: true;
  role: AccessRole;
  member?: {
    id: string;
    name: string;
    credits?: MemberCreditSummary;
  };
}

export interface MemberAccessCode {
  id: string;
  name: string;
  codePreview: string;
  createdAt: string;
  expiresAt: string;
  status: "active" | "revoked" | "expired";
  lastUsedAt?: string;
  credits: MemberCreditSummary;
}

export interface GeneratedMemberAccessCode extends MemberAccessCode {
  code: string;
}

export interface MemberCodeListResponse {
  codes: MemberAccessCode[];
}

export interface CreateMemberCodeRequest {
  name: string;
  days: number;
  credits?: number;
  fiveHourLimit?: number;
  weekLimit?: number;
}

export interface CreateMemberCodeResponse {
  code: GeneratedMemberAccessCode;
}

export interface AddMemberCreditsRequest {
  credits: number;
}

export interface AddMemberCreditsResponse {
  code: MemberAccessCode;
}

export interface AdminCacheJobEntry {
  job: CacheJob;
  asset?: CacheAsset;
}

export interface AdminCacheJobsResponse {
  jobs: AdminCacheJobEntry[];
}

export const mockSearchResults: SearchResult[] = [
  {
    assetKey: "notion-page-ww-001-block-video-a",
    title: "Moonlit archive test clip",
    source: "Notion collection",
    sourceUrl: "https://example.local/notion/files/moonlit-archive-test.mp4?download=1",
    durationLabel: "08:12",
    updatedAt: "2026-06-21",
    summary: "A representative item for testing cache hit, cache miss, and playback-ready states.",
    metadata: {
      posterUrl: "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=500&q=80",
      type: "Movie",
      year: "2026",
      genres: ["Archive", "Sample"],
      ratings: [{ label: "Demo", value: "8.2" }],
      description: "A representative item for testing cache hit, cache miss, and playback-ready states."
    },
    variants: [
      {
        assetKey: "notion-page-ww-001-block-video-a-720p",
        label: "720p sample",
        sourceUrl: "https://example.local/notion/files/moonlit-archive-test.mp4?download=1",
        kind: "file",
        summary: "Mock direct file variant."
      }
    ]
  },
  {
    assetKey: "notion-page-ww-002-block-video-c",
    title: "Family room recording sample",
    source: "Notion collection",
    sourceUrl: "https://example.local/notion/files/family-room-recording.mp4?download=1",
    durationLabel: "03:44",
    updatedAt: "2026-06-18",
    summary: "Used to exercise the shared cache pool when the same result is requested twice.",
    metadata: {
      posterUrl: "https://images.unsplash.com/photo-1517604931442-7e0c8ed2963c?auto=format&fit=crop&w=500&q=80",
      type: "Movie",
      year: "2026",
      genres: ["Family", "Recording"],
      ratings: [{ label: "Demo", value: "7.8" }],
      description: "Used to exercise the shared cache pool when the same result is requested twice."
    },
    variants: [
      {
        assetKey: "notion-page-ww-002-block-video-c-1080p",
        label: "1080p sample",
        sourceUrl: "https://example.local/notion/files/family-room-recording.mp4?download=1",
        kind: "file",
        summary: "Mock direct file variant."
      }
    ]
  },
  {
    assetKey: "notion-page-ww-003-block-video-b",
    title: "Travel notes reel placeholder",
    source: "Notion collection",
    sourceUrl: "https://example.local/notion/preview/travel-notes-reel",
    durationLabel: "11:05",
    updatedAt: "2026-06-09",
    summary: "A longer mock result that makes the status page feel closer to the real flow.",
    metadata: {
      posterUrl: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=500&q=80",
      type: "Movie",
      year: "2026",
      genres: ["Travel", "Preview"],
      ratings: [{ label: "Demo", value: "7.4" }],
      description: "A longer mock result that makes the status page feel closer to the real flow."
    },
    variants: [
      {
        assetKey: "notion-page-ww-003-block-video-b-web",
        label: "Web preview",
        sourceUrl: "https://example.local/notion/preview/travel-notes-reel",
        kind: "embed",
        summary: "Mock intermediate preview link."
      }
    ]
  }
];

export const emptyCacheState = (): LocalCacheState => ({
  assets: {},
  jobs: {}
});

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

function cleanLogFields(fields: LogFields) {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined)
  );
}

export function writeLog(level: LogLevel, event: string, fields: LogFields = {}) {
  const payload = {
    level,
    event,
    at: new Date().toISOString(),
    ...cleanLogFields(fields)
  };
  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export function logInfo(event: string, fields?: LogFields) {
  writeLog("info", event, fields);
}

export function logWarn(event: string, fields?: LogFields) {
  writeLog("warn", event, fields);
}

export function logError(event: string, fields?: LogFields) {
  writeLog("error", event, fields);
}

export function errorLogFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message
    };
  }

  return {
    errorMessage: String(error)
  };
}

export function durationMs(startedAt: number) {
  return Math.round(Date.now() - startedAt);
}
