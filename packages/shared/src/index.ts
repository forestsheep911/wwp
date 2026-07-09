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
  tvdb?: string;
  letterboxd?: string;
  wikidata?: string;
  [source: string]: string | undefined;
}

export type MovieWorkKind = "movie" | "series" | "season" | "episode" | "short" | "special" | "unknown";
export type MediaAvailability = "playable" | "source_only" | "needs_processing" | "blocked" | "unknown";
export type MediaAssetType =
  | "playable_video"
  | "source_archive"
  | "original_disc"
  | "subtitle_package"
  | "extra"
  | "unknown";

export type MovieMetadataSource =
  | "manual"
  | "notion"
  | "douban"
  | "imdb"
  | "tmdb"
  | "omdb"
  | "tspdt"
  | "search-index"
  | "external";

export type MovieTitleKind = "primary" | "original" | "localized" | "alternate" | "sort" | "list";

export interface MovieTitleEntry {
  title: string;
  kind: MovieTitleKind;
  lang?: string;
  region?: string;
  source?: MovieMetadataSource;
}

export interface MovieReleaseInfo {
  year?: string;
  date?: string;
  originalDate?: string;
  countries?: string[];
  source?: MovieMetadataSource;
}

export type MovieCreditDepartment =
  | "directing"
  | "writing"
  | "acting"
  | "production"
  | "camera"
  | "music"
  | "editing"
  | "art"
  | "sound"
  | "visual_effects"
  | "costume"
  | "makeup"
  | "crew"
  | "other";

export interface MovieCreditEntry {
  personId?: string;
  name: string;
  originalName?: string;
  department: MovieCreditDepartment;
  job?: string;
  character?: string;
  order?: number;
  source?: MovieMetadataSource;
  externalIds?: MovieExternalIds;
}

export interface MovieRatingEntry extends RatingValue {
  source?: MovieMetadataSource;
  normalizedValue?: number;
  scale?: number;
  votes?: number;
  fetchedAt?: string;
}

export interface MovieMediaAssets {
  posters?: MoviePoster[];
  backdropUrl?: string;
  trailerUrl?: string;
}

export interface MovieBoxOffice {
  display?: string;
  amount?: number;
  currency?: string;
  source?: MovieMetadataSource;
  updatedAt?: string;
}

export interface MovieSourceRef {
  source: MovieMetadataSource;
  id?: string;
  url?: string;
  title?: string;
  observedAt?: string;
}

export interface MovieDataQuality {
  status?: "draft" | "partial" | "verified" | "conflict";
  missing?: Array<"externalIds" | "release" | "credits" | "poster" | "description" | "ratings">;
  notes?: string[];
  updatedAt?: string;
}

export interface MovieDisplayMetadata {
  title?: string;
  subtitle?: string;
  year?: string;
  directorLine?: string;
  castLine?: string;
}

export interface MovieWorkProfile {
  workId: string;
  kind: MovieWorkKind;
  titles: MovieTitleEntry[];
  originalLanguage?: string;
  release?: MovieReleaseInfo;
  externalIds?: MovieExternalIds;
  genres?: string[];
  countries?: string[];
  runtimeMinutes?: number;
  credits?: MovieCreditEntry[];
  ratings?: MovieRatingEntry[];
  boxOffice?: MovieBoxOffice;
  media?: MovieMediaAssets;
  sourceRefs?: MovieSourceRef[];
  dataQuality?: MovieDataQuality;
  display?: MovieDisplayMetadata;
  createdAt?: string;
  updatedAt: string;
}

export interface MovieCatalogEntry {
  work: MovieWorkProfile;
  assetKeys: string[];
  sourcePageIds?: string[];
  sourceTitles?: string[];
  mergedWorkIds?: string[];
  updatedAt: string;
}

export interface MovieCatalogIssue {
  kind: "external_id_conflict" | "title_year_candidate";
  message: string;
  workIds: string[];
  externalId?: {
    source: string;
    id: string;
  };
  titleKey?: string;
}

export interface MovieCatalogState {
  schemaVersion: 1;
  generatedAt: string;
  source?: {
    kind: "search-index" | "manual" | "mixed";
    path?: string;
    entryCount?: number;
  };
  works: Record<string, MovieCatalogEntry>;
  externalIdIndex: Record<string, Record<string, string>>;
  titleYearIndex: Record<string, string[]>;
  issues: MovieCatalogIssue[];
}

