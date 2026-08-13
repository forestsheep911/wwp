import "./env.js";
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { URL } from "node:url";
import {
  durationMs,
  errorLogFields,
  logError,
  logInfo,
  logWarn,
  type AdminLoginAuditEntry,
  type AdminLoginAuditResponse,
  type AdminCacheJobsResponse,
  type AccessRole,
  type AdjustMemberCreditsRequest,
  type AuthCheckResponse,
  type CacheAsset,
  type CacheJob,
  type CacheStatus,
  type CacheAssetLookupResponse,
  type CachedAssetsResponse,
  type CreateResetInvitationResponse,
  type CreateSignupInvitationRequest,
  type CreateMovieRequestRequest,
  type ChangeMemberPasscodeRequest,
  type CreditPreviewFreeReason,
  type CreditPolicyResponse,
  type CreditPreviewRequest,
  type CreditPreviewResponse,
  type CreateForumReplyRequest,
  type CreateForumThreadRequest,
  type CreateMemberNoticeRequest,
  type DeleteCacheEntryResponse,
  type DirectDownloadRequest,
  type DirectDownloadResponse,
  type EnsureCacheRequest,
  type ForumThreadResponse,
  type ForumThreadsResponse,
  type MemberAccessCode,
  type MemberInvitationListResponse,
  type MemberCreditUsageResponse,
  type MemberNoticeListResponse,
  type MediaVariant,
  type MoviePoster,
  type MovieSummaryRequest,
  type MovieRequestsResponse,
  type LibraryAssetResponse,
  type MovieRequestStatus,
  type PlaybackCapacity,
  type PlaybackLine,
  type RatingValue,
  type RegisterMemberRequest,
  type ResetMemberPasscodeRequest,
  type SearchResult,
  type SetMemberCreditsRequest,
  type UpdateMovieRequestStatusRequest,
  type UpdateMemberProfileRequest,
  cacheCreditCost,
  defaultCreditPolicy,
  invitationCodeFromInput,
  playbackCreditCost,
  validateMemberPasscode
} from "@wwpdw/shared";
import { createCacheStore, createPersonCatalogStore, createSearchIndexStore, createTspdtBrowseStore, isFreshReady } from "@wwpdw/cache-store";
import { createAccessStore, type AccessIdentity, type MemberCreditUsageList } from "./access-store.js";
import { AiSummaryConfigError, AiSummaryTimeoutError, summarizeMovie } from "./ai-summary.js";
import { isDirectMediaDownloadUrl } from "./direct-download.js";
import { stableBrowseTie } from "./browse-order.js";
import { BrowseSnapshotCache, defaultBrowseSnapshotTtlMs } from "./browse-snapshot.js";
import { CacheWorkerTrigger } from "./job-trigger.js";
import { getNowPlaying } from "./now-playing-source.js";
import { createSearchSource } from "./search-source.js";
import { refreshAssetInputFromJob, refreshAssetInputFromResult } from "./cache-source-refresh.js";
import { applyCors, clearSessionCookie, csrfValid, readCookie, requestOrigin, sessionCookie } from "./auth-http.js";
import { internalServerErrorPayload } from "./api-error.js";
import { AliyunOssPocUnavailableError, createAliyunOssPoc } from "./aliyun-oss-poc.js";
import { AliyunFcPrepare } from "./aliyun-fc-prepare.js";
import { AliyunOssStorage, type OssMultipartProgress } from "./aliyun-oss-storage.js";
import {
  createOssPreparationStore,
  OssPreparationCleanupClaimedError,
  type OssPreparationJob
} from "./oss-preparation-store.js";
import { createSessionStore, type AuthenticatedSession, type SessionSubject } from "./session-store.js";
import { inferVideoCodec, videoCodecForAsset } from "./playback-codec.js";
import { PlaybackAdmissionQueue, playbackRequiresLocalAdmission } from "./playback-admission.js";
import { mergePreparedLineAssets } from "./playback-lines.js";
import { serveStaticWeb } from "./static-web.js";
import { getPublicPerson, listPublicPeople, listPublicPersonIssues } from "./person-service.js";
import { buildSiteStatistics, type SiteStatistics } from "./site-statistics.js";

const port = Number(process.env.API_PORT ?? 8787);
const store = createCacheStore();
const searchIndex = createSearchIndexStore();
const personCatalog = createPersonCatalogStore();
const tspdtBrowseStore = createTspdtBrowseStore();
const accessStore = createAccessStore();
const sessionStore = createSessionStore();
const workerTrigger = new CacheWorkerTrigger();
const aliyunOssPoc = createAliyunOssPoc();
const aliyunFcPrepare = new AliyunFcPrepare();
const aliyunOssStorage = new AliyunOssStorage();
const ossPreparationStore = createOssPreparationStore();
const searchSource = createSearchSource();
const recentResults = new Map<string, SearchResult>();
const recentResultLimit = 200;
const searchResultCacheTtlMs = Math.max(0, Number(process.env.SEARCH_RESULT_CACHE_TTL_SECONDS ?? 600)) * 1000;
const searchResultCacheLimit = Math.max(1, Number(process.env.SEARCH_RESULT_CACHE_LIMIT ?? 100));
const searchIndexEnabled = (process.env.SEARCH_INDEX_ENABLED ?? "true").toLowerCase() !== "false";
const searchIndexWriteThrough = (process.env.SEARCH_INDEX_WRITE_THROUGH ?? "true").toLowerCase() !== "false";
const searchIndexRefreshOnCache = (process.env.SEARCH_INDEX_REFRESH_ON_CACHE ?? "true").toLowerCase() !== "false";
const searchIndexRefreshMediaAssetsOnHit =
  (process.env.SEARCH_INDEX_REFRESH_MEDIA_ASSETS_ON_HIT ?? "true").toLowerCase() !== "false";
const omdbApiKey = process.env.OMDB_API_KEY?.trim();
const omdbRequestTimeoutMs = Math.max(1000, Number(process.env.OMDB_REQUEST_TIMEOUT_MS ?? 5000));
const omdbLiveEnrichEnabled = (process.env.OMDB_LIVE_ENRICH_ENABLED ?? "false").toLowerCase() === "true";
const searchIndexResultLimit = Math.min(
  100,
  Math.max(1, Math.floor(Number(process.env.SEARCH_INDEX_RESULT_LIMIT ?? process.env.NOTION_SEARCH_PAGE_SIZE ?? 8)))
);
const searchResultCache = new Map<string, {
  expiresAt: number;
  lastUsedAt: number;
  indexRevision?: string;
  results: SearchResult[];
}>();
const browseSnapshotCache = new BrowseSnapshotCache<SearchResult>(defaultBrowseSnapshotTtlMs);
const browseSourceCache = new BrowseSnapshotCache<SearchResult>(defaultBrowseSnapshotTtlMs);
const siteStatisticsCacheTtlMs = Math.max(60_000, Number(process.env.SITE_STATISTICS_CACHE_TTL_MS ?? 300_000));
let siteStatisticsCache: { expiresAt: number; value: SiteStatistics } | undefined;
let pendingSiteStatistics: Promise<SiteStatistics> | undefined;
if (searchIndexEnabled) {
  void browseSourceCache.getOrLoad("index", () => searchIndex.search("", 1_000_000)).catch((error) => {
    logWarn("api.browse.warmup_failed", errorLogFields(error));
  });
}
type BrowseChannel = "recommended" | "movie" | "tv" | "animation";
type BrowseViewId =
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
type SearchLoadStatus =
  | "disabled"
  | "hit"
  | "deduped"
  | "live"
  | "index_hit"
  | "index_miss_live"
  | "index_failed_live";
const pendingSearches = new Map<string, Promise<{
  results: SearchResult[];
  cacheStatus: SearchLoadStatus;
}>>();
const omdbCache = new Map<string, Promise<RatingValue[]>>();
const ossSourceSizeCache = new Map<string, Promise<number | undefined>>();
const ossMultipartProgressCache = new Map<string, {
  expiresAt: number;
  value: Promise<OssMultipartProgress | undefined>;
}>();
const ossMultipartProgressCacheMs = 10_000;
const ossCleanupIdleTtlDays = (() => {
  const configured = Number(process.env.CACHE_ASSET_IDLE_TTL_DAYS ?? 7);
  return Number.isFinite(configured) && configured > 0 ? configured : 7;
})();
const requestIdHeaderName = "x-request-id";
const terminalJobStatuses: CacheStatus[] = ["ready", "failed"];
const cacheMinimumCredits = Math.max(1, Math.floor(Number(process.env.MEMBER_CACHE_CREDIT_COST ?? defaultCreditPolicy.cacheCredits)));
const cacheCreditBytes = Math.max(1, Math.floor(Number(process.env.MEMBER_CACHE_CREDIT_BYTES ?? defaultCreditPolicy.cacheCreditBytes)));
const playbackReplayFreeHours = Math.max(1, Math.floor(Number(process.env.MEMBER_PLAYBACK_REPLAY_FREE_HOURS ?? defaultCreditPolicy.playbackReplayFreeHours)));
const internationalPlaybackCreditBytes = Math.max(1, Math.floor(Number(
  process.env.MEMBER_PLAYBACK_CREDIT_BYTES ?? defaultCreditPolicy.internationalPlaybackCreditBytes
)));
const domesticPlaybackCreditBytes = Math.max(1, Math.floor(Number(
  process.env.MEMBER_DOMESTIC_PLAYBACK_CREDIT_BYTES ?? defaultCreditPolicy.domesticPlaybackCreditBytes
)));
const creditBillingEnabled = !["0", "false", "no", "off"].includes(
  (process.env.WWPDW_CREDIT_BILLING_ENABLED ?? "true").toLowerCase()
);
const movieRequestStatuses: MovieRequestStatus[] = ["new", "planned", "fulfilled", "dismissed"];
const adminMovieRequestMemberId = "admin";
const adminMovieRequestMemberName = "Admin";
const forumAdminMemberId = "admin";
const forumAdminMemberName = "Admin";
const adminKey = process.env.WWPDW_ADMIN_KEY;
const playbackGrantMinutes = Math.max(5, Math.floor(Number(process.env.WWPDW_PLAYBACK_GRANT_MINUTES ?? 360)));
const maximumPlaybackStreams = Math.max(1, Math.floor(Number(process.env.WWPDW_MAX_PLAYBACK_STREAMS ?? 4)));
const localPlaybackAdmissionEnabled = Boolean(store.getMediaFile);
const playbackAdmissionQueue = new PlaybackAdmissionQueue(maximumPlaybackStreams);
let activePlaybackStreams = 0;
let preparationQueueSnapshot: {
  expiresAt: number;
  positions: Map<string, number>;
  length: number;
} | undefined;

function playbackCapacity(): PlaybackCapacity {
  if (localPlaybackAdmissionEnabled) {
    return playbackAdmissionQueue.capacity();
  }
  return {
    enabled: false,
    active: activePlaybackStreams,
    maximum: maximumPlaybackStreams,
    queued: 0,
    level: "low"
  };
}

async function preparationQueueJob(job: CacheJob) {
  if (job.status !== "queued") {
    return job;
  }
  const now = Date.now();
  if (!preparationQueueSnapshot || preparationQueueSnapshot.expiresAt <= now) {
    const queuedJobs = (await store.listActiveJobs(1_000))
      .filter((candidate) => candidate.status === "queued")
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    preparationQueueSnapshot = {
      expiresAt: now + 2_000,
      positions: new Map(queuedJobs.map((candidate, index) => [candidate.id, index + 1])),
      length: queuedJobs.length
    };
  }
  const queuePosition = preparationQueueSnapshot.positions.get(job.id);
  return queuePosition
    ? { ...job, queuePosition, queueLength: preparationQueueSnapshot.length }
    : job;
}

interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
  session?: AuthenticatedSession;
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown, headers: Record<string, string> = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function boundedHeaderValue(value: string | string[] | undefined, maxLength = 320) {
  const raw = headerValue(value)?.trim();
  return raw ? raw.slice(0, maxLength) : undefined;
}

function firstForwardedIp(value: string | undefined) {
  const first = value?.split(",")[0]?.trim();
  if (!first) {
    return undefined;
  }

  const forwardedFor = first.match(/^for="?([^";]+)"?/i)?.[1] ?? first;
  return forwardedFor.replace(/^::ffff:/, "").slice(0, 80);
}

function requestIp(request: http.IncomingMessage) {
  return firstForwardedIp(
    boundedHeaderValue(request.headers["x-forwarded-for"], 512) ??
      boundedHeaderValue(request.headers.forwarded, 512) ??
      boundedHeaderValue(request.headers["x-real-ip"]) ??
      boundedHeaderValue(request.headers["x-client-ip"]) ??
      boundedHeaderValue(request.headers["cf-connecting-ip"]) ??
      request.socket.remoteAddress
  );
}

function privateNetworkLabel(ip?: string) {
  if (!ip) {
    return undefined;
  }

  if (ip === "::1" || ip === "127.0.0.1" || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return "Private network";
  }

  const parts = ip.split(".").map(Number);
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part))) {
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return "Private network";
    }
  }

  return undefined;
}

function requestLocation(request: http.IncomingMessage, ip?: string) {
  const country = boundedHeaderValue(
    request.headers["cf-ipcountry"] ??
      request.headers["x-vercel-ip-country"] ??
      request.headers["x-appengine-country"],
    80
  );
  const region = boundedHeaderValue(
    request.headers["cf-region"] ??
      request.headers["x-vercel-ip-country-region"] ??
      request.headers["x-appengine-region"],
    120
  );
  const city = boundedHeaderValue(
    request.headers["cf-ipcity"] ??
      request.headers["x-vercel-ip-city"] ??
      request.headers["x-appengine-city"],
    120
  );
  const parts = [city, region, country].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : privateNetworkLabel(ip) ?? "Unknown";
}

function browserLabel(userAgent: string) {
  if (userAgent.includes("Edg/")) {
    return "Edge";
  }

  if (userAgent.includes("Chrome/") || userAgent.includes("CriOS/")) {
    return "Chrome";
  }

  if (userAgent.includes("Firefox/") || userAgent.includes("FxiOS/")) {
    return "Firefox";
  }

  if (userAgent.includes("Safari/")) {
    return "Safari";
  }

  return "Browser";
}

function osLabel(userAgent: string) {
  if (userAgent.includes("Windows")) {
    return "Windows";
  }

  if (userAgent.includes("iPhone") || userAgent.includes("iPad")) {
    return "iOS";
  }

  if (userAgent.includes("Android")) {
    return "Android";
  }

  if (userAgent.includes("Mac OS X")) {
    return "macOS";
  }

  if (userAgent.includes("Linux")) {
    return "Linux";
  }

  return "Device";
}

function requestDevice(request: http.IncomingMessage) {
  const userAgent = boundedHeaderValue(request.headers["user-agent"], 600);
  if (!userAgent) {
    return {
      device: "Unknown device",
      userAgent: undefined
    };
  }

  const mobile = /Mobile|Android|iPhone|iPad/i.test(userAgent) ? " mobile" : "";
  return {
    device: `${osLabel(userAgent)} / ${browserLabel(userAgent)}${mobile}`,
    userAgent
  };
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function createPlaybackGrant(assetKey: string, sessionId: string) {
  const expiresAt = Date.now() + playbackGrantMinutes * 60 * 1000;
  const payload = `${assetKey}\n${sessionId}\n${expiresAt}`;
  const signature = createHmac("sha256", adminKey ?? "wwpdw-unconfigured")
    .update(payload)
    .digest("base64url");
  return `${expiresAt}.${signature}`;
}

function playbackGrantValid(grant: string | null, assetKey: string, sessionId: string) {
  const [expiresValue, suppliedSignature, extra] = grant?.split(".") ?? [];
  if (!expiresValue || !suppliedSignature || extra) return false;
  const expiresAt = Number(expiresValue);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) return false;
  const payload = `${assetKey}\n${sessionId}\n${expiresAt}`;
  const expectedSignature = createHmac("sha256", adminKey ?? "wwpdw-unconfigured")
    .update(payload)
    .digest("base64url");
  return safeEqual(suppliedSignature, expectedSignature);
}

function isAdminKey(value: string | undefined) {
  if (!adminKey || !value) {
    return false;
  }

  return safeEqual(value, adminKey);
}

function requestIdFromHeader(request: http.IncomingMessage) {
  const suppliedRequestId = headerValue(request.headers[requestIdHeaderName]);
  return suppliedRequestId && suppliedRequestId.length <= 128 ? suppliedRequestId : randomUUID();
}

async function resolveAccess(request: http.IncomingMessage): Promise<AccessIdentity | undefined> {
  const session = await sessionStore.authenticate(readCookie(request));
  if (!session) return undefined;
  const subject = session.subject;
  return subject.role === "admin"
    ? { role: "admin" }
    : accessStore.getMemberIdentity(subject.memberId);
}

async function requireAccess(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
): Promise<AccessIdentity | undefined> {
  if (!adminKey) {
    logError("api.auth.missing_config", {
      requestId: context.requestId,
      path: context.path
    });
    sendJson(response, 503, { error: "Access key is not configured." });
    return undefined;
  }

  const session = await sessionStore.authenticate(readCookie(request));
  const identity = session?.subject.role === "admin"
    ? { role: "admin" as const }
    : session?.subject.role === "member"
      ? await accessStore.getMemberIdentity(session.subject.memberId)
      : undefined;
  if (!identity) {
    if (session) await sessionStore.revoke(session.id, "member_unavailable");
    logWarn("api.auth.denied", {
      requestId: context.requestId,
      path: context.path
    });
    sendJson(response, 401, { error: "Access key did not match." });
    return undefined;
  }

  context.session = session!;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method ?? "") && (!requestOrigin(request) || !csrfValid(request, session!.csrfToken))) {
    sendJson(response, 403, { error: "Cross-site request verification failed." });
    return undefined;
  }

  return identity;
}

function requireAdmin(
  identity: AccessIdentity | undefined,
  response: http.ServerResponse,
  context: RequestContext
) {
  if (identity?.role === "admin") {
    return true;
  }

  logWarn("api.auth.admin_denied", {
    requestId: context.requestId,
    path: context.path,
    role: identity?.role
  });
  sendJson(response, 403, { error: "Administrator access is required." });
  return false;
}

function authPayload(identity: AccessIdentity): AuthCheckResponse {
  return {
    ok: true,
    role: identity.role as AccessRole,
    member: identity.role === "member" && identity.memberId && identity.memberName
      ? {
        id: identity.memberId,
        name: identity.memberName,
        credits: identity.credits
      }
      : undefined
  };
}

function forumAuthor(identity: AccessIdentity) {
  return identity.role === "admin"
    ? {
      role: "admin" as const,
      memberId: forumAdminMemberId,
      memberName: forumAdminMemberName
    }
    : {
      role: "member" as const,
      memberId: identity.memberId,
      memberName: identity.memberName
    };
}

function memberIdentityFromCode(code: Pick<MemberAccessCode, "id" | "name" | "credits">): AccessIdentity {
  return {
    role: "member",
    memberId: code.id,
    memberName: code.name,
    credits: code.credits
  };
}

function sessionSubject(identity: AccessIdentity): SessionSubject {
  return identity.role === "admin"
    ? { role: "admin", authProvider: "passcode" }
    : { role: "member", memberId: identity.memberId!, memberName: identity.memberName!, authProvider: "passcode" };
}

async function sendAuthenticatedSession(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  statusCode: number,
  identity: AccessIdentity,
  payload: Record<string, unknown> = {}
) {
  const device = requestDevice(request);
  const issued = await sessionStore.create(sessionSubject(identity), { ipAddress: requestIp(request), device: device.device, userAgent: device.userAgent });
  sendJson(response, statusCode, { ...payload, auth: authPayload(identity), csrfToken: issued.csrfToken }, { "Set-Cookie": sessionCookie(issued.cookieValue, issued.record.idleExpiresAt) });
}

function passcodeValidationError(passcode: string) {
  return validateMemberPasscode(passcode) ?? (isAdminKey(passcode) ? "通行码不能和管理员密钥相同。" : undefined);
}

function sendPasscodeUpdateError(
  result: { ok: false; reason: "not_found" | "duplicate" | "invalid_current" },
  response: http.ServerResponse
) {
  if (result.reason === "not_found") {
    sendJson(response, 404, { error: "Member was not found." });
    return;
  }

  if (result.reason === "invalid_current") {
    sendJson(response, 403, { error: "当前通行码不正确。" });
    return;
  }

  sendJson(response, 409, { error: "这个通行码已经被使用，请换一个。" });
}

