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
  type AdminCacheJobsResponse,
  type AccessRole,
  type AuthCheckResponse,
  type CacheJob,
  type CacheStatus,
  type CacheAssetLookupResponse,
  type CachedAssetsResponse,
  type CreateMemberCodeRequest,
  type DeleteCacheEntryResponse,
  type EnsureCacheRequest,
  type MediaVariant,
  type SearchResult,
  type SetMemberCreditsRequest
} from "@wwpdw/shared";
import { createCacheStore, isFreshReady } from "@wwpdw/cache-store";
import { createAccessStore, type AccessIdentity } from "./access-store.js";
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
  context: RequestContext
) {
  const startedAt = Date.now();
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
    durationMs: durationMs(startedAt)
  });

  sendJson(response, 200, playback);
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
      sendJson(response, 200, authPayload(identity!));
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
      await handlePlayback(decodeURIComponent(playbackMatch[1]), response, context);
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