export type TspdtRankingMatchStatus = "matched" | "unmatched" | "ambiguous" | "manual";

export type TspdtRankingMatchMethod =
  | "workId"
  | "imdb"
  | "douban"
  | "title_year";

export interface TspdtRankingCandidate {
  workId: string;
  method: TspdtRankingMatchMethod;
  confidence: number;
  title?: string;
  year?: string;
}

export interface TspdtRankingEntry {
  listId: string;
  rank: number;
  previousRank: string;
  title: string;
  director: string;
  year: string;
  country: string;
  workId?: string;
  externalIds?: Pick<MovieExternalIds, "imdb" | "douban">;
  matchStatus: TspdtRankingMatchStatus;
  matchMethod?: TspdtRankingMatchMethod;
  matchConfidence?: number;
  candidates?: TspdtRankingCandidate[];
}

export interface TspdtRankingState {
  schemaVersion: 1;
  generatedAt: string;
  listId: string;
  edition: string;
  sourceUrl: string;
  entries: TspdtRankingEntry[];
  summary: {
    total: number;
    matched: number;
    manual: number;
    ambiguous: number;
    unmatched: number;
  };
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
  workId?: string;
  kind?: MovieWorkKind;
  titles?: MovieTitleEntry[];
  release?: MovieReleaseInfo;
  credits?: MovieCreditEntry[];
  boxOffice?: MovieBoxOffice;
  sourceRefs?: MovieSourceRef[];
  dataQuality?: MovieDataQuality;
  display?: MovieDisplayMetadata;
  work?: MovieWorkProfile;