function sendInvitationClaimError(
  reason: "duplicate" | "invalid_invite" | "not_found",
  response: http.ServerResponse
) {
  if (reason === "invalid_invite") {
    sendJson(response, 403, { error: "邀请码无效、已使用或已过期。" });
    return;
  }

  if (reason === "not_found") {
    sendJson(response, 404, { error: "成员不存在，请重新向管理员索取重置码。" });
    return;
  }

  sendJson(response, 409, { error: "这个通行码已经被使用，请换一个。" });
}

function loginAuditEntry(
  request: http.IncomingMessage,
  identity: AccessIdentity,
  requestId: string
): AdminLoginAuditEntry {
  const ipAddress = requestIp(request);
  const device = requestDevice(request);
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    role: identity.role as AccessRole,
    memberId: identity.memberId,
    memberName: identity.memberName,
    ipAddress,
    ipLocation: requestLocation(request, ipAddress),
    device: device.device,
    userAgent: device.userAgent,
    requestId
  };
}

async function recordLoginAudit(request: http.IncomingMessage, identity: AccessIdentity, context: RequestContext) {
  const entry = loginAuditEntry(request, identity, context.requestId);
  try {
    await accessStore.recordLoginAudit(entry);
    logInfo("api.auth.login_audit.record", {
      requestId: context.requestId,
      auditId: entry.id,
      role: entry.role,
      memberId: entry.memberId,
      ipAddress: entry.ipAddress,
      ipLocation: entry.ipLocation,
      device: entry.device
    });
  } catch (error) {
    logWarn("api.auth.login_audit.record_failed", {
      requestId: context.requestId,
      role: entry.role,
      memberId: entry.memberId,
      ...errorLogFields(error)
    });
  }
}

async function readBody<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function rememberResults(results: SearchResult[]) {
  results.forEach((item) => {
    recentResults.set(item.assetKey, item);
    item.variants?.forEach((variant) =>
      recentResults.set(variant.assetKey, variantToSearchResult(item, variant))
    );
  });

  while (recentResults.size > recentResultLimit) {
    const firstKey = recentResults.keys().next().value;
    if (!firstKey) {
      break;
    }
    recentResults.delete(firstKey);
  }
}

function variantToSearchResult(result: SearchResult, variant: MediaVariant): SearchResult {
  return {
    assetKey: variant.assetKey,
    title: `${result.title} / ${variant.label}`,
    source: result.source,
    sourceUrl: variant.sourceUrl,
    sourcePageId: variant.sourcePageId ?? result.sourcePageId,
    sourceBreadcrumb: variant.sourceBreadcrumb ?? result.sourceBreadcrumb,
    durationLabel: result.durationLabel,
    updatedAt: result.updatedAt,
    summary: variant.summary,
    metadata: {
      ...result.metadata,
      ...variant.metadata
    }
  };
}

function findSearchResultByAssetKey(results: SearchResult[], assetKey: string) {
  for (const result of results) {
    if (result.assetKey === assetKey) {
      return result;
    }

    const variant = result.variants?.find((item) => item.assetKey === assetKey);
    if (variant) {
      return variantToSearchResult(result, variant);
    }
  }

  return undefined;
}

async function playbackVideoCodec(assetKey: string, jobId?: string) {
  const recentCodec = videoCodecForAsset(recentResults.values(), assetKey);
  if (recentCodec) {
    return recentCodec;
  }

  const job = jobId ? await store.getJob(jobId) : undefined;
  const inferredCodec = inferVideoCodec(job?.sourceUrl, job?.resolve?.url, job?.title);
  if (inferredCodec) {
    return inferredCodec;
  }

  const indexedResults = await searchIndex.search(assetKey, 8);
  return videoCodecForAsset(indexedResults, assetKey);
}

function searchCacheKey(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function cloneSearchResults(results: SearchResult[]) {
  return JSON.parse(JSON.stringify(results)) as SearchResult[];
}

function normalizedRatingSource(label: string) {
  if (/douban|豆瓣/i.test(label)) {
    return "douban";
  }
  if (/imdb|internet movie database/i.test(label)) {
    return "imdb";
  }
  if (/^rt$|rotten|tomato/i.test(label)) {
    return "rotten";
  }
  if (/^meta$|metacritic|metascore/i.test(label)) {
    return "metacritic";
  }
  return label.trim().toLowerCase();
}

function cleanOmdbRatingValue(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text === "N/A") {
    return "";
  }
  return text
    .replace(/\/10$/i, "")
    .replace(/\/100$/i, "")
    .replace(/%$/, "")
    .trim();
}

function omdbRatingLabel(source: string) {
  if (/internet movie database|imdb/i.test(source)) {
    return "IMDb";
  }
  if (/rotten tomatoes/i.test(source)) {
    return "RT";
  }
  if (/metacritic/i.test(source)) {
    return "Meta";
  }
  return source;
}

function ratingsFromOmdbPayload(payload: unknown) {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const ratings: RatingValue[] = [];
  const sourceRatings = Array.isArray(record.Ratings) ? record.Ratings : [];
  for (const item of sourceRatings) {
    const rating = item && typeof item === "object" ? item as Record<string, unknown> : {};
    const source = typeof rating.Source === "string" ? rating.Source : "";
    const value = cleanOmdbRatingValue(rating.Value);
    if (source && value) {
      ratings.push({
        label: omdbRatingLabel(source),
        value
      });
    }
  }

  const imdbRating = cleanOmdbRatingValue(record.imdbRating);
  if (imdbRating && !ratings.some((rating) => normalizedRatingSource(rating.label) === "imdb")) {
    ratings.push({ label: "IMDb", value: imdbRating });
  }

  const metascore = cleanOmdbRatingValue(record.Metascore);
  if (metascore && !ratings.some((rating) => normalizedRatingSource(rating.label) === "metacritic")) {
    ratings.push({ label: "Meta", value: metascore });
  }

  return ratings;
}

function ratingsFromStoredOmdb(result: SearchResult) {
  const omdb = result.metadata?.external?.omdb;
  if (!omdb) {
    return [];
  }

  const ratings = (omdb.ratings ?? [])
    .map((rating) => ({
      label: omdbRatingLabel(rating.label),
      value: cleanOmdbRatingValue(rating.value)
    }))
    .filter((rating): rating is RatingValue => Boolean(rating.label && rating.value));

  const imdbRating = cleanOmdbRatingValue(omdb.imdbRating);
  if (imdbRating && !ratings.some((rating) => normalizedRatingSource(rating.label) === "imdb")) {
    ratings.push({ label: "IMDb", value: imdbRating });
  }

  const metascore = cleanOmdbRatingValue(omdb.metascore);
  if (metascore && !ratings.some((rating) => normalizedRatingSource(rating.label) === "metacritic")) {
    ratings.push({ label: "Meta", value: metascore });
  }

  return ratings;
}

async function fetchOmdbPayload(imdbId: string) {
  if (!omdbApiKey) {
    return undefined;
  }

  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("i", imdbId);
  url.searchParams.set("apikey", omdbApiKey);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(omdbRequestTimeoutMs)
  });
  if (!response.ok) {
    throw new Error(`OMDb request failed with ${response.status}`);
  }

  const payload = await response.json() as Record<string, unknown>;
  return payload.Response === "False" ? undefined : payload;
}

async function fetchOmdbRatings(imdbId: string): Promise<RatingValue[]> {
  const payload = await fetchOmdbPayload(imdbId);
  if (!payload) {
    return [];
  }

  const ratings = ratingsFromOmdbPayload(payload);
  if (ratings.length > 0) {
    return ratings;
  }

  const seriesId = typeof payload.seriesID === "string" ? payload.seriesID : "";
  if (seriesId && seriesId !== imdbId) {
    const seriesPayload = await fetchOmdbPayload(seriesId);
    return seriesPayload ? ratingsFromOmdbPayload(seriesPayload) : [];
  }

  return [];
}

async function cachedOmdbRatings(imdbId: string) {
  if (!omdbApiKey || !/^tt\d+/i.test(imdbId)) {
    return [];
  }

  if (!omdbCache.has(imdbId)) {
    omdbCache.set(
      imdbId,
      fetchOmdbRatings(imdbId).catch((error) => {
        logWarn("api.omdb.rating_enrich_failed", {
          imdbId,
          ...errorLogFields(error)
        });
        return [];
      })
    );
  }

  return omdbCache.get(imdbId) ?? Promise.resolve([]);
}

async function enrichResultRatings(result: SearchResult): Promise<SearchResult> {
  const rawRatings = result.metadata?.ratings ?? [];
  const currentRatings = rawRatings.filter((rating) => rating.label && rating.value);
  const cleanedResult = currentRatings.length === rawRatings.length
    ? result
    : {
      ...result,
      metadata: {
        ...result.metadata,
        ratings: currentRatings
      }
    };
  const seenSources = new Set(currentRatings.map((rating) => normalizedRatingSource(rating.label)));
  const mergedRatings = [...currentRatings];
  const storedOmdbRatings = ratingsFromStoredOmdb(result);
  for (const rating of storedOmdbRatings) {
    const source = normalizedRatingSource(rating.label);
    if (!seenSources.has(source)) {
      mergedRatings.push(rating);
      seenSources.add(source);
    }
  }

  const imdbId = result.metadata?.imdbId ?? result.metadata?.externalIds?.imdb;
  if (omdbLiveEnrichEnabled && imdbId) {
    const omdbRatings = await cachedOmdbRatings(imdbId);
    for (const rating of omdbRatings) {
      const source = normalizedRatingSource(rating.label);
      if (!seenSources.has(source)) {
        mergedRatings.push(rating);
        seenSources.add(source);
      }
    }
  }

  if (mergedRatings.length === currentRatings.length) {
    return cleanedResult;
  }

  return {
    ...cleanedResult,
    metadata: {
      ...cleanedResult.metadata,
      ratings: mergedRatings.slice(0, 4)
    }
  };
}

function pruneSearchResultCache(now = Date.now()) {
  for (const [key, entry] of searchResultCache) {
    if (entry.expiresAt <= now) {
      searchResultCache.delete(key);
    }
  }

  while (searchResultCache.size > searchResultCacheLimit) {
    const oldest = [...searchResultCache.entries()]
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt)[0];
    if (!oldest) {
      break;
    }
    searchResultCache.delete(oldest[0]);
  }
}

async function loadSearchResults(query: string): Promise<{
  results: SearchResult[];
  cacheStatus: SearchLoadStatus;
}> {
  if (searchResultCacheTtlMs <= 0) {
    return loadSearchResultsFromPersistentSources(query, "disabled");
  }

  const key = searchCacheKey(query);
  const now = Date.now();
  const cached = searchResultCache.get(key);
  if (cached && cached.expiresAt > now) {
    const currentRevision = await searchIndex.getRevision();
    if (currentRevision === cached.indexRevision) {
      cached.lastUsedAt = now;
      const cachedResults = await refreshIndexedMediaAssetResults(query, cached.results);
      cached.results = cloneSearchResults(cachedResults);
      return {
        results: cloneSearchResults(cachedResults),
        cacheStatus: "hit"
      };
    }
    searchResultCache.delete(key);
  }

  const pending = pendingSearches.get(key);
  if (pending) {
    const pendingLoad = await pending;
    return {
      results: cloneSearchResults(pendingLoad.results),
      cacheStatus: "deduped"
    };
  }

  const nextSearch = loadSearchResultsFromPersistentSources(query)
    .then(async (searchLoad) => {
      const indexRevision = await searchIndex.getRevision();
      searchResultCache.set(key, {
        expiresAt: Date.now() + searchResultCacheTtlMs,
        lastUsedAt: Date.now(),
        indexRevision,
        results: cloneSearchResults(searchLoad.results)
      });
      pruneSearchResultCache();
      return searchLoad;
    })
    .finally(() => {
      pendingSearches.delete(key);
    });

  pendingSearches.set(key, nextSearch);
  const searchLoad = await nextSearch;
  return {
    results: cloneSearchResults(searchLoad.results),
    cacheStatus: searchLoad.cacheStatus
  };
}

async function writeSearchResultsToIndex(results: SearchResult[], context: string) {
  if (!searchIndexEnabled || !searchIndexWriteThrough || results.length === 0) {
    return;
  }

  try {
    await searchIndex.upsertResults(results);
  } catch (error) {
    logWarn("api.search.index_write_failed", {
      context,
      resultCount: results.length,
      ...errorLogFields(error)
    });
  }
}

function resultHasMediaAssetsVariants(result: SearchResult) {
  return result.variants?.some((variant) => variant.metadata?.structuredSource === "media_assets") === true;
}

function resultNeedsSourceRefreshOnHit(result: SearchResult) {
  return Boolean(result.sourcePageId) && !resultHasMediaAssetsVariants(result);
}

function posterStableKey(poster: MoviePoster) {
  return poster.originalUrl ?? poster.url ?? poster.blobName;
}

function isCachedBlobPoster(poster: MoviePoster) {
  return poster.source === "blob" && Boolean(poster.blobName);
}

function mergeCachedPosters(existing: SearchResult, refreshed: SearchResult) {
  const existingPosters = existing.metadata?.posters ?? [];
  const cachedPostersByKey = new Map(
    existingPosters
      .filter(isCachedBlobPoster)
      .map((poster) => [posterStableKey(poster), poster] as const)
      .filter(([key]) => Boolean(key))
  );
  if (cachedPostersByKey.size === 0) {
    return refreshed;
  }

  const seen = new Set<string>();
  const posters: MoviePoster[] = [];
  for (const poster of refreshed.metadata?.posters ?? []) {
    const key = posterStableKey(poster);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    posters.push(cachedPostersByKey.get(key) ?? poster);
  }

  return {
    ...refreshed,
    metadata: {
      ...refreshed.metadata,
      posterUrl: posters.find(isCachedBlobPoster)?.url ?? refreshed.metadata?.posterUrl,
      posters
    }
  };
}

async function refreshIndexedMediaAssetResults(query: string, results: SearchResult[]) {
  if (!searchIndexRefreshMediaAssetsOnHit || !searchSource.refreshAsset || results.length === 0) {
    return results;
  }

  const refreshAsset = searchSource.refreshAsset.bind(searchSource);
  let refreshedCount = 0;
  const refreshedResults = await Promise.all(results.map(async (result) => {
    if (!resultNeedsSourceRefreshOnHit(result)) {
      return result;
    }

    try {
      const refreshed = await refreshAsset({
        assetKey: result.assetKey,
        sourcePageId: result.sourcePageId,
        title: result.title,
        sourceBreadcrumb: result.sourceBreadcrumb
      });

      if (refreshed) {
        refreshedCount += 1;
        return mergeCachedPosters(result, refreshed);
      }
    } catch (error) {
      logWarn("api.search.index_media_assets_refresh_failed", {
        query,
        assetKey: result.assetKey,
        sourcePageId: result.sourcePageId,
        ...errorLogFields(error)
      });
    }

    return result;
  }));

  if (refreshedCount > 0) {
    void writeSearchResultsToIndex(
      refreshedResults,
      "index_hit_media_assets_refresh"
    );
    logInfo("api.search.index_media_assets_refreshed", {
      query,
      refreshedCount,
      resultCount: refreshedResults.length
    });
  }

  return refreshedResults;
}

async function loadSearchResultsFromPersistentSources(
  query: string,
  disabledStatus: SearchLoadStatus = "live"
): Promise<{
  results: SearchResult[];
  cacheStatus: SearchLoadStatus;
}> {
  if (searchIndexEnabled) {
    try {
      const indexedResults = await searchIndex.search(query, searchIndexResultLimit);
      if (indexedResults.length > 0) {
        return {
          results: await refreshIndexedMediaAssetResults(query, indexedResults),
          cacheStatus: "index_hit"
        };
      }
    } catch (error) {
      logWarn("api.search.index_read_failed", {
        query,
        ...errorLogFields(error)
      });
      const liveResults = await searchSource.search(query);
      void writeSearchResultsToIndex(liveResults, "index_read_failed_live");
      return {
        results: liveResults,
        cacheStatus: "index_failed_live"
      };
    }

    const liveResults = await searchSource.search(query);
    void writeSearchResultsToIndex(liveResults, "index_miss_live");
    return {
      results: liveResults,
      cacheStatus: "index_miss_live"
    };
  }

  return {
    results: await searchSource.search(query),
    cacheStatus: disabledStatus
  };
}

function retrySearchQuery(job: CacheJob) {
  const breadcrumbTitle = job.sourceBreadcrumb?.[0]?.trim();
  if (breadcrumbTitle) {
    return breadcrumbTitle;
  }

  return job.title.split(" / ")[0]?.trim() || job.title.trim();
}

async function refreshRetrySource(job: CacheJob, context: RequestContext) {
  const startedAt = Date.now();
  let method = searchSource.refreshAsset ? "source_page" : "title_search";
  let fallbackQuery: string | undefined;
  let fallbackResultCount: number | undefined;
  let hintResult: SearchResult | undefined;

  logInfo("api.admin.cache_jobs.retry_source_refresh_start", {
    requestId: context.requestId,
    jobId: job.id,
    assetKey: job.assetKey,
    sourcePageId: job.sourcePageId,
    sourceMediaBlockId: job.sourceMediaBlockId,
    breadcrumbDepth: job.sourceBreadcrumb?.length,
    method
  });

  try {
    if (!job.sourceMediaBlockId) {
      fallbackQuery = retrySearchQuery(job);
      const results = await searchSource.search(fallbackQuery);
      fallbackResultCount = results.length;
      rememberResults(results);
      hintResult = findSearchResultByAssetKey(results, job.assetKey);
    }

    let refreshed = searchSource.refreshAsset
      ? await searchSource.refreshAsset(refreshAssetInputFromJob(job, hintResult))
      : undefined;

    if (!refreshed) {
      method = searchSource.refreshAsset ? "source_page_then_title_search" : "title_search";
      if (!fallbackQuery) {
        fallbackQuery = retrySearchQuery(job);
        const results = await searchSource.search(fallbackQuery);
        fallbackResultCount = results.length;
        rememberResults(results);
        hintResult = findSearchResultByAssetKey(results, job.assetKey);
      }
      refreshed = hintResult;
    }

    if (!refreshed) {
      logWarn("api.admin.cache_jobs.retry_source_refresh_miss", {
        requestId: context.requestId,
        jobId: job.id,
        assetKey: job.assetKey,
        sourcePageId: job.sourcePageId,
        method,
        fallbackQuery,
        fallbackResultCount,
        durationMs: durationMs(startedAt)
      });
      return undefined;
    }

    recentResults.set(refreshed.assetKey, refreshed);
    logInfo("api.admin.cache_jobs.retry_source_refresh_hit", {
      requestId: context.requestId,
      jobId: job.id,
      assetKey: job.assetKey,
      refreshedAssetKey: refreshed.assetKey,
      sourcePageId: refreshed.sourcePageId,
      sourceMediaBlockId: (refreshed.metadata as { mediaBlockId?: string } | undefined)?.mediaBlockId,
      breadcrumbDepth: refreshed.sourceBreadcrumb?.length,
      method,
      sourceUrlChanged: refreshed.sourceUrl !== job.sourceUrl,
      durationMs: durationMs(startedAt)
    });

    return refreshed;
  } catch (error) {
    logError("api.admin.cache_jobs.retry_source_refresh_failed", {
      requestId: context.requestId,
      jobId: job.id,
      assetKey: job.assetKey,
      sourcePageId: job.sourcePageId,
      method,
      fallbackQuery,
      durationMs: durationMs(startedAt),
      ...errorLogFields(error)
    });
    return undefined;
  }
}

async function refreshResultSource(
  result: SearchResult,
  context: RequestContext,
  options: { logPrefix: string; indexReason: string }
): Promise<{ result: SearchResult; sourceRefreshed: boolean }> {
  const refreshInput = refreshAssetInputFromResult(result);
  if (!searchSource.refreshAsset || (!refreshInput.sourcePageId && !refreshInput.mediaBlockId)) {
    return {
      result,
      sourceRefreshed: false
    };
  }

  const startedAt = Date.now();
  try {
    const refreshed = await searchSource.refreshAsset(refreshInput);

    if (!refreshed) {
      logWarn(`${options.logPrefix}.source_refresh_miss`, {
        requestId: context.requestId,
        assetKey: result.assetKey,
        sourcePageId: result.sourcePageId,
        durationMs: durationMs(startedAt)
      });
      return {
        result,
        sourceRefreshed: false
      };
    }

    if (downloadUrlIsExpired(refreshed.sourceUrl)) {
      logWarn(`${options.logPrefix}.source_refresh_expired_url`, {
        requestId: context.requestId,
        assetKey: result.assetKey,
        refreshedAssetKey: refreshed.assetKey,
        sourcePageId: refreshed.sourcePageId,
        expiresAt: downloadUrlExpiresAt(refreshed.sourceUrl),
        durationMs: durationMs(startedAt)
      });
      return {
        result: refreshed,
        sourceRefreshed: false
      };
    }

    recentResults.set(refreshed.assetKey, refreshed);
    void writeSearchResultsToIndex([refreshed], options.indexReason);
    logInfo(`${options.logPrefix}.source_refresh_hit`, {
      requestId: context.requestId,
      assetKey: result.assetKey,
      refreshedAssetKey: refreshed.assetKey,
      sourcePageId: refreshed.sourcePageId,
      sourceMediaBlockId: (refreshed.metadata as { mediaBlockId?: string } | undefined)?.mediaBlockId,
      sourceUrlChanged: refreshed.sourceUrl !== result.sourceUrl,
      durationMs: durationMs(startedAt)
    });

    return {
      result: refreshed,
      sourceRefreshed: true
    };
  } catch (error) {
    logWarn(`${options.logPrefix}.source_refresh_failed`, {
      requestId: context.requestId,
      assetKey: result.assetKey,
      sourcePageId: result.sourcePageId,
      durationMs: durationMs(startedAt),
      ...errorLogFields(error)
    });
    return {
      result,
      sourceRefreshed: false
    };
  }
}

