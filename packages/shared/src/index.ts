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

export interface MoviePoster {
  url: string;
  source: "notion" | "omdb" | "external" | "blob";
  originalUrl?: string;
  blobName?: string;
  contentType?: string;
  cachedAt?: string;
}

export interface MovieExternalIds {
  imdb?: string;
  tmdb?: string;
  douban?: string;
}

export interface OmdbMetadata {
  source: "omdb";
  fetchedAt: string;
  title?: string;
  year?: string;
  type?: string;
  rated?: string;
  released?: string;
  runtime?: string;
  genres?: string[];
  directors?: string[];
  writers?: string[];
  actors?: string[];
  plot?: string;
  languages?: string[];
  countries?: string[];
  awards?: string;
  posterUrl?: string;
  ratings?: RatingValue[];
  metascore?: string;
  imdbRating?: string;
  imdbVotes?: string;
  imdbId?: string;
  dvd?: string;
  boxOffice?: string;
  production?: string;
  website?: string;
  totalSeasons?: string;
  season?: string;
  episode?: string;
  seriesId?: string;
  sourceUrl?: string;
}

export interface ExternalMovieMetadata {
  omdb?: OmdbMetadata;
}

export interface MovieMetadata {
  posterUrl?: string;
  posters?: MoviePoster[];
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
  externalIds?: MovieExternalIds;
  external?: ExternalMovieMetadata;
}

export interface SearchResult {
  assetKey: string;
  title: string;
  source: string;
  sourceUrl: string;
  sourcePageId?: string;
  sourceBreadcrumb?: string[];
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
  sourcePageId?: string;
  sourceBreadcrumb?: string[];
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
  requestedByMemberId?: string;
  requestedByMemberName?: string;
  media?: MediaDiagnostics;
}

export interface CacheJob {
  id: string;
  assetKey: string;
  title: string;
  source: string;
  sourceUrl?: string;
  sourcePageId?: string;
  sourceBreadcrumb?: string[];
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
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  nextOffset?: number;
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
  charge?: MemberCreditCharge;
  memberCredits?: MemberCreditSummary;
  playbackCredit?: {
    charged: boolean;
    windowHours: number;
    windowExpiresAt?: string;
  };
}

export type MemberCreditLimitReason = "balance";

export interface MemberCreditSummary {
  unit: "clover";
  unitSymbol: string;
  remaining: number;
}

export type MemberCreditChargeReason = "cache_reserved" | "playback_stream";

export interface MemberCreditCharge {
  credits: number;
  reason: MemberCreditChargeReason;
  assetKey: string;
  title: string;
  chargedAt: string;
  windowExpiresAt?: string;
}

export interface MemberCreditUsageEntry extends MemberCreditCharge {
  id: string;
  requestId?: string;
}

export interface MemberCreditUsageResponse {
  member?: {
    id: string;
    name: string;
    credits: MemberCreditSummary;
  };
  entries: MemberCreditUsageEntry[];
}

export type CreditPreviewAction = "cache" | "playback";

export type CreditPreviewFreeReason =
  | "admin"
  | "cache_ready"
  | "cache_active"
  | "playback_replay";

export interface CreditPreviewRequest {
  action: CreditPreviewAction;
  assetKey: string;
  title?: string;
  result?: SearchResult;
}

export interface CreditPreviewResponse {
  action: CreditPreviewAction;
  assetKey: string;
  title: string;
  credits: number;
  unitSymbol: string;
  chargeable: boolean;
  canAfford: boolean;
  remaining?: number;
  remainingAfter?: number;
  freeReason?: CreditPreviewFreeReason;
  windowHours?: number;
  windowExpiresAt?: string;
}

export interface CreditPolicyResponse {
  unitSymbol: string;
  cacheCredits: number;
  playbackCreditBytes: number;
  playbackReplayFreeHours: number;
}

export type MovieRequestStatus = "new" | "planned" | "fulfilled" | "dismissed";

export interface MovieRequestEntry {
  id: string;
  text: string;
  status: MovieRequestStatus;
  requestedAt: string;
  updatedAt: string;
  requestedByMemberId?: string;
  requestedByMemberName?: string;
}

export interface CreateMovieRequestRequest {
  text: string;
}

export interface CreateMovieRequestResponse {
  request: MovieRequestEntry;
}

export interface MovieRequestsResponse {
  requests: MovieRequestEntry[];
}

export interface UpdateMovieRequestStatusRequest {
  status: MovieRequestStatus;
}

export interface UpdateMovieRequestStatusResponse {
  request: MovieRequestEntry;
}

export type ForumAuthorRole = AccessRole;

export interface ForumReplyEntry {
  id: string;
  body: string;
  createdAt: string;
  authorMemberId?: string;
  authorMemberName?: string;
  authorRole: ForumAuthorRole;
}

export interface ForumThreadSummary {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  authorMemberId?: string;
  authorMemberName?: string;
  authorRole: ForumAuthorRole;
  replyCount: number;
  lastReplyAt?: string;
  latestReply?: ForumReplyEntry;
}

export interface ForumThreadEntry extends ForumThreadSummary {
  replies: ForumReplyEntry[];
}

