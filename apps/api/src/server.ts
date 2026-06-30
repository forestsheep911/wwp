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
  type CreateMemberCodeRequest,
  type CreateMovieRequestRequest,
  type ChangeMemberPasscodeRequest,
  type AdminSetMemberPasscodeRequest,
  type DeleteCacheEntryResponse,
  type EnsureCacheRequest,
  type MemberAccessCode,
  type MemberCreditUsageResponse,
  type MediaVariant,
  type MovieRequestsResponse,
  type MovieRequestStatus,
  type RegisterMemberRequest,
  type SearchResult,
  type SetMemberCreditsRequest,
  type UpdateMovieRequestStatusRequest,
  validateMemberPasscode
} from "@wwpdw/shared";
import { createCacheStore, isFreshReady } from "@wwpdw/cache-store";
import { createAccessStore, type AccessIdentity, type MemberCreditUsageList } from "./access-store.js";
import { CacheWorkerTrigger } from "./job-trigger.js";
import { createSearchSource } from "./search-source.js";

const port = Number(process.env.API_PORT ?? 8787);
const store = createCacheStore();
const accessStore = createAccessStore();
const workerTrigger = new CacheWorkerTrigger();
const searchSource = createSearchSource();
const recentResults = new Map<string, SearchResult>();
const recentResultLimit = 200;
const searchResultCacheTtlMs = Math.max(0, Number(process.env.SEARCH_RESULT_CACHE_TTL_SECONDS ?? 600)) * 1000;
const searchResultCacheLimit = Math.max(1, Number(process.env.SEARCH_RESULT_CACHE_LIMIT ?? 100));
const searchResultCache = new Map<string, {
  expiresAt: number;
  lastUsedAt: number;
  results: SearchResult[];
}>();
const pendingSearches = new Map<string, Promise<SearchResult[]>>();
const accessHeaderName = "x-wwpdw-access-key";
const requestIdHeaderName = "x-request-id";
const terminalJobStatuses: CacheStatus[] = ["ready", "failed"];
const cacheCreditCost = Math.max(1, Math.floor(Number(process.env.MEMBER_CACHE_CREDIT_COST ?? 1)));
const playbackReplayFreeHours = Math.max(1, Math.floor(Number(process.env.MEMBER_PLAYBACK_REPLAY_FREE_HOURS ?? 24)));
const playbackCreditBytes = Math.max(1, Math.floor(Number(process.env.MEMBER_PLAYBACK_CREDIT_BYTES ?? 1000 * 1000 * 1000)));
const movieRequestStatuses: MovieRequestStatus[] = ["new", "planned", "fulfilled", "dismissed"];
const adminMovieRequestMemberId = "admin";
const adminMovieRequestMemberName = "Admin";
const adminKey =
  process.env.WWPDW_ADMIN_KEY ??
  process.env.WWPDW_ACCESS_KEY ??
  process.env.ACCESS_KEY ??
  process.env.VITE_ACCESS_CODE;

interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  startedAt: number;
}

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": `content-type,${accessHeaderName},${requestIdHeaderName}`,
    "Access-Control-Expose-Headers": requestIdHeaderName,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
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
  const suppliedKey = headerValue(request.headers[accessHeaderName]);
  if (!suppliedKey) {
    return undefined;
  }

  if (isAdminKey(suppliedKey)) {
    return { role: "admin" };
  }

  return accessStore.findMemberByCode(suppliedKey);
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

  const identity = await resolveAccess(request);
  if (!identity) {
    logWarn("api.auth.denied", {
      requestId: context.requestId,
      path: context.path
    });
    sendJson(response, 401, { error: "Access key did not match." });
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

function memberIdentityFromCode(code: Pick<MemberAccessCode, "id" | "name" | "credits">): AccessIdentity {
  return {
    role: "member",
    memberId: code.id,
    memberName: code.name,
    credits: code.credits
  };
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
  cacheStatus: "disabled" | "hit" | "miss" | "deduped";
}> {
  if (searchResultCacheTtlMs <= 0) {
    return {
      results: await searchSource.search(query),
      cacheStatus: "disabled"
    };
  }

  const key = searchCacheKey(query);
  const now = Date.now();
  const cached = searchResultCache.get(key);
  if (cached && cached.expiresAt > now) {
    cached.lastUsedAt = now;
    return {
      results: cloneSearchResults(cached.results),
      cacheStatus: "hit"
    };
  }

  const pending = pendingSearches.get(key);
  if (pending) {
    return {
      results: cloneSearchResults(await pending),
      cacheStatus: "deduped"
    };
  }

  const nextSearch = searchSource.search(query)
    .then((results) => {
      searchResultCache.set(key, {
        expiresAt: Date.now() + searchResultCacheTtlMs,
        lastUsedAt: Date.now(),
        results: cloneSearchResults(results)
      });
      pruneSearchResultCache();
      return results;
    })
    .finally(() => {
      pendingSearches.delete(key);
    });

  pendingSearches.set(key, nextSearch);
  return {
    results: cloneSearchResults(await nextSearch),
    cacheStatus: "miss"
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

  logInfo("api.admin.cache_jobs.retry_source_refresh_start", {
    requestId: context.requestId,
    jobId: job.id,
    assetKey: job.assetKey,
    sourcePageId: job.sourcePageId,
    breadcrumbDepth: job.sourceBreadcrumb?.length,
    method
  });

  try {
    let refreshed = searchSource.refreshAsset
      ? await searchSource.refreshAsset({
        assetKey: job.assetKey,
        sourcePageId: job.sourcePageId,
        title: job.title,
        sourceBreadcrumb: job.sourceBreadcrumb
      })
      : undefined;

    if (!refreshed) {
      fallbackQuery = retrySearchQuery(job);
      method = searchSource.refreshAsset ? "source_page_then_title_search" : "title_search";
      const results = await searchSource.search(fallbackQuery);
      fallbackResultCount = results.length;
      rememberResults(results);
      refreshed = findSearchResultByAssetKey(results, job.assetKey);
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
  const assetKeys = searchResults.flatMap((item) => [
    item.assetKey,
    ...(item.variants?.map((variant) => variant.assetKey) ?? [])
  ]);
  const assets = await store.listAssets(assetKeys);
  const results = searchResults.map((item) => ({
    ...item,
    cache: visibleCacheAsset(assets[item.assetKey]),
    variants: item.variants?.map((variant) => ({
      ...variant,
      cache: visibleCacheAsset(assets[variant.assetKey])
    }))
  }));

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

function creditLimitErrorMessage() {
  return "This Cinema Pass does not have enough 🍀 left.";
}

function playbackCreditCost(contentLength: number | undefined) {
  if (!contentLength || !Number.isFinite(contentLength) || contentLength <= 0) {
    return 1;
  }

  return Math.max(1, Math.ceil(contentLength / playbackCreditBytes));
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
  const result = body.result?.assetKey === body.assetKey
    ? body.result
    : recentResults.get(body.assetKey);

  if (!result) {
    logWarn("api.cache.asset_not_found", {
      requestId: context.requestId,
      assetKey: body.assetKey,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 404, { error: "Asset was not found." });
    return;
  }

  const existingAsset = await store.getAsset(result.assetKey);
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
    sendJson(response, 403, { error: "This Cinema Pass is no longer available." });
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

function requestLimit(url: URL, fallback: number, maximum: number) {
  const raw = Number(url.searchParams.get("limit") ?? fallback);
  if (!Number.isFinite(raw)) {
    return fallback;
  }

  return Math.min(Math.max(Math.floor(raw), 1), maximum);
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

  sendJson(response, 200, {
    job,
    asset: await store.getAsset(job.assetKey)
  });
}

async function handlePlayback(
  assetKey: string,
  response: http.ServerResponse,
  context: RequestContext,
  identity: AccessIdentity
) {
  const startedAt = Date.now();
  const asset = await store.getAsset(assetKey);
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
  const playbackCredits = playbackCreditCost(asset?.media?.contentLength);
  const chargeResult = shouldChargeMember
    ? await accessStore.chargeMemberPlayback(identity.memberId!, {
      credits: playbackCredits,
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
    sendJson(response, 403, { error: "This Cinema Pass is no longer available." });
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
  const asset = await store.getAsset(assetKey);
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

async function handleRegisterMember(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<RegisterMemberRequest>(request);
  const name = body.name?.trim() ?? "";
  const passcode = body.passcode ?? "";
  const passcodeError = passcodeValidationError(passcode);

  if (!name) {
    sendJson(response, 400, { error: "请输入成员名称。" });
    return;
  }

  if (passcodeError) {
    sendJson(response, 400, { error: passcodeError });
    return;
  }

  const result = await accessStore.registerMember({
    name,
    passcode
  });
  if (!result.ok) {
    logWarn("api.auth.register.duplicate", {
      requestId: context.requestId,
      name,
      durationMs: durationMs(startedAt)
    });
    sendJson(response, 409, { error: "这个通行码已经被使用，请换一个。" });
    return;
  }

  const identity = memberIdentityFromCode(result.code);
  await recordLoginAudit(request, identity, context);
  logInfo("api.auth.register", {
    requestId: context.requestId,
    memberId: result.code.id,
    name: result.code.name,
    remainingCredits: result.code.credits.remaining,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 201, {
    auth: authPayload(identity),
    code: result.code
  });
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
  sendJson(response, 200, { code: result.code });
}

async function handleSetMemberPasscode(
  codeId: string,
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<AdminSetMemberPasscodeRequest>(request);
  const passcode = body.passcode ?? "";
  const passcodeError = passcodeValidationError(passcode);
  if (passcodeError) {
    sendJson(response, 400, { error: passcodeError });
    return;
  }

  const result = await accessStore.setMemberPasscode(codeId, passcode);
  if (!result.ok) {
    logWarn("api.admin.member_codes.passcode_set_failed", {
      requestId: context.requestId,
      memberCodeId: codeId,
      reason: result.reason,
      durationMs: durationMs(startedAt)
    });
    sendPasscodeUpdateError(result, response);
    return;
  }

  logInfo("api.admin.member_codes.passcode_set", {
    requestId: context.requestId,
    memberCodeId: result.code.id,
    name: result.code.name,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 200, { code: result.code });
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

async function handleCreateMemberCode(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<CreateMemberCodeRequest>(request);
  const code = await accessStore.createMemberCode({
    name: body.name,
    credits: body.credits
  });
  logInfo("api.admin.member_codes.create", {
    requestId: context.requestId,
    memberCodeId: code.id,
    name: code.name,
    expiresAt: code.expiresAt,
    remainingCredits: code.credits.remaining,
    durationMs: durationMs(startedAt)
  });
  sendJson(response, 201, { code });
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

  try {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, {
        ok: true,
        access: Boolean(adminKey),
        store: await store.getHealth(),
        accessStore: await accessStore.getHealth(),
        search: searchSource.description
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/register") {
      await handleRegisterMember(request, response, context);
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
      await recordLoginAudit(request, identity!, context);
      logInfo("api.auth.check", {
        requestId,
        role: identity?.role,
        memberId: identity?.memberId
      });
      sendJson(response, 200, authPayload(identity!));
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/passcode") {
      await handleChangeMemberPasscode(request, response, context, identity!);
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

    if (pathname === "/api/admin/member-codes" && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "GET" && pathname === "/api/admin/member-codes") {
      await handleListMemberCodes(response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/admin/member-codes") {
      await handleCreateMemberCode(request, response, context);
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

    const setMemberPasscodeMatch = pathname.match(/^\/api\/admin\/member-codes\/([^/]+)\/passcode$/);
    if (setMemberPasscodeMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && setMemberPasscodeMatch) {
      await handleSetMemberPasscode(decodeURIComponent(setMemberPasscodeMatch[1]), request, response, context);
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

    if (request.method === "GET" && pathname === "/api/cached-assets") {
      await handleListCachedAssets(url, response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/cache") {
      await handleEnsureCache(request, response, context, identity!);
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
    accessConfigured: Boolean(adminKey)
  });
});