  // Legacy display/search fields. Keep these until callers migrate to `work`.
  posterUrl?: string;
  posters?: MoviePoster[];
  type?: string;
  releaseDate?: string;
  year?: string;
  genres?: string[];
  directors?: string[];
  people?: string[];
  ratings?: RatingValue[];
  boxOfficeDisplay?: string;
  boxOfficeAmount?: number;
  boxOfficeCurrency?: string;
  ratingLevel?: string[];
  aiSuggestedMinimumAge?: number;
  aiAgeConfidence?: string;
  contentRiskTags?: string[];
  aiAgeReason?: string;
  manualAgeOverride?: number;
  effectiveMinimumAge?: number;
  info?: string;
  description?: string;
  imdbId?: string;
  externalIds?: MovieExternalIds;
  mediaAvailability?: MediaAvailability;
  hideFromWebsite?: boolean;
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

export type MovieSummaryMode = "spoiler_free" | "spoiler";

export interface MovieSummaryRequest {
  mode: MovieSummaryMode;
  result: SearchResult;
}

export interface MovieSummaryResponse {
  mode: MovieSummaryMode;
  title: string;
  summary: string;
  generatedAt: string;
}

export interface MediaVariant {
  assetKey: string;
  label: string;
  sourceUrl: string;
  sourcePageId?: string;
  sourceBreadcrumb?: string[];
  kind: "file" | "video" | "embed" | "url" | "text";
  summary: string;
  metadata?: MediaVariantMetadata;
  cache?: CacheAsset;
}

export interface MediaVariantMetadata {
  assetType?: MediaAssetType;
  mediaAssetPageId?: string;
  availability?: MediaAvailability;
  edition?: string;
  episodeNumber?: number;
  resolution?: string;
  videoCodec?: string;
  container?: string;
  exactByteSize?: number;
  approximateSizeGb?: number;
  durationSeconds?: number;
  frameRate?: string;
  videoDynamicRange?: string;
  qualityTag?: string;
  audioCodec?: string;
  audioChannelLayout?: string;
  audioLanguages?: string[];
  subtitleLanguages?: string[];
  subtitleRegions?: string[];
  sourceLineage?: string[];
  commentary?: boolean;
  noSubtitles?: boolean;
  playbackVerified?: boolean;
  hideFromWebsite?: boolean;
  sourceLabel?: string;
  fileName?: string;
  originalFileName?: string;
  mediaBlockId?: string;
  developerMemo?: string;
  structuredSource?: "media_assets" | "notion_page";
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
  sourceMediaBlockId?: string;
  sourceMediaAssetPageId?: string;
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
  mode?: "paged" | "random";
}

export interface NowPlayingMovie {
  id: string;
  title: string;
  releaseInfo?: string;
  rank: number;
  boxRate?: string;
  splitBoxRate?: string;
  showCount?: number;
  showCountRate?: string;
  avgShowView?: string;
  avgSeatView?: string;
  totalBoxOffice?: string;
  totalSplitBoxOffice?: string;
  sourceUrl: string;
  ticketUrl?: string;
  douban?: {
    subjectId: string;
    title: string;
    url: string;
    rating?: string;
    voteCount?: number;
    releaseYear?: string;
    duration?: string;
    region?: string;
    director?: string;
    actors?: string;
  };
}

export interface UpcomingMovie {
  id: string;
  title: string;
  releaseDate: string;
  genres: string[];
  region?: string;
  wishCount?: number;
  sourceUrl: string;
  trailerUrl?: string;
}

export interface NowPlayingResponse {
  source: "maoyan";
  sourceUrl: string;
  douban?: {
    sourceUrl: string;
    laterSourceUrl: string;
    fetchedAt: string;
    city: "shanghai";
    nowPlayingCount: number;
  };
  fetchedAt: string;
  observedAt?: string;
  cache: {
    status: "hit" | "refresh" | "stale";
    ttlSeconds: number;
  };
  degraded?: boolean;
  warning?: string;
  movies: NowPlayingMovie[];
  upcomingMovies?: UpcomingMovie[];
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

export interface DirectDownloadRequest {
  assetKey: string;
  result?: SearchResult;
}

export interface DirectDownloadResponse {
  assetKey: string;
  title: string;
  downloadUrl: string;
  expiresAt?: string;
  sourceRefreshed: boolean;
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

export const defaultCreditPolicy: CreditPolicyResponse = {
  unitSymbol: "🍀",
  cacheCredits: 10,
  playbackCreditBytes: 100 * 1000 * 1000,
  playbackReplayFreeHours: 24
};

export function hasBillablePlaybackSize(contentLength: number | undefined): contentLength is number {
  return Boolean(contentLength && Number.isFinite(contentLength) && contentLength > 0);
}

export function playbackCreditCost(
  contentLength: number | undefined,
  policy: Pick<CreditPolicyResponse, "playbackCreditBytes">
) {
  if (!hasBillablePlaybackSize(contentLength)) {
    return undefined;
  }

  return Math.max(1, Math.ceil(contentLength / policy.playbackCreditBytes));
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

export const memberPasscodeLength = 6;

export function validateMemberPasscode(passcode: string) {
  if (passcode.length !== memberPasscodeLength) {
    return "通行码必须是 6 位字符。";
  }

  return undefined;
}

function isSequentialPasscode(passcode: string) {
  if (!/^[0-9A-Za-z]+$/.test(passcode)) {
    return false;
  }

  const codes = [...passcode.toLowerCase()].map((char) => char.charCodeAt(0));
  const ascending = codes.every((code, index) => index === 0 || code === codes[index - 1] + 1);
  const descending = codes.every((code, index) => index === 0 || code === codes[index - 1] - 1);
  return ascending || descending;
}

export function memberPasscodeStrengthHint(passcode: string) {
  if (validateMemberPasscode(passcode)) {
    return undefined;
  }

  const normalized = passcode.toLowerCase();
  const commonWeakPasscodes = new Set([
    "000000",
    "111111",
    "123123",
    "123456",
    "654321",
    "666666",
    "888888",
    "abcdef",
    "qwerty"
  ]);
  const repeatedPattern = /^(.{1,3})\1+$/u.test(passcode);
  if (commonWeakPasscodes.has(normalized) || repeatedPattern || isSequentialPasscode(passcode)) {
    return "强度较低：请避免连续字符、重复字符、生日或常见组合。";
  }

  return "6 位通行码强度有限，请避免使用生日、手机号后几位等容易猜到的组合。";
}

export interface RegisterMemberRequest {
  inviteCode: string;
  name: string;
  passcode: string;
}

export interface RegisterMemberResponse {
  auth: AuthCheckResponse;
  code: MemberAccessCode;
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