export interface CreateForumThreadRequest {
  title: string;
  body: string;
}

export interface CreateForumThreadResponse {
  thread: ForumThreadEntry;
}

export interface ForumThreadsResponse {
  threads: ForumThreadSummary[];
}

export interface ForumThreadResponse {
  thread: ForumThreadEntry;
}

export interface CreateForumReplyRequest {
  body: string;
}

export interface CreateForumReplyResponse {
  thread: ForumThreadEntry;
  reply: ForumReplyEntry;
}

export type MemberNoticeAudience = "all" | "member";

export interface MemberNoticeEntry {
  id: string;
  title: string;
  body: string;
  audience: MemberNoticeAudience;
  createdAt: string;
  createdByRole: AccessRole;
  createdByMemberId?: string;
  createdByMemberName?: string;
  targetMemberId?: string;
  targetMemberName?: string;
  readAt?: string;
}

export interface CreateMemberNoticeRequest {
  title: string;
  body: string;
  audience: MemberNoticeAudience;
  targetMemberId?: string;
}

export interface CreateMemberNoticeResponse {
  notice: MemberNoticeEntry;
}

export interface MemberNoticeListResponse {
  notices: MemberNoticeEntry[];
  unreadCount: number;
}

export interface MarkMemberNoticeReadResponse {
  notice: MemberNoticeEntry;
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

export const memberPasscodeLength = 12;

export function validateMemberPasscode(passcode: string) {
  if (passcode.length !== memberPasscodeLength) {
    return "通行码必须是 12 位半角字符。";
  }

  if (!/^[\x21-\x7E]+$/.test(passcode)) {
    return "通行码只能包含半角英数或常用符号，不能包含空格或中文。";
  }

  if (!/[A-Za-z]/.test(passcode)) {
    return "通行码至少需要 1 个字母。";
  }

  if (!/[0-9]/.test(passcode)) {
    return "通行码至少需要 1 个数字。";
  }

  return undefined;
}

export interface RegisterMemberRequest {
  inviteCode: string;
}

export interface RegisterMemberResponse {
  auth: AuthCheckResponse;
  code: MemberAccessCode;
  passcode: string;
}

export interface ChangeMemberPasscodeRequest {
  currentPasscode: string;
  newPasscode: string;
}

export interface ChangeMemberPasscodeResponse {
  code: MemberAccessCode;
}

export interface ResetMemberPasscodeRequest {
  inviteCode: string;
  newPasscode: string;
}

export interface ResetMemberPasscodeResponse {
  code: MemberAccessCode;
}

export interface UpdateMemberProfileRequest {
  name?: string;
  newPasscode?: string;
}

export interface UpdateMemberProfileResponse {
  code: MemberAccessCode;
}

export interface MemberAccessCode {
  id: string;
  name: string;
  codePreview: string;
  createdAt: string;
  expiresAt: string;
  status: "active" | "revoked";
  lastUsedAt?: string;
  credits: MemberCreditSummary;
}

export interface MemberCodeListResponse {
  codes: MemberAccessCode[];
}

export type MemberInvitationType = "signup" | "reset";
export type MemberInvitationStatus = "unused" | "used" | "expired" | "revoked";

export interface MemberInvitation {
  id: string;
  type: MemberInvitationType;
  codePreview: string;
  createdAt: string;
  expiresAt?: string;
  status: MemberInvitationStatus;
  name?: string;
  credits?: MemberCreditSummary;
  memberId?: string;
  memberName?: string;
  usedAt?: string;
  claimedByMemberId?: string;
  claimedByMemberName?: string;
}

export interface GeneratedMemberInvitation extends MemberInvitation {
  code: string;
}

export interface MemberInvitationListResponse {
  invitations: MemberInvitation[];
}

export interface CreateSignupInvitationRequest {
  credits?: number;
}

export interface CreateSignupInvitationResponse {
  invitation: GeneratedMemberInvitation;
}

export interface CreateResetInvitationResponse {
  invitation: GeneratedMemberInvitation;
}

export interface SetMemberCreditsRequest {
  credits: number;
}

export interface SetMemberCreditsResponse {
  code: MemberAccessCode;
}

export interface AdjustMemberCreditsRequest {
  delta: number;
}

export interface AdjustMemberCreditsResponse {
  codes: MemberAccessCode[];
  adjustedCount: number;
  delta: number;
}

export interface AdminLoginAuditEntry {
  id: string;
  at: string;
  role: AccessRole;
  memberId?: string;
  memberName?: string;
  ipAddress?: string;
  ipLocation?: string;
  device?: string;
  userAgent?: string;
  requestId?: string;
}

export interface AdminLoginAuditResponse {
  events: AdminLoginAuditEntry[];
}

export interface AdminCacheJobEntry {
  job: CacheJob;
  asset?: CacheAsset;
}

export interface AdminCacheJobsResponse {
  jobs: AdminCacheJobEntry[];
}

export interface DeleteCacheEntryResponse {
  assetKey?: string;
  jobId?: string;
  deletedAsset: boolean;
  deletedJob: boolean;
  deletedBlob: boolean;
  errors: string[];
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
