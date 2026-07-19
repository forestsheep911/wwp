import "./env.js";
import { randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
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
  type MovieRequestStatus,
  type RatingValue,
  type RegisterMemberRequest,
  type ResetMemberPasscodeRequest,
  type SearchResult,
  type SetMemberCreditsRequest,
  type UpdateMovieRequestStatusRequest,
  type UpdateMemberProfileRequest,
  defaultCreditPolicy,
  playbackCreditCost,
  validateMemberPasscode
} from "@wwpdw/shared";
import { createCacheStore, createSearchIndexStore, createTspdtBrowseStore, isFreshReady } from "@wwpdw/cache-store";
import { createAccessStore, type AccessIdentity, type MemberCreditUsageList } from "./access-store.js";
import { AiSummaryConfigError, AiSummaryTimeoutError, summarizeMovie } from "./ai-summary.js";
import { stableBrowseTie } from "./browse-order.js";
import { BrowseSnapshotCache, defaultBrowseSnapshotTtlMs } from "./browse-snapshot.js";
import { CacheWorkerTrigger } from "./job-trigger.js";
import { getNowPlaying } from "./now-playing-source.js";
import { createSearchSource } from "./search-source.js";
import { refreshAssetInputFromJob, refreshAssetInputFromResult } from "./cache-source-refresh.js";
import { applyCors, clearSessionCookie, csrfValid, readCookie, requestOrigin, sessionCookie } from "./auth-http.js";
import { createSessionStore, type AuthenticatedSession, type SessionSubject } from "./session-store.js";
import { notionPublicPageUrl } from "./direct-download.js";

