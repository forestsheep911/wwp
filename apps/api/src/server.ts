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
  type AccessRole,
  type AuthCheckResponse,
  type CreateMemberCodeRequest,
  type EnsureCacheRequest,
  type MediaVariant,
  type SearchResult
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
const accessHeaderName = "x-wwpdw-access-key";
const requestIdHeaderName = "x-request-id";
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
        name: identity.memberName
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
    durationLabel: result.durationLabel,
    updatedAt: result.updatedAt,
    summary: variant.summary,
    metadata: result.metadata
  };
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
  const searchResults = await searchSource.search(query);
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
    durationMs: durationMs(startedAt)
  });

  sendJson(response, 200, { results });
}

async function handleEnsureCache(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
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
  const output = await store.ensureCache(result);
  const trigger = await workerTrigger.start(output.job);

  logInfo("api.cache.ensure", {
    requestId: context.requestId,
    assetKey: result.assetKey,
    jobId: output.job.id,
    assetStatus: output.asset.status,
    jobStatus: output.job.status,
    readyHit: isFreshReady(existingAsset),
    triggerStatus: trigger.status,
    durationMs: durationMs(startedAt)
  });

  sendJson(response, 200, {
    ...output,
    trigger
  });
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

async function handleCreateMemberCode(
  request: http.IncomingMessage,
  response: http.ServerResponse,
  context: RequestContext
) {
  const startedAt = Date.now();
  const body = await readBody<CreateMemberCodeRequest>(request);
  const code = await accessStore.createMemberCode({
    name: body.name,
    days: body.days
  });
  logInfo("api.admin.member_codes.create", {
    requestId: context.requestId,
    memberCodeId: code.id,
    name: code.name,
    expiresAt: code.expiresAt,
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

    const revokeMemberCodeMatch = pathname.match(/^\/api\/admin\/member-codes\/([^/]+)\/revoke$/);
    if (revokeMemberCodeMatch && !requireAdmin(identity, response, context)) {
      return;
    }

    if (request.method === "POST" && revokeMemberCodeMatch) {
      await handleRevokeMemberCode(decodeURIComponent(revokeMemberCodeMatch[1]), response, context);
      return;
    }

    if (request.method === "GET" && pathname === "/api/search") {
      await handleSearch(url, response, context);
      return;
    }

    if (request.method === "POST" && pathname === "/api/cache") {
      await handleEnsureCache(request, response, context);
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