async function refreshResultBeforeCache(result: SearchResult, context: RequestContext) {
  if (!searchIndexRefreshOnCache) {
    return result;
  }

  return (await refreshResultSource(result, context, {
    logPrefix: "api.cache",
    indexReason: "cache_source_refresh"
  })).result;
}

function visibleCacheAsset<T extends { status: string; expiresAt?: string; playbackUrl?: string }>(
  asset: T | undefined
) {
  if (asset?.status === "ready" && !isFreshReady(asset)) {
    return undefined;
  }

  return asset;
}

function requestPlaybackLine(value: string | null | undefined): PlaybackLine {
  return value === "domestic" ? "domestic" : "international";
}

function optionalPlaybackLine(value: string | null | undefined): PlaybackLine | undefined {
  return value === "domestic" || value === "international" ? value : undefined;
}

function ossCacheStatus(job: OssPreparationJob): CacheStatus {
  if (job.status === "ready") return "ready";
  if (job.status === "failed" || job.status === "cancelled") return "failed";
  if (job.status === "queued") return "queued";
  return "downloading";
}

function ossJobToCacheAsset(job: OssPreparationJob): CacheAsset {
  const status = ossCacheStatus(job);
  return {
    assetKey: job.assetKey,
    title: job.title,
    source: "aliyun-oss",
    status,
    jobId: job.id,
    playbackUrl: status === "ready" ? `/api/oss-playback/${encodeURIComponent(job.id)}/media` : undefined,
    cachedAt: job.completedAt,
    lastPlayedAt: job.lastPlayedAt,
    expiresAt: job.expiresAt,
    lastRequestedAt: job.updatedAt,
    media: {
      checkedAt: job.updatedAt,
      contentLength: job.contentLength ?? job.expectedBytes,
      contentType: job.contentType ?? "video/mp4",
      rangeSupported: status === "ready"
    },
    line: "domestic"
  };
}

function ossIdleExpiresAt(reference: string) {
  const expiresAt = new Date(reference);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + ossCleanupIdleTtlDays);
  return expiresAt.toISOString();
}

async function markOssPlayback(job: OssPreparationJob) {
  const playedAt = new Date().toISOString();
  const updated = await ossPreparationStore.markPlayed(job.id, playedAt, ossIdleExpiresAt(playedAt));
  if (!updated) throw new Error("OSS preparation no longer exists.");
  return updated;
}

function ossJobToCacheJob(job: OssPreparationJob): CacheJob {
  return {
    id: job.id,
    assetKey: job.assetKey,
    title: job.title,
    source: "notion",
    status: ossCacheStatus(job),
    progress: job.progress,
    progressDeterminate: job.progressDeterminate,
    transferredBytes: job.transferredBytes,
    expectedBytes: job.expectedBytes,
    partCount: job.partCount,
    lastProgressAt: job.lastProgressAt,
    message: job.message,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    error: job.error,
    line: "domestic"
  };
}

async function syncedOssJobByAssetKey(assetKey: string) {
  const job = await ossPreparationStore.findByAssetKey(assetKey);
  return job ? syncOssPreparationJob(job) : undefined;
}

async function ossAssetsFor(assetKeys: string[]) {
  const wanted = new Set(assetKeys);
  const selected = new Map<string, OssPreparationJob>();
  for (const job of await ossPreparationStore.list(1_000)) {
    if (wanted.has(job.assetKey) && !selected.has(job.assetKey)) {
      selected.set(job.assetKey, job);
    }
  }
  const entries = await Promise.all(Array.from(selected, async ([assetKey, job]) => {
    const synced = await syncOssPreparationJob(job).catch(() => job);
    return [assetKey, ossJobToCacheAsset(synced)] as const;
  }));
  return Object.fromEntries(entries) as Record<string, CacheAsset>;
}

function preparedAssetForLines(
  domesticAsset?: CacheAsset,
  internationalAsset?: CacheAsset
): CacheAsset | undefined {
  const visibleDomestic = visibleCacheAsset(domesticAsset);
  const visibleInternational = visibleCacheAsset(internationalAsset);
  return mergePreparedLineAssets(visibleDomestic, visibleInternational);
}

async function cacheAssetsForLines(assetKeys: string[], line?: PlaybackLine) {
  if (line === "domestic") {
    const assets = await ossAssetsFor(assetKeys);
    return Object.fromEntries(Object.entries(assets).map(([assetKey, asset]) => [
      assetKey,
      {
        ...asset,
        line,
        preparedLines: asset.status === "ready" ? [line] : []
      }
    ])) as Record<string, CacheAsset>;
  }
  if (line === "international") {
    const assets = await store.listAssets(assetKeys);
    return Object.fromEntries(Object.entries(assets).flatMap(([assetKey, asset]) => {
      const visible = visibleCacheAsset(asset);
      return visible
        ? [[
          assetKey,
          {
            ...visible,
            line,
            preparedLines: visible.status === "ready" ? [line] : []
          }
        ] as const]
        : [];
    })) as Record<string, CacheAsset>;
  }

  const [domesticAssets, internationalAssets] = await Promise.all([
    ossAssetsFor(assetKeys),
    store.listAssets(assetKeys)
  ]);
  return Object.fromEntries(assetKeys.flatMap((assetKey) => {
    const asset = preparedAssetForLines(
      domesticAssets[assetKey],
      internationalAssets[assetKey]
        ? { ...internationalAssets[assetKey], line: "international" }
        : undefined
    );
    return asset ? [[assetKey, asset] as const] : [];
  })) as Record<string, CacheAsset>;
}

async function handleSearch(url: URL, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const query = url.searchParams.get("q")?.trim() ?? "";
  const searchLoad = await loadSearchResults(query);
  const searchResults = searchLoad.results;
  rememberResults(searchResults);
  const line = optionalPlaybackLine(url.searchParams.get("line"));
  const results = await enrichResultsWithCache(searchResults, line);

  logInfo("api.search", {
    requestId: context.requestId,
    query,
    resultCount: results.length,
    variantCount: results.reduce((count, item) => count + (item.variants?.length ?? 0), 0),
    searchCache: searchLoad.cacheStatus,
    searchCacheEntries: searchResultCache.size,
    durationMs: durationMs(startedAt)
  });

  sendJson(response, 200, { results });
}