const port = Number(process.env.API_PORT ?? 8787);
const store = createCacheStore();
const searchIndex = createSearchIndexStore();
const tspdtBrowseStore = createTspdtBrowseStore();
const accessStore = createAccessStore();
const sessionStore = createSessionStore();
const workerTrigger = new CacheWorkerTrigger();
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
  results: SearchResult[];
}>();
const browseSnapshotCache = new BrowseSnapshotCache<SearchResult>(defaultBrowseSnapshotTtlMs);
const browseSourceCache = new BrowseSnapshotCache<SearchResult>(defaultBrowseSnapshotTtlMs);
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
const requestIdHeaderName = "x-request-id";
const terminalJobStatuses: CacheStatus[] = ["ready", "failed"];
const cacheCreditCost = Math.max(1, Math.floor(Number(process.env.MEMBER_CACHE_CREDIT_COST ?? defaultCreditPolicy.cacheCredits)));
const playbackReplayFreeHours = Math.max(1, Math.floor(Number(process.env.MEMBER_PLAYBACK_REPLAY_FREE_HOURS ?? defaultCreditPolicy.playbackReplayFreeHours)));
const playbackCreditBytes = Math.max(1, Math.floor(Number(process.env.MEMBER_PLAYBACK_CREDIT_BYTES ?? defaultCreditPolicy.playbackCreditBytes)));
const movieRequestStatuses: MovieRequestStatus[] = ["new", "planned", "fulfilled", "dismissed"];
const adminMovieRequestMemberId = "admin";
const adminMovieRequestMemberName = "Admin";
const forumAdminMemberId = "admin";
const forumAdminMemberName = "Admin";
const adminKey = process.env.WWPDW_ADMIN_KEY;

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
    : { role: "member", memberId: subject.memberId, memberName: subject.memberName };
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
      ? { role: "member" as const, memberId: session.subject.memberId, memberName: session.subject.memberName }
      : undefined;
  if (!identity) {
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
    metadata: result.metadata
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
    cached.lastUsedAt = now;
    const cachedResults = await refreshIndexedMediaAssetResults(query, cached.results);
    cached.results = cloneSearchResults(cachedResults);
    return {
      results: cloneSearchResults(cachedResults),
      cacheStatus: "hit"
    };
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
    .then((searchLoad) => {
      searchResultCache.set(key, {
        expiresAt: Date.now() + searchResultCacheTtlMs,
        lastUsedAt: Date.now(),
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
  const cachedPosters = existingPosters.filter(isCachedBlobPoster);
  if (cachedPosters.length === 0) {
    return refreshed;
  }

  const seen = new Set<string>();
  const posters: MoviePoster[] = [];
  for (const poster of [...cachedPosters, ...(refreshed.metadata?.posters ?? [])]) {
    const key = posterStableKey(poster);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    posters.push(poster);
  }

  return {
    ...refreshed,
    metadata: {
      ...refreshed.metadata,
      posterUrl: existing.metadata?.posterUrl?.includes(".blob.core.windows.net")
        ? existing.metadata.posterUrl
        : refreshed.metadata?.posterUrl,
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

async function handleSearch(url: URL, response: http.ServerResponse, context: RequestContext) {
  const startedAt = Date.now();
  const query = url.searchParams.get("q")?.trim() ?? "";
  const searchLoad = await loadSearchResults(query);
  const searchResults = searchLoad.results;
  rememberResults(searchResults);
  const results = await enrichResultsWithCache(searchResults);

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

async function enrichResultsWithCache(searchResults: SearchResult[]) {
  const hydratedResults = await Promise.all(
    searchResults.map(async (item) => store.hydrateMoviePosterUrls(await enrichResultRatings(item)))
  );
  const assetKeys = hydratedResults.flatMap((item) => [
    item.assetKey,
    ...(item.variants?.map((variant) => variant.assetKey) ?? [])
  ]);
  const assets = await store.listAssets(assetKeys);
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
  const pagedLimitMaximum = channel === "movie" && view === "tspdtRank"
    ? 2000
    : view === "popular" || view === "mostWatched"
      ? 300
      : 100;
  const limit = requestLimit(url, 50, mode === "random" ? 200 : pagedLimitMaximum);

  if (channel === "movie" && view === "tspdtRank" && mode === "paged") {
    const served = await serveStaticTspdtBrowse(response, context, {
      startedAt,
      offset,
      limit,
      channel,
      view,
      mode
    });
    if (served) {
      return;
    }
  }

  const fetchLimit = channel === "recommended" && view === "lucky" ? offset + limit + 1 : 1_000_000;
  let searchResults: SearchResult[] = [];
  let browseSource = "live";
  const snapshotKey = `${channel}:${view}`;
  let sortedResults = mode === "paged" ? browseSnapshotCache.get(snapshotKey) : undefined;

  if (sortedResults) {
    browseSource = "snapshot";
  }

  if (!sortedResults && searchIndexEnabled) {
    try {
      searchResults = mode === "random"
        ? channel === "recommended"
          ? await searchIndex.sample(limit)
          : sampleSearchResults(filterBrowseResults(await searchIndex.search("", fetchLimit), channel), limit)
        : (await browseSourceCache.getOrLoad("index", () => searchIndex.search("", 1_000_000))).slice(0, fetchLimit);
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
    if (mode === "paged") {
      browseSnapshotCache.set(snapshotKey, sortedResults);
    }
  }
  const pageResults = mode === "random" ? sortedResults.slice(0, limit) : sortedResults.slice(offset, offset + limit);
  const hasMore = mode === "random" ? false : sortedResults.length > offset + limit;
  rememberResults(pageResults);
  const results = await enrichResultsWithCache(pageResults);

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
    const results = await enrichResultsWithCache(pageResults);

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
    unitSymbol: defaultCreditPolicy.unitSymbol,
    cacheCredits: cacheCreditCost,
    playbackCreditBytes,
    playbackReplayFreeHours
  };
}

function previewPayload(input: {
  action: CreditPreviewResponse["action"];
  assetKey: string;
  title: string;
  credits: number;
  identity: AccessIdentity;
  freeReason?: CreditPreviewFreeReason;
  windowExpiresAt?: string;
}): CreditPreviewResponse {
  const remaining = input.identity.credits?.remaining;
  const chargeable = input.identity.role === "member" && !input.freeReason && input.credits > 0;
  const remainingAfter = chargeable && remaining !== undefined
    ? Math.max(0, remaining - input.credits)
    : remaining;

  return {
    action: input.action,
    assetKey: input.assetKey,
    title: input.title,
    credits: chargeable ? input.credits : 0,
    unitSymbol: input.identity.credits?.unitSymbol ?? "🍀",
    chargeable,
    canAfford: !chargeable || remaining === undefined || remaining >= input.credits,
    remaining,
    remainingAfter,
    freeReason: input.identity.role === "admin" ? "admin" : input.freeReason,
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

    const existingAsset = await store.getAsset(assetKey, { fresh: true });
    const existingJob = existingAsset?.jobId ? await store.getJob(existingAsset.jobId) : undefined;
    const readyHit = isFreshReady(existingAsset);
    const activeAssetJobHit = Boolean(existingAsset && existingJob && !terminalJobStatuses.includes(existingJob.status));
    const usage = await memberCreditUsage(identity, 1);
    const preview = previewPayload({
      action: "cache",
      assetKey,
      title: candidate.title,
      credits: cacheCreditCost,
      identity: usage?.code
        ? { ...identity, credits: usage.code.credits }
        : identity,
      freeReason: readyHit ? "cache_ready" : activeAssetJobHit ? "cache_active" : undefined
    });

    logInfo("api.credit.preview", {
      requestId: context.requestId,
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

  const asset = await store.getAsset(assetKey, { fresh: true });
  if (!asset || !isFreshReady(asset)) {
    sendJson(response, 409, { error: "Asset is not ready for playback." });
    return;
  }

  const playbackCredits = playbackCreditCost(asset.media?.contentLength, creditPolicyPayload());
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
    if (entry.reason !== "playback_stream" || entry.assetKey !== assetKey) {
      return false;
    }

    const chargedAt = new Date(entry.chargedAt).getTime();
    return Number.isFinite(chargedAt) && now - chargedAt <= playbackReplayFreeHours * 60 * 60 * 1000;
  });
  const preview = previewPayload({
    action: "playback",
    assetKey,
    title: asset.title,
    credits: playbackCredits ?? 0,
    identity: usage?.code
      ? { ...identity, credits: usage.code.credits }
      : identity,
    freeReason: recentPlayback ? "playback_replay" : undefined,
    windowExpiresAt: recentPlayback?.windowExpiresAt
  });

  logInfo("api.credit.preview", {
    requestId: context.requestId,
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

  const existingAsset = await store.getAsset(result.assetKey, { fresh: true });
  const existingJob = existingAsset?.jobId ? await store.getJob(existingAsset.jobId) : undefined;
  const readyHit = isFreshReady(existingAsset);
  const activeAssetJobHit = Boolean(existingAsset && existingJob && !terminalJobStatuses.includes(existingJob.status));
  const shouldChargeMember = identity.role === "member" && Boolean(identity.memberId) && !readyHit && !activeAssetJobHit;
  const charge = shouldChargeMember
    ? await accessStore.chargeMemberCredits(identity.memberId!, {
      credits: cacheCreditCost,
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
    const explicitExpiry =
      unixOrIsoDate(url.searchParams.get("expiryTime")) ??
      unixOrIsoDate(url.searchParams.get("expiration")) ??
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
  if (!/^https?:\/\//i.test(result.sourceUrl)) {
    logWarn("api.direct_download.invalid_url", {
      requestId: context.requestId,
      assetKey: result.assetKey,
      sourceUrl: result.sourceUrl,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 409, { error: "This asset does not have a direct download URL." });
    return;
  }

  const payload: DirectDownloadResponse = {
    assetKey: result.assetKey,
    title: result.title,
    downloadUrl: result.sourceUrl,
    notionPageUrl: notionPublicPageUrl(result.sourcePageId),
    expiresAt: downloadUrlExpiresAt(result.sourceUrl),
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
    job,
    asset
  });
}

async function handlePlayback(
  assetKey: string,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
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

  const shouldChargeMember = identity.role === "member" && Boolean(identity.memberId);
  const playbackCredits = playbackCreditCost(asset?.media?.contentLength, creditPolicyPayload());
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

  logInfo("api.playback.ready", {
    requestId: context.requestId,
    assetKey,
    contentType: playback.media?.contentType,
    contentLength: playback.media?.contentLength,
    rangeSupported: playback.media?.rangeSupported,
    mp4Status: playback.media?.mp4?.status,
    moovOffset: playback.media?.mp4?.moovOffset,
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

async function handleAssetLookup(
  assetKey: string,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const asset = await store.getAsset(assetKey, { fresh: true });
  const payload: CacheAssetLookupResponse = {
    asset,
    playable: isFreshReady(asset)
  };

  logInfo("api.asset.lookup", {
    requestId: context.requestId,
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
  const assets = await store.listCachedAssets(limit);
  const payload: CachedAssetsResponse = {
    items: assets.map((asset) => ({ asset }))
  };

  logInfo("api.cached_assets.list", {
    requestId: context.requestId,
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
  const inviteCode = body.inviteCode?.trim() ?? "";
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
  const inviteCode = body.inviteCode?.trim() ?? "";
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

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        access: Boolean(adminKey),
        store: await store.getHealth(),
        accessStore: await accessStore.getHealth(),
        search: searchSource.description,
        searchIndex: {
          enabled: searchIndexEnabled,
          ...(await searchIndex.getHealth())
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

    if (request.method === "GET" && pathname === "/api/browse-assets") {
      await handleBrowseAssets(url, response, context);
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

    const playbackMatch = pathname.match(/^\/api\/playback\/([^/]+)$/);
    if (request.method === "GET" && playbackMatch) {
      await handlePlayback(decodeURIComponent(playbackMatch[1]), response, context, identity!);
      return;
    }

    const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
    if (request.method === "GET" && assetMatch) {
      await handleAssetLookup(decodeURIComponent(assetMatch[1]), response, context);
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
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error."
    });
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