async function handleLibraryAsset(assetKey: string, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const searchLoad = await loadSearchResults(assetKey);
  const result = findSearchResultByAssetKey(searchLoad.results, assetKey);
  if (!result) {
    sendJson(response, 404, { error: "片目不存在或已不再公开。" });
    return;
  }

  rememberResults([result]);
  const [enriched] = await enrichResultsWithCache([result]);
  const payload: LibraryAssetResponse = { result: enriched };

  logInfo("api.library_asset.lookup", {
    requestId: context.requestId,
    assetKey,
    searchCache: searchLoad.cacheStatus,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, payload);
}

async function handleMovieSummary(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const body = await readBody<MovieSummaryRequest>(request);
  if ((body.mode !== "spoiler_free" && body.mode !== "spoiler") || !body.result?.assetKey) {
    sendJson(response, 400, { error: "Movie summary requires a mode and result." });
    return;
  }

  try {
    const summary = await summarizeMovie(body);
    logInfo("api.movie_summary", {
      requestId: context.requestId,
      role: identity.role,
      memberId: identity.memberId,
      assetKey: body.result.assetKey,
      mode: body.mode,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 200, summary);
  } catch (error) {
    logWarn("api.movie_summary.failed", {
      requestId: context.requestId,
      role: identity.role,
      memberId: identity.memberId,
      assetKey: body.result.assetKey,
      mode: body.mode,
      durationMs: durationMs(startedAt),
      ...errorLogFields(error)
    });
    if (error instanceof AiSummaryConfigError) {
      sendJson(response, 503, { error: "AI summary is not configured." });
      return;
    }

    if (error instanceof AiSummaryTimeoutError) {
      sendJson(response, 504, { error: "AI 摘要超时，请稍后再试。" });
      return;
    }

    sendJson(response, 502, { error: "AI summary failed." });
  }
}

async function enrichResultsWithCache(searchResults: SearchResult[], line?: PlaybackLine) {
  const hydratedResults = await Promise.all(
    searchResults.map(async (item) => store.hydrateMoviePosterUrls(await enrichResultRatings(item)))
  );
  const assetKeys = hydratedResults.flatMap((item) => [
    item.assetKey,
    ...(item.variants?.map((variant) => variant.assetKey) ?? [])
  ]);
  const assets = await cacheAssetsForLines(assetKeys, line);
  return hydratedResults.map((item) => ({
    ...item,
    cache: visibleCacheAsset(assets[item.assetKey]),
    variants: item.variants?.map((variant) => ({
      ...variant,
      cache: visibleCacheAsset(assets[variant.assetKey])
    }))
  }));
}

function browseMetadataText(result: SearchResult) {
  const metadata = result.metadata;
  const work = metadata?.work;
  return [
    result.title,
    result.sourceBreadcrumb?.join(" "),
    metadata?.kind,
    work?.kind,
    metadata?.type,
    metadata?.ratingLevel?.join(" "),
    metadata?.genres?.join(" "),
    work?.genres?.join(" "),
    metadata?.display?.title,
    metadata?.display?.subtitle,
    work?.display?.title,
    work?.display?.subtitle,
    metadata?.titles?.map((title) => title.title).join(" "),
    work?.titles?.map((title) => title.title).join(" "),
    metadata?.info,
    metadata?.description,
    metadata?.external?.omdb?.type,
    metadata?.external?.omdb?.genres?.join(" "),
    metadata?.external?.omdb?.plot
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function explicitBrowseKind(result: SearchResult): "movie" | "tv" | undefined {
  const kind = result.metadata?.work?.kind ?? result.metadata?.kind;
  if (kind === "series" || kind === "season" || kind === "episode") {
    return "tv";
  }
  if (kind === "movie" || kind === "short" || kind === "special") {
    return "movie";
  }

  const type = result.metadata?.type?.trim().toLowerCase();
  if (!type) {
    return undefined;
  }
  if (/\bmovie\b|\bfilm\b|电影/.test(type)) {
    return "movie";
  }
  if (/\btv\b|\bseries\b|\bseason\b|\bshow\b|电视|电视剧|剧集|影集/.test(type)) {
    return "tv";
  }

  return undefined;
}

function resultMatchesBrowseChannel(result: SearchResult, channel: BrowseChannel) {
  if (channel === "recommended") {
    return true;
  }

  const text = browseMetadataText(result);
  if (channel === "animation") {
    return /动画|動畫|动漫|動漫|番剧|番劇|anime|animation|animated/.test(text);
  }

  const explicitKind = explicitBrowseKind(result);
  if (explicitKind) {
    return channel === explicitKind;
  }

  if (channel === "tv") {
    return /电视|电视剧|剧集|影集|tv|series|season|show/.test(text);
  }

  return /电影|movie|film/.test(text) && !/电视|电视剧|剧集|影集|tv series|series/.test(text);
}

function filterBrowseResults(results: SearchResult[], channel: BrowseChannel) {
  return channel === "recommended" ? results : results.filter((result) => resultMatchesBrowseChannel(result, channel));
}

function browseRatingCandidates(result: SearchResult) {
  const metadata = result.metadata;
  const ratings = [
    ...(metadata?.ratings ?? []),
    ...(metadata?.external?.omdb?.ratings ?? [])
  ];

  if (metadata?.external?.omdb?.imdbRating && metadata.external.omdb.imdbRating !== "N/A") {
    ratings.push({ label: "IMDb", value: metadata.external.omdb.imdbRating });
  }

  if (metadata?.external?.omdb?.metascore && metadata.external.omdb.metascore !== "N/A") {
    ratings.push({ label: "Metacritic", value: metadata.external.omdb.metascore });
  }

  return ratings.filter((rating) => rating.label && rating.value && rating.value !== "N/A");
}

function browseNumericRating(result: SearchResult) {
  return Math.max(
    0,
    ...browseRatingCandidates(result).map((rating) => Number.parseFloat(rating.value.replace(/[^\d.]/g, "")) || 0)
  );
}

const browseRatingSourcePatterns = {
  douban: /douban|豆瓣/i,
  imdb: /imdb/i,
  rotten: /^rt$|rotten|tomato|tomatometer|烂番茄|爛番茄/i
};

function browseSourceRating(result: SearchResult, source: keyof typeof browseRatingSourcePatterns) {
  const rating = browseRatingCandidates(result).find((item) => browseRatingSourcePatterns[source].test(item.label));
  return Number.parseFloat(rating?.value.replace(/[^\d.]/g, "") ?? "") || 0;
}

function browseTime(value?: string) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function browseYear(value?: string) {
  return value?.match(/\b(19\d{2}|20\d{2})\b/)?.[1];
}

function browseTextYearCandidates(value?: string) {
  const maxPlausibleYear = new Date().getUTCFullYear() + 1;
  return Array.from(value?.matchAll(/\b(19\d{2}|20\d{2})\b/g) ?? [], (match) => match[1])
    .filter((year) => Number(year) <= maxPlausibleYear)
    .reverse();
}

function browseUrlSearchText(value?: string) {
  if (!value) {
    return undefined;
  }

  const withoutQuery = value.split("?")[0];
  try {
    return decodeURIComponent(withoutQuery);
  } catch {
    return withoutQuery;
  }
}

function browseYearFromTime(time: number) {
  const year = new Date(time).getUTCFullYear();
  return Number.isFinite(year) ? String(year) : undefined;
}

function browseObservedYear(result: SearchResult) {
  return browseYear(result.updatedAt);
}

function browseTrustedReleaseYear(result: SearchResult) {
  const metadata = result.metadata;
  const work = metadata?.work;
  const values = [
    result.title,
    result.sourceBreadcrumb?.join(" "),
    browseUrlSearchText(result.sourceUrl),
    metadata?.external?.omdb?.year,
    metadata?.external?.omdb?.title,
    metadata?.display?.title,
    metadata?.work?.display?.title,
    metadata?.titles?.map((title) => title.title).join(" "),
    work?.titles?.map((title) => title.title).join(" "),
    ...(result.variants ?? []).flatMap((variant) => [
      variant.label,
      variant.sourceBreadcrumb?.join(" "),
      browseUrlSearchText(variant.sourceUrl)
    ])
  ];
  const observedYear = browseObservedYear(result);
  return values
    .flatMap(browseTextYearCandidates)
    .find((year) => year !== observedYear) ?? values.flatMap(browseTextYearCandidates)[0];
}

function browseReleaseTime(result: SearchResult) {
  const metadata = result.metadata;
  const trustedYear = browseTrustedReleaseYear(result);
  const observedYear = browseObservedYear(result);
  const metadataYear = [
    metadata?.work?.release?.year,
    metadata?.release?.year,
    metadata?.year,
    metadata?.external?.omdb?.year,
    metadata?.display?.year,
    metadata?.work?.display?.year,
    result.title
  ].map(browseYear).find((candidate) => candidate && candidate !== observedYear);
  const year = trustedYear ?? metadataYear;
  const exactDate = [
    metadata?.work?.release?.date,
    metadata?.release?.date,
    metadata?.releaseDate,
    metadata?.external?.omdb?.released
  ].map(browseTime).find((time) => time > 0 &&
    (!trustedYear || browseYearFromTime(time) === trustedYear) &&
    (!observedYear || browseYearFromTime(time) !== observedYear || Boolean(trustedYear)));
  if (exactDate) {
    return exactDate;
  }

  return year ? browseTime(`${year}-01-01`) : 0;
}

function requestBrowseView(url: URL): BrowseViewId {
  const value = url.searchParams.get("view");
  return value === "lucky" ||
    value === "recent" ||
    value === "newGood" ||
    value === "popular" ||
    value === "topRated" ||
    value === "mostWatched" ||
    value === "doubanRank" ||
    value === "imdbRank" ||
    value === "rottenRank" ||
    value === "tspdtRank"
    ? value
    : "newGood";
}

function sortBrowseResults(results: SearchResult[], view: BrowseViewId) {
  const ranked = [...results];
  const byUpdated = (left: SearchResult, right: SearchResult) => browseTime(right.updatedAt) - browseTime(left.updatedAt) || stableBrowseTie(left, right);
  const byRating = (left: SearchResult, right: SearchResult) => browseNumericRating(right) - browseNumericRating(left) || stableBrowseTie(left, right);
  const byRelease = (left: SearchResult, right: SearchResult) => browseReleaseTime(right) - browseReleaseTime(left) || stableBrowseTie(left, right);

  if (view === "doubanRank") {
    return ranked.sort((left, right) => browseSourceRating(right, "douban") - browseSourceRating(left, "douban") || byUpdated(left, right));
  }

  if (view === "imdbRank") {
    return ranked.sort((left, right) => browseSourceRating(right, "imdb") - browseSourceRating(left, "imdb") || byUpdated(left, right));
  }

  if (view === "rottenRank") {
    return ranked.sort((left, right) => browseSourceRating(right, "rotten") - browseSourceRating(left, "rotten") || byUpdated(left, right));
  }

  if (view === "newGood") {
    return ranked.sort((left, right) => byRelease(left, right) || byRating(left, right) || byUpdated(left, right));
  }

  if (view === "topRated") {
    return ranked.sort((left, right) => byRating(left, right) || byUpdated(left, right));
  }

  return ranked.sort(byUpdated);
}

async function handleBrowseAssets(url: URL, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const mode = url.searchParams.get("mode") === "random" ? "random" : "paged";
  const offset = requestOffset(url);
  const channel = requestBrowseChannel(url);
  const view = requestBrowseView(url);
  const line = optionalPlaybackLine(url.searchParams.get("line"));
  const requestedPersonId = url.searchParams.get("person")?.trim();
  let personWorkIds: Set<string> | undefined;
  if (requestedPersonId) {
    const person = getPublicPerson(await personCatalog.getState(), requestedPersonId);
    personWorkIds = new Set(person?.works.map((work) => work.workId) ?? []);
  }
  const pagedLimitMaximum = channel === "movie" && view === "tspdtRank"
    ? 2000
    : view === "popular" || view === "mostWatched"
      ? 300
      : 100;
  const limit = requestLimit(url, 50, mode === "random" ? 200 : pagedLimitMaximum);

  if (!requestedPersonId && channel === "movie" && view === "tspdtRank" && mode === "paged") {
    const served = await serveStaticTspdtBrowse(response, context, {
      startedAt,
      offset,
      limit,
      channel,
      view,
      mode,
      line
    });
    if (served) {
      return;
    }
  }

  const fetchLimit = channel === "recommended" && view === "lucky" ? offset + limit + 1 : 1_000_000;
  let searchResults: SearchResult[] = [];
  let browseSource = "live";
  const snapshotKey = `${channel}:${view}`;
  let sortedResults = mode === "paged" && !requestedPersonId ? browseSnapshotCache.get(snapshotKey) : undefined;

  if (sortedResults) {
    browseSource = "snapshot";
  }

  if (!sortedResults && searchIndexEnabled) {
    try {
      searchResults = mode === "random"
        ? channel === "recommended"
          ? await searchIndex.sample(limit)
          : sampleSearchResults(filterBrowseResults(await searchIndex.search("", fetchLimit), channel), limit)
        : (searchIndex.backend === "local"
          ? await searchIndex.search("", fetchLimit)
          : (await browseSourceCache.getOrLoad("index", () => searchIndex.search("", 1_000_000))).slice(0, fetchLimit));
      browseSource = mode === "random" ? "index_random" : "index";
    } catch (error) {
      logWarn("api.browse.index_read_failed", {
        requestId: context.requestId,
        ...errorLogFields(error)
      });
    }
  }

  if (!sortedResults && searchResults.length === 0) {
    const liveResults = await searchSource.search("");
    const filteredLiveResults = filterBrowseResults(liveResults, channel);
    searchResults = mode === "random" ? sampleSearchResults(filteredLiveResults, limit) : filteredLiveResults.slice(0, fetchLimit);
    void writeSearchResultsToIndex(searchResults, "browse_live");
    browseSource = mode === "random" ? "live_random" : "live";
  }

  if (!sortedResults) {
    const channelResults = mode === "random" ? searchResults : filterBrowseResults(searchResults, channel);
    sortedResults = mode === "random" ? channelResults : sortBrowseResults(channelResults, view);
    if (mode === "paged" && !requestedPersonId) {
      browseSnapshotCache.set(snapshotKey, sortedResults);
    }
  }
  const identityFilteredResults = personWorkIds
    ? sortedResults.filter((result) => {
      const workId = result.metadata?.work?.workId ?? result.metadata?.workId;
      return Boolean(workId && personWorkIds.has(workId));
    })
    : sortedResults;
  const pageResults = mode === "random" ? identityFilteredResults.slice(0, limit) : identityFilteredResults.slice(offset, offset + limit);
  const hasMore = mode === "random" ? false : identityFilteredResults.length > offset + limit;
  rememberResults(pageResults);
  const results = await enrichResultsWithCache(pageResults, line);

  logInfo("api.browse", {
    requestId: context.requestId,
    resultCount: results.length,
    variantCount: results.reduce((count, item) => count + (item.variants?.length ?? 0), 0),
    browseSource,
    channel,
    view,
    mode,
    limit,
    offset,
    hasMore,
    personId: requestedPersonId,
    durationMs: durationMs(startedAt)
  });

  sendJson(response, 200, {
    results,
    offset: mode === "random" ? 0 : offset,
    limit,
    hasMore,
    nextOffset: hasMore ? offset + results.length : undefined,
    mode
  }, {
    "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
    Vary: "Cookie"
  });
}

async function visiblePersonWorkIds() {
  try {
    const results = await searchIndex.search("", 1_000_000);
    return new Set(results.flatMap((result) => {
      const work = result.metadata?.work;
      const hidden = result.metadata?.hideFromWebsite;
      const workId = work?.workId ?? result.metadata?.workId;
      return !hidden && workId ? [workId] : [];
    }));
  } catch (error) {
    logWarn("api.people.visible_work_index_failed", errorLogFields(error));
    return new Set<string>();
  }
}

async function loadSiteStatistics() {
  if (siteStatisticsCache && siteStatisticsCache.expiresAt > Date.now()) {
    return siteStatisticsCache.value;
  }
  if (pendingSiteStatistics) return pendingSiteStatistics;

  pendingSiteStatistics = (async () => {
    const results = searchIndexEnabled
      ? await browseSourceCache.getOrLoad("index", () => searchIndex.search("", 1_000_000))
      : await searchSource.search("");
    const [indexStats, cachedAssets, domesticJobs, peopleState] = await Promise.all([
      searchIndexEnabled ? searchIndex.getStats() : Promise.resolve(undefined),
      store.listCachedAssets(100_000),
      ossPreparationStore.list(1_000),
      personCatalog.getState()
    ]);
    const readyAssetKeys = new Set([
      ...cachedAssets.map((asset) => asset.assetKey),
      ...domesticJobs.filter((job) => ossCacheStatus(job) === "ready").map((job) => job.assetKey)
    ]);
    const statistics = buildSiteStatistics(results, {
      readyAssetKeys,
      people: listPublicPeople(peopleState, { limit: 1 }).total,
      latestIndexedAt: indexStats?.latestIndexedAt
    });
    siteStatisticsCache = { expiresAt: Date.now() + siteStatisticsCacheTtlMs, value: statistics };
    return statistics;
  })().finally(() => {
    pendingSiteStatistics = undefined;
  });

  return pendingSiteStatistics;
}

async function handleSiteStatistics(response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const statistics = await loadSiteStatistics();
  logInfo("api.site_statistics", {
    requestId: context.requestId,
    titleCount: statistics.totals.titles,
    instantPlayCount: statistics.totals.instantPlay,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, statistics, {
    "Cache-Control": "private, max-age=300, stale-while-revalidate=600",
    Vary: "Cookie"
  });
}

async function serveStaticTspdtBrowse(
  response: http.ServerResponse,
  context: RequestContext,
  options: {
    startedAt: number;
    offset: number;
    limit: number;
    channel: BrowseChannel;
    view: BrowseViewId;
    mode: "paged" | "random";
    line?: PlaybackLine;
  }
) {
  try {
    const state = await tspdtBrowseStore.getState();
    if (!state?.entries.length) {
      return false;
    }

    const pageEntries = state.entries.slice(options.offset, options.offset + options.limit);
    const pageResults = pageEntries.map((entry) => entry.result);
    const hasMore = state.entries.length > options.offset + options.limit;
    rememberResults(pageResults);
    const results = await enrichResultsWithCache(pageResults, options.line);

    logInfo("api.browse", {
      requestId: context.requestId,
      resultCount: results.length,
      variantCount: results.reduce((count, item) => count + (item.variants?.length ?? 0), 0),
      browseSource: "tspdt_static",
      channel: options.channel,
      view: options.view,
      mode: options.mode,
      limit: options.limit,
      offset: options.offset,
      hasMore,
      tspdtGeneratedAt: state.generatedAt,
      tspdtEntryCount: state.entries.length,
      durationMs: durationMs(options.startedAt)
    });

    sendJson(response, 200, {
      results,
      offset: options.offset,
      limit: options.limit,
      hasMore,
      nextOffset: hasMore ? options.offset + results.length : undefined,
      mode: options.mode
    });
    return true;
  } catch (error) {
    logWarn("api.browse.tspdt_static_failed", {
      requestId: context.requestId,
      store: tspdtBrowseStore.description,
      ...errorLogFields(error)
    });
    return false;
  }
}

function sampleSearchResults(results: SearchResult[], limit: number) {
  const boundedLimit = Math.min(Math.max(Math.floor(limit), 1), 200);
  const pool = [...results];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
  }

  return pool.slice(0, boundedLimit);
}

function creditLimitErrorMessage() {
  return "This member pass does not have enough 🍀 left.";
}

function playbackSizeMissingErrorMessage() {
  return "Video size information is missing, so playback credit cost cannot be calculated.";
}

function creditPolicyPayload(): CreditPolicyResponse {
  return {
    billingEnabled: creditBillingEnabled,
    unitSymbol: defaultCreditPolicy.unitSymbol,
    cacheCredits: creditBillingEnabled ? cacheMinimumCredits : 0,
    cacheCreditBytes,
    domesticPlaybackCreditBytes,
    internationalPlaybackCreditBytes,
    playbackReplayFreeHours
  };
}

function positiveCreditContentLength(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function resultCreditContentLength(result: SearchResult) {
  const matchingVariant = result.variants?.find((variant) => variant.assetKey === result.assetKey)
    ?? result.variants?.[0];
  const exactBytes = positiveCreditContentLength(matchingVariant?.metadata?.exactByteSize)
    ?? positiveCreditContentLength((result.metadata as Record<string, unknown> | undefined)?.exactByteSize);
  if (exactBytes) {
    return exactBytes;
  }

  const approximateSizeGb = positiveCreditContentLength(matchingVariant?.metadata?.approximateSizeGb)
    ?? positiveCreditContentLength((result.metadata as Record<string, unknown> | undefined)?.approximateSizeGb);
  return approximateSizeGb ? approximateSizeGb * 1_000_000_000 : undefined;
}

function resultCacheCreditCost(result: SearchResult) {
  return cacheCreditCost(resultCreditContentLength(result), creditPolicyPayload());
}

function previewPayload(input: {
  action: CreditPreviewResponse["action"];
  assetKey: string;
  title: string;
  line?: PlaybackLine;
  credits: number;
  identity: AccessIdentity;
  freeReason?: CreditPreviewFreeReason;
  windowExpiresAt?: string;
}): CreditPreviewResponse {
  const remaining = input.identity.credits?.remaining;
  const chargeable = creditBillingEnabled && input.identity.role === "member" && !input.freeReason && input.credits > 0;
  const remainingAfter = chargeable && remaining !== undefined
    ? Math.max(0, remaining - input.credits)
    : remaining;

  return {
    action: input.action,
    assetKey: input.assetKey,
    title: input.title,
    line: input.line,
    credits: chargeable ? input.credits : 0,
    unitSymbol: input.identity.credits?.unitSymbol ?? "🍀",
    chargeable,
    canAfford: !chargeable || remaining === undefined || remaining >= input.credits,
    remaining,
    remainingAfter,
    freeReason: input.identity.role === "admin"
      ? "admin"
      : !creditBillingEnabled
        ? "billing_disabled"
        : input.freeReason,
    windowHours: input.action === "playback" ? playbackReplayFreeHours : undefined,
    windowExpiresAt: input.windowExpiresAt
  };
}

async function memberCreditUsage(identity: AccessIdentity, limit = 200) {
  if (identity.role !== "member" || !identity.memberId) {
    return undefined;
  }

  return accessStore.listMemberCreditUsage(identity.memberId, limit);
}

async function handleCreditPreview(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const body = await readBody<CreditPreviewRequest>(request);
  const assetKey = body.assetKey?.trim();
  const line = requestPlaybackLine(body.line);
  if (!assetKey || (body.action !== "cache" && body.action !== "playback")) {
    sendJson(response, 400, { error: "Credit preview requires an action and assetKey." });
    return;
  }

  if (body.action === "cache") {
    const candidate = body.result?.assetKey === assetKey
      ? body.result
      : recentResults.get(assetKey);
    if (!candidate) {
      sendJson(response, 404, { error: "Asset was not found." });
      return;
    }

    const domesticJob = line === "domestic" ? await syncedOssJobByAssetKey(assetKey) : undefined;
    const existingAsset = line === "international"
      ? await store.getAsset(assetKey, { fresh: true })
      : domesticJob
        ? ossJobToCacheAsset(domesticJob)
        : undefined;
    const existingJob = line === "international" && existingAsset?.jobId
      ? await store.getJob(existingAsset.jobId)
      : domesticJob
        ? ossJobToCacheJob(domesticJob)
        : undefined;
    const readyHit = line === "domestic"
      ? domesticJob?.status === "ready"
      : isFreshReady(existingAsset);
    const activeAssetJobHit = Boolean(existingAsset && existingJob && !terminalJobStatuses.includes(existingJob.status));
    const usage = await memberCreditUsage(identity, 1);
    const preview = previewPayload({
      action: "cache",
      assetKey,
      title: candidate.title,
      line,
      credits: resultCacheCreditCost(candidate),
      identity: usage?.code
        ? { ...identity, credits: usage.code.credits }
        : identity,
      freeReason: readyHit ? "cache_ready" : activeAssetJobHit ? "cache_active" : undefined
    });

    logInfo("api.credit.preview", {
      requestId: context.requestId,
      line,
      action: "cache",
      assetKey,
      credits: preview.credits,
      chargeable: preview.chargeable,
      freeReason: preview.freeReason,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 200, preview);
    return;
  }

  const domesticJob = line === "domestic" ? await syncedOssJobByAssetKey(assetKey) : undefined;
  const asset = line === "domestic"
    ? domesticJob
      ? ossJobToCacheAsset(domesticJob)
      : undefined
    : await store.getAsset(assetKey, { fresh: true });
  const ready = line === "domestic" ? domesticJob?.status === "ready" : isFreshReady(asset);
  if (!asset || !ready) {
    sendJson(response, 409, { error: "Asset is not ready for playback." });
    return;
  }

  const playbackCredits = playbackCreditCost(asset.media?.contentLength, creditPolicyPayload(), line);
  if (identity.role === "member" && playbackCredits === undefined) {
    logWarn("api.credit.preview_playback_size_missing", {
      requestId: context.requestId,
      assetKey,
      media: asset.media,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 409, { error: playbackSizeMissingErrorMessage() });
    return;
  }

  const usage = await memberCreditUsage(identity, 200);
  const now = Date.now();
  const recentPlayback = usage?.entries.find((entry) => {
    if (
      entry.reason !== "playback_stream"
      || entry.assetKey !== assetKey
      || (entry.line && entry.line !== line)
    ) {
      return false;
    }

    const chargedAt = new Date(entry.chargedAt).getTime();
    return Number.isFinite(chargedAt) && now - chargedAt <= playbackReplayFreeHours * 60 * 60 * 1000;
  });
  const preview = previewPayload({
    action: "playback",
    assetKey,
    title: asset.title,
    line,
    credits: playbackCredits ?? 0,
    identity: usage?.code
      ? { ...identity, credits: usage.code.credits }
      : identity,
    freeReason: recentPlayback ? "playback_replay" : undefined,
    windowExpiresAt: recentPlayback?.windowExpiresAt
  });

  logInfo("api.credit.preview", {
    requestId: context.requestId,
    line,
    action: "playback",
    assetKey,
    credits: preview.credits,
    chargeable: preview.chargeable,
    freeReason: preview.freeReason,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, preview);
}

function movieRequestStatus(value: unknown): MovieRequestStatus | undefined {
  return movieRequestStatuses.includes(value as MovieRequestStatus) ? value as MovieRequestStatus : undefined;
}

async function handleEnsureCache(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const body = await readBody<EnsureCacheRequest>(request);
  const candidate = body.result?.assetKey === body.assetKey
    ? body.result
    : recentResults.get(body.assetKey);

  if (!candidate) {
    logWarn("api.cache.asset_not_found", {
      requestId: context.requestId,
      assetKey: body.assetKey,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Asset was not found." });
    return;
  }

  const result = await refreshResultBeforeCache(candidate, context);
  const line = requestPlaybackLine(body.line);
  const cacheCredits = resultCacheCreditCost(result);

  if (line === "domestic") {
    if (!aliyunFcPrepare.enabled || !aliyunOssStorage.enabled) {
      sendJson(response, 503, {
        error: "国内线路暂时不可用，请切换到国际线路后重试。"
      });
      return;
    }
    if (!result.sourceUrl?.startsWith("https://")) {
      sendJson(response, 422, { error: "这个片源暂时没有可用的 HTTPS 来源。" });
      return;
    }

    const existing = await syncedOssJobByAssetKey(result.assetKey);
    const readyHit = existing?.status === "ready";
    const activeHit = Boolean(existing && ["queued", "running", "cancelling"].includes(existing.status));
    const shouldChargeMember = creditBillingEnabled &&
      identity.role === "member" &&
      Boolean(identity.memberId) &&
      !readyHit &&
      !activeHit;
    const charge = shouldChargeMember
      ? await accessStore.chargeMemberCredits(identity.memberId!, {
        credits: cacheCredits,
        assetKey: result.assetKey,
        title: result.title,
        requestId: context.requestId
      })
      : undefined;

    if (shouldChargeMember && !charge) {
      sendJson(response, 403, { error: "This member pass is no longer available." });
      return;
    }
    if (charge && !charge.ok) {
      sendJson(response, 429, {
        error: creditLimitErrorMessage(),
        reason: charge.reason,
        credits: charge.code.credits
      });
      return;
    }

    const output = await ensureOssPreparationForResult(result, context);
    const publicJob = ossJobToCacheJob(output.job);
    const publicAsset = ossJobToCacheAsset(output.job);
    logInfo("api.cache.ensure", {
      requestId: context.requestId,
      line,
      assetKey: result.assetKey,
      jobId: output.job.id,
      assetStatus: publicAsset.status,
      jobStatus: publicJob.status,
      readyHit,
      chargedCredits: charge?.ok ? charge.charge.credits : 0,
      memberId: identity.memberId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 200, {
      asset: publicAsset,
      job: publicJob,
      line,
      trigger: {
        status: output.created ? "started" : "skipped",
        message: output.created ? "国内线路准备任务已启动。" : "国内线路已有准备任务。"
      },
      charge: charge?.ok ? charge.charge : undefined,
      memberCredits: charge?.ok ? charge.code.credits : undefined
    });
    return;
  }

  const existingAsset = await store.getAsset(result.assetKey, { fresh: true });
  const existingJob = existingAsset?.jobId ? await store.getJob(existingAsset.jobId) : undefined;
  const readyHit = isFreshReady(existingAsset);
  const activeAssetJobHit = Boolean(existingAsset && existingJob && !terminalJobStatuses.includes(existingJob.status));
  const shouldChargeMember = creditBillingEnabled &&
    identity.role === "member" &&
    Boolean(identity.memberId) &&
    !readyHit &&
    !activeAssetJobHit;
  const charge = shouldChargeMember
    ? await accessStore.chargeMemberCredits(identity.memberId!, {
      credits: cacheCredits,
      assetKey: result.assetKey,
      title: result.title,
      requestId: context.requestId
    })
    : undefined;

  if (shouldChargeMember && !charge) {
    logWarn("api.cache.credit_member_not_found", {
      requestId: context.requestId,
      memberId: identity.memberId,
      assetKey: result.assetKey,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 403, { error: "This member pass is no longer available." });
    return;
  }

  if (charge && !charge.ok) {
    logWarn("api.cache.credit_denied", {
      requestId: context.requestId,
      memberId: identity.memberId,
      assetKey: result.assetKey,
      reason: charge.reason,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 429, {
      error: creditLimitErrorMessage(),
      reason: charge.reason,
      credits: charge.code.credits
    });
    return;
  }

  const activeJobsBefore = await store.listActiveJobs(1);
  const output = await store.ensureCache(result);
  preparationQueueSnapshot = undefined;
  const requestedAt = new Date().toISOString();
  output.job.requestId ??= context.requestId;
  output.job.lastRequestId = context.requestId;
  output.job.lastRequestedAt = requestedAt;
  await store.saveJob(output.job);
  if (identity.role === "member" && identity.memberId) {
    output.asset.requestedByMemberId ??= identity.memberId;
    output.asset.requestedByMemberName ??= identity.memberName;
    output.asset.lastRequestedAt = requestedAt;
    await store.saveAsset(output.asset);
  }
  const shouldStartWorker = !terminalJobStatuses.includes(output.job.status) && activeJobsBefore.length === 0;
  const trigger = shouldStartWorker
    ? await workerTrigger.start(output.job)
    : {
      status: "skipped" as const,
      message: terminalJobStatuses.includes(output.job.status)
        ? "Worker trigger skipped because the cache job is already complete."
        : "Worker trigger skipped because active cache jobs already exist."
    };

  logInfo("api.cache.ensure", {
    requestId: context.requestId,
    line,
    assetKey: result.assetKey,
    jobId: output.job.id,
    assetStatus: output.asset.status,
    jobStatus: output.job.status,
    readyHit,
    chargedCredits: charge?.ok ? charge.charge.credits : 0,
    memberId: identity.memberId,
    activeJobsBefore: activeJobsBefore.length,
    triggerStatus: trigger.status,
    durationMs: durationMs(startedAt)
  });

  sendJson(response, 200, {
    ...output,
    asset: { ...output.asset, line },
    job: { ...await preparationQueueJob(output.job), line },
    line,
    trigger,
    charge: charge?.ok ? charge.charge : undefined,
    memberCredits: charge?.ok ? charge.code.credits : undefined
  });
}

function unixOrIsoDate(value: string | null) {
  if (!value) {
    return undefined;
  }

  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    const timestamp = numeric > 9999999999 ? numeric : numeric * 1000;
    const date = new Date(timestamp);
    return Number.isFinite(date.getTime()) ? date : undefined;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function amzDate(value: string | null) {
  const match = value?.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!match) {
    return undefined;
  }

  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function downloadUrlExpiresAt(downloadUrl: string) {
  try {
    const url = new URL(downloadUrl);
    const signedPrefix = "/signed/";
    if (url.pathname.startsWith(signedPrefix)) {
      const nestedUrl = decodeURIComponent(url.pathname.slice(signedPrefix.length));
      if (nestedUrl && nestedUrl !== downloadUrl) {
        return downloadUrlExpiresAt(nestedUrl);
      }
    }

    const explicitExpiry =
      unixOrIsoDate(url.searchParams.get("expiryTime")) ??
      unixOrIsoDate(url.searchParams.get("expiration")) ??
      unixOrIsoDate(url.searchParams.get("expirationTimestamp")) ??
      unixOrIsoDate(url.searchParams.get("Expires")) ??
      unixOrIsoDate(url.searchParams.get("expires"));
    if (explicitExpiry) {
      return explicitExpiry.toISOString();
    }

    const signedAt = amzDate(url.searchParams.get("X-Amz-Date"));
    const signedSeconds = Number(url.searchParams.get("X-Amz-Expires"));
    if (signedAt && Number.isFinite(signedSeconds) && signedSeconds > 0) {
      return new Date(signedAt.getTime() + signedSeconds * 1000).toISOString();
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function downloadUrlIsExpired(downloadUrl: string, skewMs = 60_000) {
  const expiresAt = downloadUrlExpiresAt(downloadUrl);
  if (!expiresAt) {
    return false;
  }

  const timestamp = new Date(expiresAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= Date.now() + skewMs;
}

async function handleDirectDownload(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const body = await readBody<DirectDownloadRequest>(request);
  const candidate = body.result?.assetKey === body.assetKey
    ? body.result
    : recentResults.get(body.assetKey);

  if (!candidate) {
    logWarn("api.direct_download.asset_not_found", {
      requestId: context.requestId,
      assetKey: body.assetKey,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Asset was not found." });
    return;
  }

  const refreshed = await refreshResultSource(candidate, context, {
    logPrefix: "api.direct_download",
    indexReason: "direct_download_source_refresh"
  });
  const result = refreshed.result;
  if (!isDirectMediaDownloadUrl(result.sourceUrl)) {
    logWarn("api.direct_download.invalid_url", {
      requestId: context.requestId,
      assetKey: result.assetKey,
      sourceUrl: result.sourceUrl,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 409, { error: "这个规格暂时没有可下载的媒体文件地址。" });
    return;
  }

  const expiresAt = downloadUrlExpiresAt(result.sourceUrl);
  if (downloadUrlIsExpired(result.sourceUrl)) {
    logWarn("api.direct_download.expired_url", {
      requestId: context.requestId,
      assetKey: result.assetKey,
      memberId: identity.memberId,
      role: identity.role,
      sourceRefreshed: refreshed.sourceRefreshed,
      expiresAt,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 409, { error: "下载地址已过期，系统暂时没有刷新到最新地址。请稍后再试。" });
    return;
  }

  const payload: DirectDownloadResponse = {
    assetKey: result.assetKey,
    title: result.title,
    downloadUrl: result.sourceUrl,
    expiresAt,
    sourceRefreshed: refreshed.sourceRefreshed
  };

  logInfo("api.direct_download.ready", {
    requestId: context.requestId,
    assetKey: result.assetKey,
    memberId: identity.memberId,
    role: identity.role,
    sourceRefreshed: payload.sourceRefreshed,
    expiresAt: payload.expiresAt,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, payload);
}

function requestLimit(url: URL, fallback: number, maximum: number) {
  const raw = Number(url.searchParams.get("limit") ?? fallback);
  if (!Number.isFinite(raw)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(raw), 1), maximum);
}

function requestOffset(url: URL) {
  const raw = Number(url.searchParams.get("offset") ?? 0);
  if (!Number.isFinite(raw)) {
    return 0;
  }

  return Math.max(Math.floor(raw), 0);
}

function requestBrowseChannel(url: URL): BrowseChannel {
  const value = url.searchParams.get("channel");
  return value === "movie" || value === "tv" || value === "animation" ? value : "recommended";
}

async function handleStatus(jobId: string, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const ossJob = await ossPreparationStore.get(jobId);
  if (ossJob) {
    const synced = await syncOssPreparationJob(ossJob);
    const publicJob = ossJobToCacheJob(synced);
    const asset = ossJobToCacheAsset(synced);
    logInfo("api.cache.status", {
      requestId: context.requestId,
      line: "domestic",
      jobId,
      assetKey: publicJob.assetKey,
      jobStatus: publicJob.status,
      progress: publicJob.progress,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 200, { job: publicJob, asset, line: "domestic" });
    return;
  }
  const job = await store.getJob(jobId);

  if (!job) {
    logWarn("api.cache.status_not_found", {
      requestId: context.requestId,
      jobId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Job was not found." });
    return;
  }

  logInfo("api.cache.status", {
    requestId: context.requestId,
    jobId,
    assetKey: job.assetKey,
    jobStatus: job.status,
    progress: job.progress,
    durationMs: durationMs(startedAt)
  });

  const asset = await store.getAsset(job.assetKey, {
    fresh: terminalJobStatuses.includes(job.status)
  });

  sendJson(response, 200, {
    job: { ...await preparationQueueJob(job), line: "international" },
    asset: asset ? { ...asset, line: "international" } : asset,
    line: "international"
  });
}

async function handlePlayback(
  assetKey: string,
  admissionTicketId: string | null,
  line: PlaybackLine,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  if (
    playbackRequiresLocalAdmission(line, localPlaybackAdmissionEnabled)
    && !playbackAdmissionQueue.admitted(admissionTicketId ?? undefined, context.session!.id, assetKey)
  ) {
    sendJson(response, 409, { error: "A playback seat is required before opening local media." });
    return;
  }
  if (line === "domestic") {
    let job = await syncedOssJobByAssetKey(assetKey);
    if (!job || job.status !== "ready") {
      logWarn("api.playback.not_ready", {
        requestId: context.requestId,
        line,
        assetKey,
        assetStatus: job?.status,
        durationMs: durationMs(startedAt)
      });
      sendJson(response, 409, {
        error: "国内线路尚未准备好；可以先准备，或切换到国际线路。"
      });
      return;
    }
    try {
      job = await markOssPlayback(job);
    } catch (error) {
      if (error instanceof OssPreparationCleanupClaimedError) {
        sendJson(response, 409, { error: "国内线路资源正在过期清理，请重新准备后播放。" });
        return;
      }
      throw error;
    }
    const asset = ossJobToCacheAsset(job);
    const shouldChargeMember = creditBillingEnabled && identity.role === "member" && Boolean(identity.memberId);
    const playbackCredits = playbackCreditCost(asset.media?.contentLength, creditPolicyPayload(), line);
    if (shouldChargeMember && playbackCredits === undefined) {
      sendJson(response, 409, { error: playbackSizeMissingErrorMessage() });
      return;
    }
    const chargeResult = shouldChargeMember
      ? await accessStore.chargeMemberPlayback(identity.memberId!, {
        credits: playbackCredits!,
        assetKey,
        title: job.title,
        requestId: context.requestId,
        line,
        windowHours: playbackReplayFreeHours
      })
      : undefined;
    if (shouldChargeMember && !chargeResult) {
      sendJson(response, 403, { error: "This member pass is no longer available." });
      return;
    }
    if (chargeResult && !chargeResult.ok) {
      sendJson(response, 429, {
        error: creditLimitErrorMessage(),
        reason: chargeResult.reason,
        credits: chargeResult.code.credits
      });
      return;
    }
    const signed = aliyunOssStorage.createSignedUrl(job.objectKey);
    const videoCodec = await playbackVideoCodec(assetKey).catch(() => undefined);
    logInfo("api.playback.ready", {
      requestId: context.requestId,
      line,
      assetKey,
      contentType: asset.media?.contentType,
      contentLength: asset.media?.contentLength,
      videoCodec,
      signedUrlExpiresAt: signed.expiresAt,
      memberId: identity.memberId,
      playbackCredits,
      chargedCredits: chargeResult?.ok && chargeResult.charged ? chargeResult.charge.credits : 0,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 200, {
      assetKey,
      title: job.title,
      playbackUrl: signed.url,
      expiresAt: signed.expiresAt,
      media: asset.media,
      videoCodec,
      line,
      charge: chargeResult?.ok && chargeResult.charged ? chargeResult.charge : undefined,
      memberCredits: chargeResult?.ok ? chargeResult.code.credits : undefined,
      playbackCredit: chargeResult?.ok
        ? {
          charged: chargeResult.charged,
          windowHours: playbackReplayFreeHours,
          windowExpiresAt: chargeResult.windowExpiresAt
        }
        : undefined
    });
    return;
  }
  const asset = await store.getAsset(assetKey, { fresh: true });
  if (!asset || !isFreshReady(asset)) {
    logWarn("api.playback.not_ready", {
      requestId: context.requestId,
      assetKey,
      assetStatus: asset?.status,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 409, { error: "Asset is not ready for playback." });
    return;
  }

  const shouldChargeMember = creditBillingEnabled && identity.role === "member" && Boolean(identity.memberId);
  const playbackCredits = playbackCreditCost(asset?.media?.contentLength, creditPolicyPayload(), line);
  if (shouldChargeMember && playbackCredits === undefined) {
    logWarn("api.playback.credit_size_missing", {
      requestId: context.requestId,
      memberId: identity.memberId,
      assetKey,
      media: asset.media,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 409, { error: playbackSizeMissingErrorMessage() });
    return;
  }

  const chargeResult = shouldChargeMember
    ? await accessStore.chargeMemberPlayback(identity.memberId!, {
      credits: playbackCredits!,
      assetKey: asset.assetKey,
      title: asset.title,
      requestId: context.requestId,
      line,
      windowHours: playbackReplayFreeHours
    })
    : undefined;

  if (shouldChargeMember && !chargeResult) {
    logWarn("api.playback.credit_member_not_found", {
      requestId: context.requestId,
      memberId: identity.memberId,
      assetKey,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 403, { error: "This member pass is no longer available." });
    return;
  }

  if (chargeResult && !chargeResult.ok) {
    logWarn("api.playback.credit_denied", {
      requestId: context.requestId,
      memberId: identity.memberId,
      assetKey,
      requestedCredits: playbackCredits,
      reason: chargeResult.reason,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 429, {
      error: creditLimitErrorMessage(),
      reason: chargeResult.reason,
      credits: chargeResult.code.credits
    });
    return;
  }

  const playback = await store.getPlayback(assetKey);

  if (!playback) {
    logWarn("api.playback.not_ready", {
      requestId: context.requestId,
      assetKey,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 409, { error: "Asset is not ready for playback." });
    return;
  }

  let videoCodec: string | undefined;
  try {
    videoCodec = await playbackVideoCodec(assetKey, asset.jobId);
  } catch (error) {
    logWarn("api.playback.codec_lookup_failed", {
      requestId: context.requestId,
      assetKey,
      ...errorLogFields(error)
    });
  }

  logInfo("api.playback.ready", {
    requestId: context.requestId,
    assetKey,
    contentType: playback.media?.contentType,
    contentLength: playback.media?.contentLength,
    rangeSupported: playback.media?.rangeSupported,
    mp4Status: playback.media?.mp4?.status,
    moovOffset: playback.media?.mp4?.moovOffset,
    videoCodec,
    signedUrlExpiresAt: playback.expiresAt,
    memberId: identity.memberId,
    playbackCredits,
    chargedCredits: chargeResult?.ok && chargeResult.charged ? chargeResult.charge.credits : 0,
    playbackWindowHours: playbackReplayFreeHours,
    playbackWindowExpiresAt: chargeResult?.ok ? chargeResult.windowExpiresAt : undefined,
    durationMs: durationMs(startedAt)
  });

  sendJson(response, 200, {
    ...playback,
    line,
    playbackUrl: playback.playbackUrl.startsWith("/api/media/")
      || playback.playbackUrl.startsWith("/api/hls/")
      ? `${playback.playbackUrl}?grant=${encodeURIComponent(createPlaybackGrant(assetKey, context.session!.id))}&admission=${encodeURIComponent(admissionTicketId!)}`
      : playback.playbackUrl,
    admission: localPlaybackAdmissionEnabled && admissionTicketId
      ? { ticketId: admissionTicketId }
      : undefined,
    videoCodec,
    charge: chargeResult?.ok && chargeResult.charged ? chargeResult.charge : undefined,
    memberCredits: chargeResult?.ok ? chargeResult.code.credits : undefined,
    playbackCredit: chargeResult?.ok
      ? {
        charged: chargeResult.charged,
        windowHours: playbackReplayFreeHours,
        windowExpiresAt: chargeResult.windowExpiresAt
      }
      : undefined
  });
}

const playbackDiagnosticEvents = new Set([
  "loadstart",
  "loadedmetadata",
  "loadeddata",
  "canplay",
  "playing",
  "waiting",
  "stalled",
  "suspend",
  "error"
]);

function finiteDiagnosticNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function handlePlaybackDiagnostic(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const body = await readBody<{
    assetKey?: string;
    event?: string;
    readyState?: number;
    networkState?: number;
    currentTime?: number;
    duration?: number;
    bufferedEnd?: number;
    errorCode?: number;
  }>(request);
  const assetKey = body.assetKey?.trim().slice(0, 500);
  const clientEvent = body.event?.trim().toLowerCase();
  if (!assetKey || !clientEvent || !playbackDiagnosticEvents.has(clientEvent)) {
    sendJson(response, 400, { error: "Playback diagnostic event is invalid." });
    return;
  }

  logInfo("api.playback.client_event", {
    requestId: context.requestId,
    assetKey,
    clientEvent,
    readyState: finiteDiagnosticNumber(body.readyState),
    networkState: finiteDiagnosticNumber(body.networkState),
    currentTime: finiteDiagnosticNumber(body.currentTime),
    duration: finiteDiagnosticNumber(body.duration),
    bufferedEnd: finiteDiagnosticNumber(body.bufferedEnd),
    errorCode: finiteDiagnosticNumber(body.errorCode),
    ipAddress: requestIp(request),
    device: requestDevice(request).device
  });
  sendJson(response, 202, { ok: true });
}

async function handlePlaybackAdmission(
  assetKey: string,
  ticketId: string | null,
  line: PlaybackLine,
  response: http.ServerResponse,
  context: RequestContext
) {
  if (!playbackRequiresLocalAdmission(line, localPlaybackAdmissionEnabled)) {
    sendJson(response, 200, {
      assetKey,
      title: assetKey,
      status: "admitted",
      capacity: playbackCapacity()
    });
    return;
  }

  const asset = await store.getAsset(assetKey, { fresh: true });
  if (!asset || !isFreshReady(asset)) {
    sendJson(response, 409, { error: "Asset is not ready for playback." });
    return;
  }

  const admission = playbackAdmissionQueue.request({
    sessionId: context.session!.id,
    assetKey,
    title: asset.title,
    ticketId: ticketId ?? undefined
  });
  if (!admission) {
    sendJson(response, 410, { error: "This playback queue ticket is no longer available." });
    return;
  }
  sendJson(response, 200, admission);
}

function requestedByteRange(rangeHeader: string | undefined, contentLength: number) {
  if (!rangeHeader) return undefined;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || (!match[1] && !match[2])) return null;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, contentLength - suffixLength);
    end = contentLength - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : contentLength - 1;
  }

  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(end)
    || start < 0
    || end < start
    || start >= contentLength
  ) {
    return null;
  }

  return { start, end: Math.min(end, contentLength - 1) };
}

async function handleLocalMedia(
  assetKey: string,
  grant: string | null,
  admissionTicketId: string | null,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  if (!playbackGrantValid(grant, assetKey, context.session!.id)) {
    sendJson(response, 403, { error: "Playback grant is missing, invalid, or expired." });
    return;
  }
  if (
    localPlaybackAdmissionEnabled
    && !playbackAdmissionQueue.admitted(admissionTicketId ?? undefined, context.session!.id, assetKey)
  ) {
    sendJson(response, 409, { error: "This playback seat is no longer active." });
    return;
  }
  const mediaFile = await store.getMediaFile?.(assetKey);
  if (!mediaFile) {
    sendJson(response, 404, { error: "Local media file was not found." });
    return;
  }

  const range = requestedByteRange(request.headers.range, mediaFile.contentLength);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", mediaFile.contentType);
  response.setHeader("Cache-Control", "private, no-store");

  if (range === null) {
    response.statusCode = 416;
    response.setHeader("Content-Range", `bytes */${mediaFile.contentLength}`);
    response.end();
    return;
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? mediaFile.contentLength - 1;
  const responseLength = end - start + 1;
  response.statusCode = range ? 206 : 200;
  response.setHeader("Content-Length", responseLength);
  if (range) {
    response.setHeader("Content-Range", `bytes ${start}-${end}/${mediaFile.contentLength}`);
  }

  logInfo("api.media.stream", {
    requestId: context.requestId,
    assetKey,
    start,
    end,
    contentLength: mediaFile.contentLength,
    partial: Boolean(range),
    requestedRange: request.headers.range,
    ipAddress: requestIp(request),
    device: requestDevice(request).device,
    durationMs: durationMs(startedAt)
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  activePlaybackStreams += 1;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(mediaFile.absolutePath, { start, end });
    let released = false;
    let streamedBytes = 0;
    const release = (outcome: "completed" | "client_closed" | "stream_error") => {
      if (released) return;
      released = true;
      activePlaybackStreams = Math.max(0, activePlaybackStreams - 1);
      logInfo("api.media.stream.complete", {
        requestId: context.requestId,
        assetKey,
        start,
        end,
        requestedBytes: responseLength,
        streamedBytes,
        outcome,
        durationMs: durationMs(startedAt)
      });
    };
    stream.on("data", (chunk) => {
      streamedBytes += chunk.length;
    });
    stream.once("error", (error) => {
      release("stream_error");
      reject(error);
    });
    response.once("close", () => {
      stream.destroy();
      release(response.writableFinished ? "completed" : "client_closed");
      resolve();
    });
    response.once("finish", () => {
      release("completed");
      resolve();
    });
    stream.pipe(response);
  });
}

const hlsSegmentName = /^segment-\d{5}\.m4s$/;

function hlsResourceAllowed(resource: string) {
  return resource === "index.m3u8" || resource === "init.mp4" || hlsSegmentName.test(resource);
}

function appendHlsAccessQuery(resource: string, query: string) {
  return `${resource}?${query}`;
}

function signedHlsManifest(contents: string, grant: string, admissionTicketId: string | null) {
  const query = new URLSearchParams({
    grant,
    ...(admissionTicketId ? { admission: admissionTicketId } : {})
  }).toString();
  return contents
    .replace(/URI="([^"]+)"/g, (_match, resource: string) => `URI="${appendHlsAccessQuery(resource, query)}"`)
    .split(/\r?\n/)
    .map((line) => line && !line.startsWith("#") ? appendHlsAccessQuery(line, query) : line)
    .join("\n");
}

async function handleLocalHls(
  assetKey: string,
  resource: string,
  grant: string | null,
  admissionTicketId: string | null,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  if (!grant || !playbackGrantValid(grant, assetKey, context.session!.id)) {
    sendJson(response, 403, { error: "Playback grant is missing, invalid, or expired." });
    return;
  }
  if (
    localPlaybackAdmissionEnabled
    && !playbackAdmissionQueue.admitted(admissionTicketId ?? undefined, context.session!.id, assetKey)
  ) {
    sendJson(response, 409, { error: "This playback seat is no longer active." });
    return;
  }
  if (!hlsResourceAllowed(resource)) {
    sendJson(response, 404, { error: "HLS resource was not found." });
    return;
  }

  const mediaFile = await store.getMediaFile?.(assetKey);
  if (!mediaFile) {
    sendJson(response, 404, { error: "Local media file was not found." });
    return;
  }
  const resourcePath = path.join(path.dirname(mediaFile.absolutePath), "hls", resource);

  if (resource === "index.m3u8") {
    try {
      const manifest = signedHlsManifest(await readFile(resourcePath, "utf8"), grant, admissionTicketId);
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      response.setHeader("Cache-Control", "private, no-store");
      response.setHeader("Content-Length", Buffer.byteLength(manifest));
      response.end(request.method === "HEAD" ? undefined : manifest);
    } catch {
      sendJson(response, 404, { error: "HLS manifest was not found." });
    }
    return;
  }

  try {
    const metadata = await stat(resourcePath);
    if (!metadata.isFile()) throw new Error("HLS resource is not a file.");
    const range = requestedByteRange(request.headers.range, metadata.size);
    if (range === null) {
      response.statusCode = 416;
      response.setHeader("Content-Range", `bytes */${metadata.size}`);
      response.end();
      return;
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? metadata.size - 1;
    const responseLength = end - start + 1;
    response.statusCode = range ? 206 : 200;
    response.setHeader("Accept-Ranges", "bytes");
    response.setHeader("Content-Type", resource === "init.mp4" ? "video/mp4" : "video/iso.segment");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Length", responseLength);
    if (range) response.setHeader("Content-Range", `bytes ${start}-${end}/${metadata.size}`);
    if (request.method === "HEAD") {
      response.end();
      return;
    }

    activePlaybackStreams += 1;
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(resourcePath, { start, end });
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        activePlaybackStreams = Math.max(0, activePlaybackStreams - 1);
      };
      stream.once("error", (error) => {
        release();
        reject(error);
      });
      response.once("close", () => {
        stream.destroy();
        release();
        resolve();
      });
      response.once("finish", () => {
        release();
        resolve();
      });
      stream.pipe(response);
    });
    logInfo("api.hls.stream", {
      requestId: context.requestId,
      assetKey,
      resource,
      bytes: responseLength,
      ipAddress: requestIp(request),
      device: requestDevice(request).device,
      durationMs: durationMs(startedAt)
    });
  } catch (error) {
    logWarn("api.hls.stream_failed", {
      requestId: context.requestId,
      assetKey,
      resource,
      ...errorLogFields(error)
    });
    if (!response.headersSent) sendJson(response, 404, { error: "HLS resource was not found." });
  }
}

async function handleLocalPoster(
  posterKey: string,
  request: http.IncomingMessage,
  response: http.ServerResponse
) {
  const poster = await store.getPosterFile?.(posterKey);
  if (!poster) {
    sendJson(response, 404, { error: "Local poster was not found." });
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", poster.contentType);
  response.setHeader("Content-Length", poster.contentLength);
  response.setHeader("Cache-Control", "private, max-age=86400");
  if (request.method === "HEAD") {
    response.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(poster.absolutePath);
    stream.once("error", reject);
    response.once("close", resolve);
    response.once("finish", resolve);
    stream.pipe(response);
  });
}

async function handleAssetLookup(
  assetKey: string,
  line: PlaybackLine | undefined,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const [domesticJob, internationalAsset] = await Promise.all([
    line === "international" ? Promise.resolve(undefined) : syncedOssJobByAssetKey(assetKey),
    line === "domestic" ? Promise.resolve(undefined) : store.getAsset(assetKey, { fresh: true })
  ]);
  const domesticAsset = domesticJob ? ossJobToCacheAsset(domesticJob) : undefined;
  const asset = line === "domestic"
    ? domesticAsset
    : line === "international"
      ? internationalAsset
        ? { ...internationalAsset, line }
        : undefined
      : preparedAssetForLines(
        domesticAsset,
        internationalAsset ? { ...internationalAsset, line: "international" } : undefined
      );
  const payload: CacheAssetLookupResponse = {
    asset,
    playable: line === "domestic"
      ? domesticJob?.status === "ready"
      : line === "international"
        ? isFreshReady(internationalAsset)
        : Boolean(asset?.preparedLines?.length)
  };

  logInfo("api.asset.lookup", {
    requestId: context.requestId,
    line,
    assetKey,
    assetStatus: asset?.status,
    playable: payload.playable,
    durationMs: durationMs(startedAt)
  });

  sendJson(response, 200, payload);
}

async function handleListCachedAssets(url: URL, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const limit = requestLimit(url, 50, 200);
  const line = optionalPlaybackLine(url.searchParams.get("line"));
  const [domesticAssets, internationalAssets] = await Promise.all([
    line === "international"
      ? Promise.resolve([])
      : ossPreparationStore.list(1_000).then((jobs) => jobs
        .filter((job) => job.status === "ready")
        .map(ossJobToCacheAsset)),
    line === "domestic"
      ? Promise.resolve([])
      : store.listCachedAssets(limit).then((assets) => assets.map((asset) => ({
        ...asset,
        line: "international" as const
      })))
  ]);
  const byAssetKey = new Map<string, { domestic?: CacheAsset; international?: CacheAsset }>();
  for (const asset of domesticAssets) {
    byAssetKey.set(asset.assetKey, { ...byAssetKey.get(asset.assetKey), domestic: asset });
  }
  for (const asset of internationalAssets) {
    byAssetKey.set(asset.assetKey, { ...byAssetKey.get(asset.assetKey), international: asset });
  }
  const assets = Array.from(byAssetKey.values(), ({ domestic, international }) => (
    preparedAssetForLines(domestic, international)
  ))
    .filter((asset): asset is CacheAsset => Boolean(asset))
    .sort((left, right) => (
      new Date(right.lastPlayedAt ?? right.cachedAt ?? right.lastRequestedAt).getTime()
      - new Date(left.lastPlayedAt ?? left.cachedAt ?? left.lastRequestedAt).getTime()
    ))
    .slice(0, limit);
  const payload: CachedAssetsResponse = {
    items: assets.map((asset) => ({ asset }))
  };

  logInfo("api.cached_assets.list", {
    requestId: context.requestId,
    line: line ?? "all",
    count: payload.items.length,
    limit,
    durationMs: durationMs(startedAt)
  });

  sendJson(response, 200, payload);
}

async function handleListMemberCodes(response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const codes = await accessStore.listMemberCodes();
  logInfo("api.admin.member_codes.list", {
    requestId: context.requestId,
    count: codes.length,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, { codes });
}

async function handleListMemberInvitations(response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const invitations = await accessStore.listMemberInvitations();
  const payload: MemberInvitationListResponse = { invitations };
  logInfo("api.admin.member_invitations.list", {
    requestId: context.requestId,
    count: invitations.length,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, payload);
}

async function handleListAdminMemberNotices(url: URL, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const limit = requestLimit(url, 50, 200);
  const notices = await accessStore.listMemberNotices({ limit });
  logInfo("api.admin.notices.list", {
    requestId: context.requestId,
    count: notices.length,
    limit,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, memberNoticePayload(notices));
}

async function handleCreateAdminMemberNotice(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const body = await readBody<CreateMemberNoticeRequest>(request);
  const title = body.title?.trim() ?? "";
  const noticeBody = body.body?.trim() ?? "";
  const audience = body.audience === "member" ? "member" : "all";
  const targetMemberId = body.targetMemberId?.trim();

  if (!title || !noticeBody) {
    sendJson(response, 400, { error: "通知标题和正文不能为空。" });
    return;
  }

  if (title.length > 120 || noticeBody.length > 4000) {
    sendJson(response, 400, { error: "通知内容过长。" });
    return;
  }

  if (audience === "member" && !targetMemberId) {
    sendJson(response, 400, { error: "请选择要发送的成员。" });
    return;
  }

  const notice = await accessStore.createMemberNotice({
    title,
    body: noticeBody,
    audience,
    targetMemberId,
    ...forumAuthor(identity)
  });
  if (!notice) {
    logWarn("api.admin.notices.create_target_not_found", {
      requestId: context.requestId,
      targetMemberId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "成员不存在。" });
    return;
  }

  logInfo("api.admin.notices.create", {
    requestId: context.requestId,
    noticeId: notice.id,
    audience: notice.audience,
    targetMemberId: notice.targetMemberId,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 201, { notice });
}

async function handleRegisterMember(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<RegisterMemberRequest>(request);
  const inviteCode = invitationCodeFromInput(body.inviteCode ?? "", "signup");
  const name = body.name?.trim() ?? "";
  const passcode = body.passcode ?? "";

  if (!inviteCode) {
    sendJson(response, 400, { error: "请输入邀请码。" });
    return;
  }

  if (!name) {
    sendJson(response, 400, { error: "成员名称不能为空。" });
    return;
  }

  const passcodeError = passcodeValidationError(passcode);
  if (passcodeError) {
    sendJson(response, 400, { error: passcodeError });
    return;
  }

  const result = await accessStore.registerMember({
    inviteCode,
    name,
    passcode
  });
  if (!result.ok) {
    logWarn("api.auth.register_failed", {
      requestId: context.requestId,
      reason: result.reason,
      durationMs: durationMs(startedAt)
    });
    sendInvitationClaimError(result.reason, response);
    return;
  }

  const identity = memberIdentityFromCode(result.code);
  await sessionStore.revokeSubject(sessionSubject(identity), undefined, "passcode_reset");
  await recordLoginAudit(request, identity, context);
  logInfo("api.auth.register", {
    requestId: context.requestId,
    memberId: result.code.id,
    name: result.code.name,
    remainingCredits: result.code.credits.remaining,
    durationMs: durationMs(startedAt)
  });
  await sendAuthenticatedSession(request, response, 201, identity, { code: result.code });
}

async function handleUpdateMemberProfile(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  if (identity.role !== "member" || !identity.memberId) {
    sendJson(response, 403, { error: "Only member accounts can update a profile here." });
    return;
  }

  const body = await readBody<UpdateMemberProfileRequest>(request);
  const name = body.name?.trim();
  const newPasscode = body.newPasscode ?? "";
  if (!name && !newPasscode) {
    sendJson(response, 400, { error: "请至少填写一个要更新的资料。" });
    return;
  }

  if (name !== undefined && !name) {
    sendJson(response, 400, { error: "成员名称不能为空。" });
    return;
  }

  const passcodeError = newPasscode ? passcodeValidationError(newPasscode) : undefined;
  if (passcodeError) {
    sendJson(response, 400, { error: passcodeError });
    return;
  }

  const result = await accessStore.updateMemberProfile(identity.memberId, {
    name,
    newPasscode: newPasscode || undefined
  });
  if (!result.ok) {
    logWarn("api.member.profile_update_failed", {
      requestId: context.requestId,
      memberId: identity.memberId,
      reason: result.reason,
      durationMs: durationMs(startedAt)
    });
    sendPasscodeUpdateError(result, response);
    return;
  }

  logInfo("api.member.profile_update", {
    requestId: context.requestId,
    memberId: result.code.id,
    nameChanged: Boolean(name),
    passcodeChanged: Boolean(newPasscode),
    durationMs: durationMs(startedAt)
  });
  if (newPasscode) await sessionStore.revokeSubject(sessionSubject(identity), context.session?.id, "passcode_changed");
  await sendAuthenticatedSession(request, response, 200, identity, { code: result.code });
}

async function handleLogin(request: http.IncomingMessage, response: http.ServerResponse, context: RequestContext) {
  const body = await readBody<{ passcode?: string }>(request);
  const passcode = body.passcode?.trim() ?? "";
  const identity = isAdminKey(passcode) ? { role: "admin" as const } : await accessStore.findMemberByCode(passcode);
  if (!identity) {
    logWarn("api.auth.login_denied", { requestId: context.requestId });
    sendJson(response, 401, { error: "Access key did not match." });
    return;
  }
  await recordLoginAudit(request, identity, context);
  await sendAuthenticatedSession(request, response, 200, identity);
}

async function handleChangeMemberPasscode(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  if (identity.role !== "member" || !identity.memberId) {
    sendJson(response, 403, { error: "Only member accounts can change a passcode here." });
    return;
  }

  const body = await readBody<ChangeMemberPasscodeRequest>(request);
  const currentPasscode = body.currentPasscode ?? "";
  const newPasscode = body.newPasscode ?? "";
  const passcodeError = passcodeValidationError(newPasscode);

  if (!currentPasscode) {
    sendJson(response, 400, { error: "请输入当前通行码。" });
    return;
  }

  if (passcodeError) {
    sendJson(response, 400, { error: passcodeError });
    return;
  }

  const result = await accessStore.changeMemberPasscode(identity.memberId, currentPasscode, newPasscode);
  if (!result.ok) {
    logWarn("api.auth.passcode_change_failed", {
      requestId: context.requestId,
      memberId: identity.memberId,
      reason: result.reason,
      durationMs: durationMs(startedAt)
    });
    sendPasscodeUpdateError(result, response);
    return;
  }

  logInfo("api.auth.passcode_change", {
    requestId: context.requestId,
    memberId: result.code.id,
    durationMs: durationMs(startedAt)
  });
  await sessionStore.revokeSubject(sessionSubject(identity), context.session?.id, "passcode_changed");
  await sendAuthenticatedSession(request, response, 200, identity, { code: result.code });
}

async function handleResetMemberPasscode(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<ResetMemberPasscodeRequest>(request);
  const inviteCode = invitationCodeFromInput(body.inviteCode ?? "", "reset");
  const newPasscode = body.newPasscode ?? "";
  const passcodeError = passcodeValidationError(newPasscode);

  if (!inviteCode) {
    sendJson(response, 400, { error: "请输入重置码。" });
    return;
  }

  if (passcodeError) {
    sendJson(response, 400, { error: passcodeError });
    return;
  }

  const result = await accessStore.resetMemberPasscode({ inviteCode, newPasscode });
  if (!result.ok) {
    logWarn("api.auth.passcode_reset_failed", {
      requestId: context.requestId,
      reason: result.reason,
      durationMs: durationMs(startedAt)
    });
    sendInvitationClaimError(result.reason, response);
    return;
  }

  const identity = memberIdentityFromCode(result.code);
  await recordLoginAudit(request, identity, context);
  logInfo("api.auth.passcode_reset", {
    requestId: context.requestId,
    memberId: result.code.id,
    durationMs: durationMs(startedAt)
  });
  await sendAuthenticatedSession(request, response, 200, identity, { code: result.code });
}

function creditUsagePayload(usage: MemberCreditUsageList): MemberCreditUsageResponse {
  return {
    member: {
      id: usage.code.id,
      name: usage.code.name,
      credits: usage.code.credits
    },
    entries: usage.entries
  };
}

async function handleListOwnCreditUsage(
  url: URL,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  if (identity.role !== "member" || !identity.memberId) {
    sendJson(response, 403, { error: "Only member accounts have a spending record." });
    return;
  }

  const limit = requestLimit(url, 50, 200);
  const usage = await accessStore.listMemberCreditUsage(identity.memberId, limit);
  if (!usage) {
    logWarn("api.member.credit_usage.not_found", {
      requestId: context.requestId,
      memberId: identity.memberId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Member was not found." });
    return;
  }

  logInfo("api.member.credit_usage.list", {
    requestId: context.requestId,
    memberId: identity.memberId,
    count: usage.entries.length,
    limit,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, creditUsagePayload(usage));
}

async function handleCreateMovieRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const requesterId = identity.role === "admin" ? adminMovieRequestMemberId : identity.memberId;
  const requesterName = identity.role === "admin" ? adminMovieRequestMemberName : identity.memberName;
  if (!requesterId) {
    sendJson(response, 403, { error: "Only signed-in accounts can request movies here." });
    return;
  }

  const body = await readBody<CreateMovieRequestRequest>(request);
  const text = body.text?.trim() ?? "";
  if (!text) {
    sendJson(response, 400, { error: "Please describe what you want to watch." });
    return;
  }

  if (text.length > 2000) {
    sendJson(response, 400, { error: "Movie request is too long." });
    return;
  }

  const entry = await accessStore.createMovieRequest({
    text,
    memberId: requesterId,
    memberName: requesterName
  });

  logInfo("api.member.movie_requests.create", {
    requestId: context.requestId,
    movieRequestId: entry.id,
    role: identity.role,
    memberId: requesterId,
    memberName: requesterName,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 201, { request: entry });
}

async function handleListOwnMovieRequests(
  url: URL,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const requesterId = identity.role === "admin" ? adminMovieRequestMemberId : identity.memberId;
  if (!requesterId) {
    sendJson(response, 403, { error: "Only signed-in accounts have movie requests." });
    return;
  }

  const limit = requestLimit(url, 50, 200);
  const requests = await accessStore.listMovieRequests({
    memberId: requesterId,
    limit
  });

  logInfo("api.member.movie_requests.list", {
    requestId: context.requestId,
    role: identity.role,
    memberId: requesterId,
    count: requests.length,
    limit,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, { requests });
}

function memberNoticePayload(notices: Awaited<ReturnType<typeof accessStore.listMemberNotices>>): MemberNoticeListResponse {
  return {
    notices,
    unreadCount: notices.filter((notice) => !notice.readAt).length
  };
}

async function handleListOwnMemberNotices(
  url: URL,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  if (identity.role !== "member" || !identity.memberId) {
    sendJson(response, 403, { error: "Only member accounts have an inbox." });
    return;
  }

  const limit = requestLimit(url, 50, 200);
  const notices = await accessStore.listMemberNotices({
    memberId: identity.memberId,
    limit
  });

  logInfo("api.member.notices.list", {
    requestId: context.requestId,
    memberId: identity.memberId,
    count: notices.length,
    unreadCount: notices.filter((notice) => !notice.readAt).length,
    limit,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, memberNoticePayload(notices));
}

async function handleMarkOwnMemberNoticeRead(
  noticeId: string,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  if (identity.role !== "member" || !identity.memberId) {
    sendJson(response, 403, { error: "Only member accounts have an inbox." });
    return;
  }

  const notice = await accessStore.markMemberNoticeRead(noticeId, identity.memberId);
  if (!notice) {
    logWarn("api.member.notices.read_not_found", {
      requestId: context.requestId,
      memberId: identity.memberId,
      noticeId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Notice was not found." });
    return;
  }

  logInfo("api.member.notices.read", {
    requestId: context.requestId,
    memberId: identity.memberId,
    noticeId,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, { notice });
}

async function handleListForumThreads(url: URL, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const limit = requestLimit(url, 50, 200);
  const payload: ForumThreadsResponse = {
    threads: await accessStore.listForumThreads(limit)
  };

  logInfo("api.forum.threads.list", {
    requestId: context.requestId,
    count: payload.threads.length,
    limit,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, payload);
}

async function handleCreateForumThread(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const author = forumAuthor(identity);
  if (!author.memberId) {
    sendJson(response, 403, { error: "Only signed-in accounts can post discussions." });
    return;
  }

  const body = await readBody<CreateForumThreadRequest>(request);
  const title = body.title?.trim() ?? "";
  const threadBody = body.body?.trim() ?? "";
  if (!title || !threadBody) {
    sendJson(response, 400, { error: "Title and body are required." });
    return;
  }

  if (title.length > 120 || threadBody.length > 5000) {
    sendJson(response, 400, { error: "Discussion title or body is too long." });
    return;
  }

  const thread = await accessStore.createForumThread({
    title,
    body: threadBody,
    ...author
  });

  logInfo("api.forum.threads.create", {
    requestId: context.requestId,
    threadId: thread.id,
    role: identity.role,
    memberId: author.memberId,
    memberName: author.memberName,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 201, { thread });
}

async function handleGetForumThread(
  threadId: string,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const thread = await accessStore.getForumThread(threadId);
  if (!thread) {
    logWarn("api.forum.threads.not_found", {
      requestId: context.requestId,
      threadId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Discussion thread was not found." });
    return;
  }

  const payload: ForumThreadResponse = { thread };
  logInfo("api.forum.threads.get", {
    requestId: context.requestId,
    threadId,
    replyCount: thread.replyCount,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, payload);
}

async function handleCreateForumReply(
  threadId: string,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const author = forumAuthor(identity);
  if (!author.memberId) {
    sendJson(response, 403, { error: "Only signed-in accounts can reply to discussions." });
    return;
  }

  const body = await readBody<CreateForumReplyRequest>(request);
  const replyBody = body.body?.trim() ?? "";
  if (!replyBody) {
    sendJson(response, 400, { error: "Reply body is required." });
    return;
  }

  if (replyBody.length > 5000) {
    sendJson(response, 400, { error: "Reply is too long." });
    return;
  }

  const result = await accessStore.createForumReply(threadId, {
    body: replyBody,
    ...author
  });
  if (!result) {
    logWarn("api.forum.replies.thread_not_found", {
      requestId: context.requestId,
      threadId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Discussion thread was not found." });
    return;
  }

  logInfo("api.forum.replies.create", {
    requestId: context.requestId,
    threadId,
    replyId: result.reply.id,
    role: identity.role,
    memberId: author.memberId,
    memberName: author.memberName,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 201, result);
}

async function handleListMemberCreditUsage(
  codeId: string,
  url: URL,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const limit = requestLimit(url, 50, 200);
  const usage = await accessStore.listMemberCreditUsage(codeId, limit);
  if (!usage) {
    logWarn("api.admin.member_codes.credit_usage_not_found", {
      requestId: context.requestId,
      memberCodeId: codeId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Member code was not found." });
    return;
  }

  logInfo("api.admin.member_codes.credit_usage", {
    requestId: context.requestId,
    memberCodeId: usage.code.id,
    name: usage.code.name,
    count: usage.entries.length,
    limit,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, creditUsagePayload(usage));
}

async function handleListLoginAudit(url: URL, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const limit = requestLimit(url, 50, 200);
  const events = await accessStore.listLoginAudit(limit);
  const payload: AdminLoginAuditResponse = { events };

  logInfo("api.admin.login_audit.list", {
    requestId: context.requestId,
    count: payload.events.length,
    limit,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, payload);
}

async function handleSetMemberCredits(
  codeId: string,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<SetMemberCreditsRequest>(request);
  const rawCredits = Number(body.credits);
  if (!Number.isFinite(rawCredits) || rawCredits < 0) {
    sendJson(response, 400, { error: "Credits must be zero or greater." });
    return;
  }
  const credits = Math.floor(rawCredits);

  const code = await accessStore.setMemberCredits(codeId, credits);
  if (!code) {
    logWarn("api.admin.member_codes.credits_set_not_found", {
      requestId: context.requestId,
      memberCodeId: codeId,
      credits,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Member code was not found." });
    return;
  }

  logInfo("api.admin.member_codes.credits_set", {
    requestId: context.requestId,
    memberCodeId: code.id,
    name: code.name,
    remainingCredits: code.credits.remaining,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, { code });
}

async function handleAdjustMemberCredits(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<AdjustMemberCreditsRequest>(request);
  const rawDelta = Number(body.delta);
  if (!Number.isFinite(rawDelta) || rawDelta === 0) {
    sendJson(response, 400, { error: "Credit adjustment must be a non-zero number." });
    return;
  }

  const delta = Math.trunc(rawDelta);
  const result = await accessStore.adjustMemberCredits(delta);

  logInfo("api.admin.member_codes.credits_adjust", {
    requestId: context.requestId,
    delta: result.delta,
    adjustedCount: result.adjustedCount,
    memberCount: result.codes.length,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, result);
}

async function handleListMovieRequests(url: URL, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const limit = requestLimit(url, 100, 200);
  const requests = await accessStore.listMovieRequests({ limit });
  const payload: MovieRequestsResponse = { requests };

  logInfo("api.admin.movie_requests.list", {
    requestId: context.requestId,
    count: payload.requests.length,
    limit,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, payload);
}

async function handleUpdateMovieRequestStatus(
  movieRequestId: string,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<UpdateMovieRequestStatusRequest>(request);
  const status = movieRequestStatus(body.status);
  if (!status) {
    sendJson(response, 400, { error: "Movie request status is invalid." });
    return;
  }

  const entry = await accessStore.updateMovieRequestStatus(movieRequestId, status);
  if (!entry) {
    logWarn("api.admin.movie_requests.status_not_found", {
      requestId: context.requestId,
      movieRequestId,
      status,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Movie request was not found." });
    return;
  }

  logInfo("api.admin.movie_requests.status", {
    requestId: context.requestId,
    movieRequestId: entry.id,
    memberId: entry.requestedByMemberId,
    status: entry.status,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, { request: entry });
}

async function handleListCacheJobs(url: URL, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const limit = requestLimit(url, 20, 100);
  const jobs = await store.listRecentJobs(limit);
  const assetKeys = Array.from(new Set(jobs.map((job) => job.assetKey)));
  const assets = await store.listAssets(assetKeys);
  const payload: AdminCacheJobsResponse = {
    jobs: jobs.map((job) => {
      const asset = assets[job.assetKey];
      return {
        job,
        asset: asset?.jobId === job.id ? asset : undefined
      };
    })
  };

  logInfo("api.admin.cache_jobs.list", {
    requestId: context.requestId,
    count: payload.jobs.length,
    limit,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, payload);
}

async function handleSearchIndexStats(response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const stats = await searchIndex.getStats();

  logInfo("api.admin.search_index.stats", {
    requestId: context.requestId,
    entryCount: stats.entryCount,
    latestIndexedAt: stats.latestIndexedAt,
    latestSourceUpdatedAt: stats.latestSourceUpdatedAt,
    lastFullSyncAt: stats.lastFullSyncAt,
    lastIncrementalSyncAt: stats.lastIncrementalSyncAt,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, { stats });
}

function ossPreparationError(value: unknown) {
  const text = value instanceof Error ? value.message : String(value ?? "Domestic playback preparation failed.");
  return text
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[private source]")
    .replace(/[A-Za-z]:\\[^\s"'<>]+/g, "[local path]")
    .slice(0, 500);
}

function ossObjectExtension(result: SearchResult) {
  const metadata = result.metadata as Record<string, unknown> | undefined;
  const fileName = String(metadata?.fileName ?? metadata?.originalFileName ?? result.sourceUrl ?? "");
  const match = /\.([A-Za-z0-9]{2,5})(?:$|[?#])/i.exec(fileName);
  const extension = match?.[1]?.toLowerCase();
  return extension && ["mp4", "m4v", "mov", "webm"].includes(extension) ? extension : "mp4";
}

function ossPreparationObjectKey(result: SearchResult) {
  const digest = createHash("sha256").update(result.assetKey, "utf8").digest("hex").slice(0, 32);
  const prefix = (process.env.ALIYUN_OSS_OBJECT_PREFIX ?? "wwpdw/prepared").replace(/^\/+|\/+$/g, "");
  return `${prefix}/${digest}.${ossObjectExtension(result)}`;
}

function ossExpectedBytes(result: SearchResult) {
  const variant = result.variants?.find((item) => item.assetKey === result.assetKey);
  const exact = Number(
    variant?.metadata?.exactByteSize
      ?? (result.metadata as Record<string, unknown> | undefined)?.exactByteSize
  );
  return Number.isSafeInteger(exact) && exact > 0 ? exact : undefined;
}

function ossApproximateBytes(result: SearchResult) {
  const variant = result.variants?.find((item) => item.assetKey === result.assetKey);
  const approximateSizeGb = Number(
    variant?.metadata?.approximateSizeGb
      ?? (result.metadata as Record<string, unknown> | undefined)?.approximateSizeGb
  );
  return Number.isFinite(approximateSizeGb) && approximateSizeGb > 0
    ? Math.round(approximateSizeGb * 1_000_000_000)
    : undefined;
}

function sourceBytesFromContentRange(value: string | null) {
  const match = /\/([0-9]+)$/.exec(value ?? "");
  const parsed = Number(match?.[1]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function probeOssSourceBytes(sourceUrl: string) {
  let pending = ossSourceSizeCache.get(sourceUrl);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(sourceUrl, {
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000)
      });
      try {
        if (response.status !== 206 && response.status !== 200) return undefined;
        return sourceBytesFromContentRange(response.headers.get("content-range"))
          ?? (response.status === 200 ? Number(response.headers.get("content-length")) || undefined : undefined);
      } finally {
        await response.body?.cancel().catch(() => undefined);
      }
    })().catch(() => undefined);
    ossSourceSizeCache.set(sourceUrl, pending);
  }
  return pending;
}

async function resolvedOssExpectedBytes(result: SearchResult) {
  return ossExpectedBytes(result)
    ?? await probeOssSourceBytes(result.sourceUrl)
    ?? ossApproximateBytes(result);
}

async function cachedOssMultipartProgress(objectKey: string) {
  const cached = ossMultipartProgressCache.get(objectKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const value = aliyunOssStorage.multipartProgress(objectKey).catch(() => undefined);
  ossMultipartProgressCache.set(objectKey, {
    expiresAt: Date.now() + ossMultipartProgressCacheMs,
    value
  });
  return value;
}

function ossTransferProgress(transferredBytes: number, expectedBytes: number | undefined) {
  if (!expectedBytes || expectedBytes <= 0) return 0;
  return Math.min(99, Math.max(transferredBytes > 0 ? 1 : 0, Math.floor((transferredBytes / expectedBytes) * 100)));
}

function ossTransferSizeLabel(value: number) {
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  if (value >= 1024 ** 2) return `${Math.round(value / 1024 ** 2)} MB`;
  return `${Math.round(value / 1024)} KB`;
}

async function ensureOssPreparationForResult(result: SearchResult, context: RequestContext) {
  const existing = await ossPreparationStore.findByAssetKey(result.assetKey);
  if (existing && !["failed", "cancelled"].includes(existing.status)) {
    return {
      created: false,
      job: await syncOssPreparationJob(existing)
    };
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const job: OssPreparationJob = {
    id,
    taskId: `wwpdw-${id}`,
    assetKey: result.assetKey,
    title: result.title,
    sourceUrl: result.sourceUrl,
    objectKey: ossPreparationObjectKey(result),
    status: "queued",
    progress: 0,
    progressDeterminate: false,
    message: "正在排队，轮到后会自动开始。",
    expectedBytes: await resolvedOssExpectedBytes(result),
    createdAt: now,
    updatedAt: now
  };
  await ossPreparationStore.put(job);
  try {
    await aliyunFcPrepare.invoke({
      jobId: job.id,
      objectKey: job.objectKey,
      sourceUrl: job.sourceUrl,
      title: job.title,
      contentType: "video/mp4",
      expectedBytes: job.expectedBytes
    });
    logInfo("api.oss_preparation.created", {
      requestId: context.requestId,
      jobId: job.id,
      assetKey: job.assetKey,
      objectKey: job.objectKey,
      expectedBytes: job.expectedBytes
    });
    return { created: true, job };
  } catch (error) {
    const failed: OssPreparationJob = {
      ...job,
      status: "failed",
      progress: 100,
      progressDeterminate: true,
      message: "准备任务未能启动。",
      error: ossPreparationError(error),
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    };
    await ossPreparationStore.put(failed);
    throw error;
  }
}

async function syncOssPreparationJob(job: OssPreparationJob) {
  if (["ready", "failed", "cancelled"].includes(job.status)) return job;
  const task = await aliyunFcPrepare.getTask(job.taskId);
  const now = new Date().toISOString();
  let next: OssPreparationJob = { ...job, updatedAt: now };
  if (task.status === "Enqueued") {
    next = {
      ...next,
      status: "queued",
      progress: 0,
      progressDeterminate: false,
      message: "正在排队，轮到后会自动开始。"
    };
  } else if (["Running", "Retrying"].includes(task.status)) {
    const expectedBytes = job.expectedBytes ?? await probeOssSourceBytes(job.sourceUrl);
    const transfer = await cachedOssMultipartProgress(job.objectKey);
    const transferredBytes = transfer?.transferredBytes ?? job.transferredBytes ?? 0;
    const progressDeterminate = Boolean(expectedBytes && transfer);
    next = {
      ...next,
      status: "running",
      progress: progressDeterminate ? ossTransferProgress(transferredBytes, expectedBytes) : 0,
      progressDeterminate,
      expectedBytes,
      transferredBytes,
      partCount: transfer?.partCount ?? job.partCount,
      lastProgressAt: transfer?.lastProgressAt ?? job.lastProgressAt,
      message: progressDeterminate
        ? `正在准备国内线路，已完成 ${ossTransferSizeLabel(transferredBytes)} / ${ossTransferSizeLabel(expectedBytes!)}。`
        : "正在准备国内线路，等待首个分片完成。"
    };
  } else if (task.status === "Succeeded") {
    const object = await aliyunOssStorage.head(job.objectKey);
    if (!object) {
      next = {
        ...next,
        status: "failed",
        progress: 100,
        progressDeterminate: true,
        message: "任务已结束，但国内线路文件没有生成。",
        error: "Prepared object was not found after task completion.",
        completedAt: now
      };
    } else {
      next = {
        ...next,
        status: "ready",
        progress: 100,
        progressDeterminate: true,
        message: "准备完成，可以播放。",
        contentLength: object.contentLength,
        contentType: object.contentType,
        completedAt: job.completedAt ?? now,
        // Existing OSS rows predate idle tracking. Start their first retention
        // window now instead of deleting them from an old completion timestamp.
        expiresAt: job.expiresAt ?? ossIdleExpiresAt(now),
        error: undefined
      };
    }
  } else if (["Stopped", "Stopping"].includes(task.status)) {
    next = {
      ...next,
      status: task.status === "Stopped" ? "cancelled" : "cancelling",
      progress: task.status === "Stopped" ? 100 : next.progress,
      progressDeterminate: task.status === "Stopped" ? true : next.progressDeterminate,
      message: task.status === "Stopped" ? "已取消。" : "正在取消…",
      completedAt: task.status === "Stopped" ? now : undefined
    };
  } else if (["Failed", "Invalid", "Expired"].includes(task.status)) {
    next = {
      ...next,
      status: "failed",
      progress: 100,
      progressDeterminate: true,
      message: "准备失败。",
      error: ossPreparationError(task.error ?? task.status),
      completedAt: now
    };
  }
  if (
    next.status !== job.status
    || next.progress !== job.progress
    || next.progressDeterminate !== job.progressDeterminate
    || next.expectedBytes !== job.expectedBytes
    || next.transferredBytes !== job.transferredBytes
    || next.partCount !== job.partCount
    || next.lastProgressAt !== job.lastProgressAt
    || next.message !== job.message
    || next.error !== job.error
  ) {
    await ossPreparationStore.put(next);
  }
  return next;
}

async function handleCreateOssPreparation(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const body = await readBody<{ assetKey?: string }>(request);
  const assetKey = body.assetKey?.trim();
  if (!assetKey) {
    sendJson(response, 400, { error: "请选择要准备的片源。" });
    return;
  }
  if (!aliyunFcPrepare.enabled || !aliyunOssStorage.enabled) {
    sendJson(response, 503, {
      error: aliyunFcPrepare.reason ?? aliyunOssStorage.reason ?? "国内线路准备尚未配置。"
    });
    return;
  }

  let candidate = recentResults.get(assetKey);
  if (!candidate) {
    candidate = findSearchResultByAssetKey(await searchIndex.search(assetKey, 8), assetKey);
  }
  if (!candidate) {
    sendJson(response, 404, { error: "没有找到这个片源，请先在本页重新搜索。" });
    return;
  }
  const result = await refreshResultBeforeCache(candidate, context);
  if (!result.sourceUrl?.startsWith("https://")) {
    sendJson(response, 422, { error: "这个片源暂时没有可用的 HTTPS 来源。" });
    return;
  }
  const output = await ensureOssPreparationForResult(result, context);
  sendJson(response, output.created ? 202 : 200, {
    job: ossPreparationStore.toPublic(output.job)
  });
}

async function handleListOssPreparations(
  url: URL,
  response: http.ServerResponse,
  context: RequestContext
) {
  const jobs = await ossPreparationStore.list(requestLimit(url, 20, 100));
  const synced = await Promise.all(jobs.map(async (job) => {
    try {
      return await syncOssPreparationJob(job);
    } catch (error) {
      logWarn("api.admin.oss_preparation.sync_failed", {
        requestId: context.requestId,
        jobId: job.id,
        ...errorLogFields(error)
      });
      return job;
    }
  }));
  sendJson(response, 200, {
    enabled: aliyunFcPrepare.enabled && aliyunOssStorage.enabled,
    concurrency: 2,
    jobs: synced.map((job) => ossPreparationStore.toPublic(job))
  }, { "Cache-Control": "no-store" });
}

async function handleGetOssPreparation(
  id: string,
  response: http.ServerResponse
) {
  const job = await ossPreparationStore.get(id);
  if (!job) {
    sendJson(response, 404, { error: "准备任务不存在。" });
    return;
  }
  sendJson(response, 200, {
    job: ossPreparationStore.toPublic(await syncOssPreparationJob(job))
  }, { "Cache-Control": "no-store" });
}

async function handleCancelOssPreparation(id: string, response: http.ServerResponse) {
  const job = await ossPreparationStore.get(id);
  if (!job) {
    sendJson(response, 404, { error: "准备任务不存在。" });
    return;
  }
  if (!["queued", "running", "cancelling"].includes(job.status)) {
    sendJson(response, 409, { error: "这个任务已经结束，不能再取消。" });
    return;
  }
  await aliyunFcPrepare.stop(job.taskId);
  const next: OssPreparationJob = {
    ...job,
    status: "cancelling",
    message: "正在取消…",
    updatedAt: new Date().toISOString()
  };
  await ossPreparationStore.put(next);
  sendJson(response, 202, { job: ossPreparationStore.toPublic(next) });
}

async function handleDeleteOssPreparation(id: string, response: http.ServerResponse) {
  const job = await ossPreparationStore.get(id);
  if (!job) {
    sendJson(response, 404, { error: "准备任务不存在。" });
    return;
  }
  if (["queued", "running", "cancelling"].includes(job.status)) {
    sendJson(response, 409, { error: "请先取消任务，确认停止后再删除。" });
    return;
  }
  await aliyunOssStorage.delete(job.objectKey).catch((error) => {
    const status = (error as { status?: number; statusCode?: number }).status
      ?? (error as { statusCode?: number }).statusCode;
    if (status !== 404) throw error;
  });
  await ossPreparationStore.delete(id);
  sendJson(response, 200, { ok: true });
}

async function handleOssPreparationSignedUrl(id: string, response: http.ServerResponse) {
  let job = await ossPreparationStore.get(id);
  if (!job || job.status !== "ready") {
    sendJson(response, 409, { error: "片源尚未准备完成。" });
    return;
  }
  try {
    job = await markOssPlayback(job);
  } catch (error) {
    if (error instanceof OssPreparationCleanupClaimedError) {
      sendJson(response, 409, { error: "国内线路资源正在过期清理。" });
      return;
    }
    throw error;
  }
  sendJson(response, 200, aliyunOssStorage.createSignedUrl(job.objectKey), {
    "Cache-Control": "no-store"
  });
}

function handleAliyunOssPocStatus(response: http.ServerResponse, context: RequestContext) {
  const status = aliyunOssPoc.status();
  logInfo("api.admin.oss_playback_poc.status", {
    requestId: context.requestId,
    enabled: status.enabled
  });
  sendJson(
    response,
    200,
    {
      ...status,
      mediaUrl: status.enabled ? "/api/admin/oss-playback-poc/media" : undefined
    },
    { "Cache-Control": "no-store" }
  );
}

function handleAliyunOssPocSignedUrl(response: http.ServerResponse, context: RequestContext) {
  try {
    const signed = aliyunOssPoc.createSignedUrl();
    logInfo("api.admin.oss_playback_poc.signed_url", {
      requestId: context.requestId,
      expiresAt: signed.expiresAt
    });
    sendJson(response, 200, signed, { "Cache-Control": "no-store" });
  } catch (error) {
    if (error instanceof AliyunOssPocUnavailableError) {
      logWarn("api.admin.oss_playback_poc.unavailable", {
        requestId: context.requestId,
        message: error.message
      });
      sendJson(response, 503, { error: error.message });
      return;
    }
    throw error;
  }
}

async function handleRetryCacheJob(jobId: string, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const job = await store.getJob(jobId);
  if (!job || job.status !== "failed") {
    logWarn("api.admin.cache_jobs.retry_not_found", {
      requestId: context.requestId,
      jobId,
      status: job?.status,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Failed cache job was not found." });
    return;
  }

  const refreshedResult = await refreshRetrySource(job, context);
  const activeJobsBefore = await store.listActiveJobs(1);
  const output = await store.retryJob(jobId, refreshedResult);
  if (!output) {
    logWarn("api.admin.cache_jobs.retry_not_found", {
      requestId: context.requestId,
      jobId,
      status: job.status,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Failed cache job was not found." });
    return;
  }

  const trigger = activeJobsBefore.length === 0
    ? await workerTrigger.start(output.job)
    : {
      status: "skipped" as const,
      message: "Worker trigger skipped because active cache jobs already exist."
    };

  logInfo("api.admin.cache_jobs.retry", {
    requestId: context.requestId,
    jobId: output.job.id,
    assetKey: output.job.assetKey,
    sourceRefreshed: Boolean(refreshedResult),
    sourcePageId: output.job.sourcePageId,
    breadcrumbDepth: output.job.sourceBreadcrumb?.length,
    activeJobsBefore: activeJobsBefore.length,
    triggerStatus: trigger.status,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, {
    ...output,
    trigger
  });
}

async function handleDeleteCacheJob(jobId: string, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const result: DeleteCacheEntryResponse = await store.deleteCacheEntry({ jobId });
  if (!result.deletedAsset && !result.deletedJob && result.errors.length === 0) {
    logWarn("api.admin.cache_jobs.delete_not_found", {
      requestId: context.requestId,
      jobId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Cache job was not found." });
    return;
  }

  logInfo("api.admin.cache_jobs.delete", {
    requestId: context.requestId,
    jobId,
    assetKey: result.assetKey,
    deletedAsset: result.deletedAsset,
    deletedJob: result.deletedJob,
    deletedBlob: result.deletedBlob,
    errorCount: result.errors.length,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, result);
}

async function handleDeleteCacheAsset(assetKey: string, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const result: DeleteCacheEntryResponse = await store.deleteCacheEntry({ assetKey });
  if (!result.deletedAsset && !result.deletedJob && result.errors.length === 0) {
    logWarn("api.admin.assets.delete_not_found", {
      requestId: context.requestId,
      assetKey,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Cached asset was not found." });
    return;
  }

  logInfo("api.admin.assets.delete", {
    requestId: context.requestId,
    assetKey: result.assetKey,
    jobId: result.jobId,
    deletedAsset: result.deletedAsset,
    deletedJob: result.deletedJob,
    deletedBlob: result.deletedBlob,
    errorCount: result.errors.length,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, result);
}

async function handleCreateSignupInvitation(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<CreateSignupInvitationRequest>(request);
  const invitation = await accessStore.createSignupInvitation({
    credits: body.credits
  });
  logInfo("api.admin.member_invitations.signup_create", {
    requestId: context.requestId,
    invitationId: invitation.id,
    remainingCredits: invitation.credits?.remaining,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 201, { invitation });
}

async function handleCreateResetInvitation(
  memberId: string,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const invitation = await accessStore.createResetInvitation(memberId);
  if (!invitation) {
    logWarn("api.admin.member_invitations.reset_create_not_found", {
      requestId: context.requestId,
      memberId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Member was not found." });
    return;
  }

  const payload: CreateResetInvitationResponse = { invitation };
  logInfo("api.admin.member_invitations.reset_create", {
    requestId: context.requestId,
    invitationId: invitation.id,
    memberId,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 201, payload);
}

async function handleRevokeMemberCode(
  codeId: string,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const code = await accessStore.revokeMemberCode(codeId);
  if (!code) {
    logWarn("api.admin.member_codes.not_found", {
      requestId: context.requestId,
      memberCodeId: codeId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Member code was not found." });
    return;
  }

  logInfo("api.admin.member_codes.revoke", {
    requestId: context.requestId,
    memberCodeId: code.id,
    name: code.name,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, { code });
}

async function handleDeleteMemberCode(
  codeId: string,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const deleted = await accessStore.deleteMemberCode(codeId);
  if (!deleted) {
    logWarn("api.admin.member_codes.delete_not_found", {
      requestId: context.requestId,
      memberCodeId: codeId,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Member code was not found." });
    return;
  }

  logInfo("api.admin.member_codes.delete", {
    requestId: context.requestId,
    memberCodeId: codeId,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, { ok: true });
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
  const startedAt = Date.now();
  const requestId = requestIdFromHeader(request);
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = url.pathname;
  const context: RequestContext = {
    requestId,
    method: request.method ?? "UNKNOWN",
    path: pathname,
    startedAt
  };
  response.setHeader(requestIdHeaderName, requestId);
  const corsAllowed = applyCors(request, response);

  try {
    if (request.method === "OPTIONS") {
      sendJson(response, corsAllowed ? 204 : 403, corsAllowed ? {} : { error: "Origin is not allowed." });
      return;
    }

    if (request.method === "GET" && (pathname === "/health" || pathname === "/api/health")) {
      const capacity = playbackCapacity();
      sendJson(response, 200, {
        ok: true,
        access: Boolean(adminKey),
        store: await store.getHealth(),
        accessStore: await accessStore.getHealth(),
        search: searchSource.description,
        searchIndex: {
          enabled: searchIndexEnabled,
          ...(await searchIndex.getHealth())
        },
        playback: {
          activeStreams: capacity.active,
          maximumStreams: maximumPlaybackStreams,
          grantMinutes: playbackGrantMinutes,
          activeConnections: activePlaybackStreams,
          queued: capacity.queued,
          level: capacity.level,
          queueEnabled: capacity.enabled
        }
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/register") {
      await handleRegisterMember(request, response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/reset-passcode") {
      await handleResetMemberPasscode(request, response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      await handleLogin(request, response, context);
      return;
    }

    let identity: AccessIdentity | undefined;
    if (pathname.startsWith("/api/")) {
      identity = await requireAccess(request, response, context);
      if (!identity) {
        return;
      }
    }

    if (request.method === "GET" && pathname === "/api/auth/check") {
      logInfo("api.auth.check", {
        requestId,
        role: identity?.role,
        memberId: identity?.memberId
      });
      sendJson(response, 200, { ...authPayload(identity!), csrfToken: context.session!.csrfToken });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/logout") {
      await sessionStore.revoke(context.session!.id, "logout");
      sendJson(response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/logout-all") {
      await sessionStore.revokeSubject(sessionSubject(identity!), context.session!.id, "logout_all");
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/auth/sessions") {
      const sessions = await sessionStore.listForSubject(sessionSubject(identity!));
      sendJson(response, 200, { sessions: sessions.map(({ secretHash, csrfToken, ...session }) => ({ ...session, current: session.id === context.session!.id })) });
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/sessions") {
      if (!requireAdmin(identity, response, context)) return;
      const sessions = await sessionStore.listActive();
      sendJson(response, 200, { sessions: sessions.map(({ secretHash, csrfToken, ...session }) => session) });
      return;
    }

    const publicOssPlaybackMatch = pathname.match(/^\/api\/oss-playback\/([^/]+)\/(signed-url|media)$/);
    if (request.method === "GET" && publicOssPlaybackMatch) {
      const jobId = decodeURIComponent(publicOssPlaybackMatch[1]);
      if (publicOssPlaybackMatch[2] === "signed-url") {
        await handleOssPreparationSignedUrl(jobId, response);
      } else {
        sendJson(response, 409, {
          error: "国内线路播放请求需要浏览器播放适配器。"
        });
      }
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/oss-playback-poc") {
      if (!requireAdmin(identity, response, context)) return;
      handleAliyunOssPocStatus(response, context);
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/oss-playback-poc/signed-url") {
      if (!requireAdmin(identity, response, context)) return;
      handleAliyunOssPocSignedUrl(response, context);
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/oss-playback-poc/media") {
      if (!requireAdmin(identity, response, context)) return;
      sendJson(response, 409, {
        error: "Domestic playback requests require the browser playback adapter."
      });
      return;
    }

    if (pathname === "/api/admin/oss-preparations") {
      if (!requireAdmin(identity, response, context)) return;
      if (request.method === "GET") {
        await handleListOssPreparations(url, response, context);
        return;
      }
      if (request.method === "POST") {
        await handleCreateOssPreparation(request, response, context);
        return;
      }
    }

    const ossPreparationMatch = pathname.match(/^\/api\/admin\/oss-preparations\/([^/]+)$/);
    if (ossPreparationMatch) {
      if (!requireAdmin(identity, response, context)) return;
      const jobId = decodeURIComponent(ossPreparationMatch[1]);
      if (request.method === "GET") {
        await handleGetOssPreparation(jobId, response);
        return;
      }
      if (request.method === "DELETE") {
        await handleDeleteOssPreparation(jobId, response);
        return;
      }
    }

    const ossPreparationCancelMatch = pathname.match(/^\/api\/admin\/oss-preparations\/([^/]+)\/cancel$/);
    if (request.method === "POST" && ossPreparationCancelMatch) {
      if (!requireAdmin(identity, response, context)) return;
      await handleCancelOssPreparation(decodeURIComponent(ossPreparationCancelMatch[1]), response);
      return;
    }

    const ossPreparationSignedUrlMatch = pathname.match(/^\/api\/admin\/oss-preparations\/([^/]+)\/signed-url$/);
    if (request.method === "GET" && ossPreparationSignedUrlMatch) {
      if (!requireAdmin(identity, response, context)) return;
      await handleOssPreparationSignedUrl(decodeURIComponent(ossPreparationSignedUrlMatch[1]), response);
      return;
    }

    const ossPreparationMediaMatch = pathname.match(/^\/api\/admin\/oss-preparations\/([^/]+)\/media$/);
    if (request.method === "GET" && ossPreparationMediaMatch) {
      if (!requireAdmin(identity, response, context)) return;
      sendJson(response, 409, {
        error: "Domestic playback requests require the browser playback adapter."
      });
      return;
    }

    if (request.method === "DELETE" && pathname.startsWith("/api/admin/sessions/")) {
      if (!requireAdmin(identity, response, context)) return;
      const sessionId = pathname.slice("/api/admin/sessions/".length);
      if (!await sessionStore.revoke(sessionId, "admin_revoked")) {
        sendJson(response, 404, { error: "Session was not found." });
        return;
      }
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "DELETE" && pathname.startsWith("/api/auth/sessions/")) {
      const sessionId = pathname.slice("/api/auth/sessions/".length);
      const sessions = await sessionStore.listForSubject(sessionSubject(identity!));
      if (!sessions.some((session) => session.id === sessionId)) {
        sendJson(response, 404, { error: "Session was not found." });
        return;
      }
      await sessionStore.revoke(sessionId, "device_logout");
      sendJson(response, 200, { ok: true }, sessionId === context.session!.id ? { "Set-Cookie": clearSessionCookie() } : {});
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/passcode") {
      await handleChangeMemberPasscode(request, response, context, identity!);
      return;
    }

    if (request.method === "POST" && pathname === "/api/member/profile") {
      await handleUpdateMemberProfile(request, response, context, identity!);
      return;
    }

    if (request.method === "GET" && pathname === "/api/member/credit-usage") {
      await handleListOwnCreditUsage(url, response, context, identity!);
      return;
    }

    if (request.method === "GET" && pathname === "/api/member/movie-requests") {
      await handleListOwnMovieRequests(url, response, context, identity!);
      return;
    }

    if (request.method === "POST" && pathname === "/api/member/movie-requests") {
      await handleCreateMovieRequest(request, response, context, identity!);
      return;
    }

    if (request.method === "GET" && pathname === "/api/member/notices") {
      await handleListOwnMemberNotices(url, response, context, identity!);
      return;
    }

    const memberNoticeReadMatch = pathname.match(/^\/api\/member\/notices\/([^/]+)\/read$/);
    if (request.method === "POST" && memberNoticeReadMatch) {
      await handleMarkOwnMemberNoticeRead(decodeURIComponent(memberNoticeReadMatch[1]), response, context, identity!);
      return;
    }

    if (request.method === "GET" && pathname === "/api/forum/threads") {
      await handleListForumThreads(url, response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/forum/threads") {
      await handleCreateForumThread(request, response, context, identity!);
      return;
    }

    const forumThreadMatch = pathname.match(/^\/api\/forum\/threads\/([^/]+)$/);
    if (request.method === "GET" && forumThreadMatch) {
      await handleGetForumThread(decodeURIComponent(forumThreadMatch[1]), response, context);
      return;
    }

    const forumReplyMatch = pathname.match(/^\/api\/forum\/threads\/([^/]+)\/replies$/);
    if (request.method === "POST" && forumReplyMatch) {
      await handleCreateForumReply(decodeURIComponent(forumReplyMatch[1]), request, response, context, identity!);
      return;
    }

    if (pathname === "/api/admin/login-audit" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/login-audit") {
      await handleListLoginAudit(url, response, context);
      return;
    }

    if (pathname === "/api/admin/movie-requests" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/movie-requests") {
      await handleListMovieRequests(url, response, context);
      return;
    }

    const movieRequestStatusMatch = pathname.match(/^\/api\/admin\/movie-requests\/([^/]+)\/status$/);
    if (movieRequestStatusMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && movieRequestStatusMatch) {
      await handleUpdateMovieRequestStatus(decodeURIComponent(movieRequestStatusMatch[1]), request, response, context);
      return;
    }

    if (pathname === "/api/admin/notices" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/notices") {
      await handleListAdminMemberNotices(url, response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/notices") {
      await handleCreateAdminMemberNotice(request, response, context, identity!);
      return;
    }

    if (pathname === "/api/admin/member-codes" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/member-codes") {
      await handleListMemberCodes(response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/member-codes") {
      sendJson(response, 410, { error: "管理员不再直接创建成员，请改用邀请码。" });
      return;
    }

    if (pathname === "/api/admin/member-invitations" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/member-invitations") {
      await handleListMemberInvitations(response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/member-invitations") {
      await handleCreateSignupInvitation(request, response, context);
      return;
    }

    if (pathname === "/api/admin/member-codes/credits/adjust" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/member-codes/credits/adjust") {
      await handleAdjustMemberCredits(request, response, context);
      return;
    }

    if (pathname === "/api/admin/cache-jobs" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/cache-jobs") {
      await handleListCacheJobs(url, response, context);
      return;
    }

    if (pathname === "/api/admin/search-index" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/search-index") {
      await handleSearchIndexStats(response, context);
      return;
    }

    const retryCacheJobMatch = pathname.match(/^\/api\/admin\/cache-jobs\/([^/]+)\/retry$/);
    if (retryCacheJobMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && retryCacheJobMatch) {
      await handleRetryCacheJob(decodeURIComponent(retryCacheJobMatch[1]), response, context);
      return;
    }

    const deleteCacheJobMatch = pathname.match(/^\/api\/admin\/cache-jobs\/([^/]+)\/delete$/);
    if (deleteCacheJobMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && deleteCacheJobMatch) {
      await handleDeleteCacheJob(decodeURIComponent(deleteCacheJobMatch[1]), response, context);
      return;
    }

    const deleteCacheAssetMatch = pathname.match(/^\/api\/admin\/assets\/([^/]+)\/delete$/);
    if (deleteCacheAssetMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && deleteCacheAssetMatch) {
      await handleDeleteCacheAsset(decodeURIComponent(deleteCacheAssetMatch[1]), response, context);
      return;
    }

    const setMemberCreditsMatch = pathname.match(/^\/api\/admin\/member-codes\/([^/]+)\/credits$/);
    if (setMemberCreditsMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && setMemberCreditsMatch) {
      await handleSetMemberCredits(decodeURIComponent(setMemberCreditsMatch[1]), request, response, context);
      return;
    }

    const memberCreditUsageMatch = pathname.match(/^\/api\/admin\/member-codes\/([^/]+)\/credit-usage$/);
    if (memberCreditUsageMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && memberCreditUsageMatch) {
      await handleListMemberCreditUsage(decodeURIComponent(memberCreditUsageMatch[1]), url, response, context);
      return;
    }

    const createResetInvitationMatch = pathname.match(/^\/api\/admin\/member-codes\/([^/]+)\/reset-invitation$/);
    if (createResetInvitationMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && createResetInvitationMatch) {
      await handleCreateResetInvitation(decodeURIComponent(createResetInvitationMatch[1]), response, context);
      return;
    }

    const revokeMemberCodeMatch = pathname.match(/^\/api\/admin\/member-codes\/([^/]+)\/revoke$/);
    if (revokeMemberCodeMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && revokeMemberCodeMatch) {
      await handleRevokeMemberCode(decodeURIComponent(revokeMemberCodeMatch[1]), response, context);
      return;
    }

    const deleteMemberCodeMatch = pathname.match(/^\/api\/admin\/member-codes\/([^/]+)\/delete$/);
    if (deleteMemberCodeMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && deleteMemberCodeMatch) {
      await handleDeleteMemberCode(decodeURIComponent(deleteMemberCodeMatch[1]), response, context);
      return;
    }

    if (request.method === "GET" && pathname === "/api/search") {
      await handleSearch(url, response, context);
      return;
    }

    const libraryAssetMatch = pathname.match(/^\/api\/library-assets\/([^/]+)$/);
    if (request.method === "GET" && libraryAssetMatch) {
      await handleLibraryAsset(decodeURIComponent(libraryAssetMatch[1]), response, context);
      return;
    }

    if (pathname === "/api/admin/people/issues" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/people/issues") {
      sendJson(response, 200, listPublicPersonIssues(await personCatalog.getState()));
      return;
    }

    if (request.method === "GET" && pathname === "/api/people") {
      const state = await personCatalog.getState();
      const visibleWorkIds = await visiblePersonWorkIds();
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 20)));
      const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));
      sendJson(response, 200, listPublicPeople(state, {
        query: url.searchParams.get("q") ?? undefined,
        department: url.searchParams.get("department") as never,
        limit,
        offset,
        visibleWorkIds
      }));
      return;
    }

    const personMatch = pathname.match(/^\/api\/people\/([^/]+)$/);
    if (request.method === "GET" && personMatch) {
      const state = await personCatalog.getState();
      const person = getPublicPerson(state, decodeURIComponent(personMatch[1]), { visibleWorkIds: await visiblePersonWorkIds() });
      if (!person) {
        sendJson(response, 404, { error: "Person was not found." });
        return;
      }
      sendJson(response, 200, person);
      return;
    }

    if (request.method === "GET" && pathname === "/api/browse-assets") {
      await handleBrowseAssets(url, response, context);
      return;
    }

    if (request.method === "GET" && pathname === "/api/site-statistics") {
      await handleSiteStatistics(response, context);
      return;
    }

    if (request.method === "GET" && pathname === "/api/now-playing") {
      const forceRefresh = url.searchParams.get("refresh") === "true";
      const payload = await getNowPlaying({ forceRefresh });
      logInfo("api.now_playing", {
        requestId,
        forceRefresh,
        cacheStatus: payload.cache.status,
        movieCount: payload.movies.length,
        degraded: payload.degraded
      });
      sendJson(response, 200, payload);
      return;
    }

    if (request.method === "GET" && pathname === "/api/cached-assets") {
      await handleListCachedAssets(url, response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/movie-summary") {
      await handleMovieSummary(request, response, context, identity!);
      return;
    }

    if (request.method === "GET" && pathname === "/api/credit-policy") {
      sendJson(response, 200, creditPolicyPayload());
      return;
    }

    if (request.method === "POST" && pathname === "/api/credit-preview") {
      await handleCreditPreview(request, response, context, identity!);
      return;
    }

    if (request.method === "POST" && pathname === "/api/playback-diagnostic") {
      await handlePlaybackDiagnostic(request, response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/cache") {
      await handleEnsureCache(request, response, context, identity!);
      return;
    }

    if (request.method === "POST" && pathname === "/api/direct-download") {
      await handleDirectDownload(request, response, context, identity!);
      return;
    }

    const statusMatch = pathname.match(/^\/api\/cache\/([^/]+)$/);
    if (request.method === "GET" && statusMatch) {
      await handleStatus(decodeURIComponent(statusMatch[1]), response, context);
      return;
    }

    const playbackAdmissionMatch = pathname.match(/^\/api\/playback-admission\/([^/]+)$/);
    if (request.method === "GET" && playbackAdmissionMatch) {
      await handlePlaybackAdmission(
        decodeURIComponent(playbackAdmissionMatch[1]),
        url.searchParams.get("ticket"),
        requestPlaybackLine(url.searchParams.get("line")),
        response,
        context
      );
      return;
    }

    const playbackAdmissionReleaseMatch = pathname.match(/^\/api\/playback-admission-ticket\/([^/]+)$/);
    if (request.method === "DELETE" && playbackAdmissionReleaseMatch) {
      const released = playbackAdmissionQueue.release(
        decodeURIComponent(playbackAdmissionReleaseMatch[1]),
        context.session!.id
      );
      sendJson(response, released ? 200 : 404, released ? { ok: true } : { error: "Playback queue ticket was not found." });
      return;
    }

    const playbackMatch = pathname.match(/^\/api\/playback\/([^/]+)$/);
    if (request.method === "GET" && playbackMatch) {
      await handlePlayback(
        decodeURIComponent(playbackMatch[1]),
        url.searchParams.get("admission"),
        requestPlaybackLine(url.searchParams.get("line")),
        response,
        context,
        identity!
      );
      return;
    }

    const mediaMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
    if ((request.method === "GET" || request.method === "HEAD") && mediaMatch) {
      const encodedAssetKey = mediaMatch[1].endsWith(".mp4")
        ? mediaMatch[1].slice(0, -4)
        : mediaMatch[1];
      await handleLocalMedia(
        decodeURIComponent(encodedAssetKey),
        url.searchParams.get("grant"),
        url.searchParams.get("admission"),
        request,
        response,
        context
      );
      return;
    }

    const hlsMatch = pathname.match(/^\/api\/hls\/([^/]+)\/([^/]+)$/);
    if ((request.method === "GET" || request.method === "HEAD") && hlsMatch) {
      await handleLocalHls(
        decodeURIComponent(hlsMatch[1]),
        decodeURIComponent(hlsMatch[2]),
        url.searchParams.get("grant"),
        url.searchParams.get("admission"),
        request,
        response,
        context
      );
      return;
    }

    const posterMatch = pathname.match(/^\/api\/posters\/([^/]+)$/);
    if ((request.method === "GET" || request.method === "HEAD") && posterMatch) {
      await handleLocalPoster(decodeURIComponent(posterMatch[1]), request, response);
      return;
    }

    const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
    if (request.method === "GET" && assetMatch) {
      await handleAssetLookup(
        decodeURIComponent(assetMatch[1]),
        optionalPlaybackLine(url.searchParams.get("line")),
        response,
        context
      );
      return;
    }

    if (await serveStaticWeb(request, response, pathname)) {
      return;
    }

    sendJson(response, 404, { error: "Route was not found." });
  } catch (error) {
    logError("api.request.error", {
      requestId,
      method: context.method,
      path: context.path,
      ...errorLogFields(error)
    });
    sendJson(response, 500, internalServerErrorPayload(requestId));
  } finally {
    logInfo("api.request", {
      requestId,
      method: context.method,
      path: context.path,
      statusCode: response.statusCode,
      durationMs: durationMs(context.startedAt)
    });
  }
}

http.createServer(handleRequest).listen(port, () => {
  logInfo("api.start", {
    port,
    store: store.description,
    accessStore: accessStore.description,
    search: searchSource.description,
    searchIndex: searchIndex.description,
    searchIndexEnabled,
    accessConfigured: Boolean(adminKey)
  });
});
