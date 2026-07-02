const { createHash, timingSafeEqual } = require("node:crypto");
const { BlobServiceClient } = require("@azure/storage-blob");
const { TableClient } = require("@azure/data-tables");

const accessHeaderName = "x-wwpdw-access-key";
const defaultOriginApiBaseUrl = "https://ca-ww-player-api.kindplant-e2681add.eastasia.azurecontainerapps.io";
const defaultCacheContainerName = "web-cache";
const defaultMemberTableName = "membercodes";

function intOption(name, fallback, min, max) {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function readConfig() {
  return {
    originApiBaseUrl: (
      process.env.WWPDW_ORIGIN_API_BASE_URL ??
      process.env.VITE_API_BASE_URL ??
      defaultOriginApiBaseUrl
    ).replace(/\/$/, ""),
    storageConnectionString: (
      process.env.WWPDW_HOME_CACHE_STORAGE_CONNECTION_STRING ??
      process.env.AzureWebJobsStorage ??
      process.env.AZURE_STORAGE_CONNECTION_STRING
    ),
    cacheContainerName: process.env.WWPDW_HOME_CACHE_CONTAINER ?? defaultCacheContainerName,
    memberTableName: process.env.AZURE_STORAGE_MEMBER_TABLE ?? defaultMemberTableName,
    adminKey: process.env.WWPDW_ADMIN_KEY,
    freshSeconds: intOption("WWPDW_HOME_BROWSE_FRESH_SECONDS", 600, 0, 86400),
    staleSeconds: intOption("WWPDW_HOME_BROWSE_STALE_SECONDS", 7 * 24 * 60 * 60, 60, 30 * 24 * 60 * 60),
    originTimeoutMs: intOption("WWPDW_HOME_BROWSE_ORIGIN_TIMEOUT_MS", 25000, 1000, 60000),
    staleRefreshTimeoutMs: intOption("WWPDW_HOME_BROWSE_STALE_REFRESH_TIMEOUT_MS", 1800, 250, 15000)
  };
}

function requestMode(req) {
  return req.query.mode === "random" ? "random" : "paged";
}

function requestLimit(req, mode) {
  const maximum = mode === "random" ? 200 : 100;
  const fallback = 50;
  const raw = Number(req.query.limit ?? fallback);
  return Math.min(maximum, Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : fallback));
}

function requestOffset(req) {
  const raw = Number(req.query.offset ?? 0);
  return Math.max(0, Number.isFinite(raw) ? Math.floor(raw) : 0);
}

function requestChannel(req) {
  const channel = req.query.channel;
  return channel === "movie" || channel === "tv" || channel === "animation" ? channel : "recommended";
}

function requestView(req) {
  const view = req.query.view;
  return view === "recent" ||
    view === "newGood" ||
    view === "popular" ||
    view === "topRated" ||
    view === "mostWatched" ||
    view === "doubanRank" ||
    view === "imdbRank" ||
    view === "rottenRank" ||
    view === "tspdtRank"
    ? view
    : "lucky";
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function hashCode(code) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function isActiveMember(stored) {
  if (!stored || stored.revokedAt) {
    return false;
  }
  if (!stored.expiresAt) {
    return true;
  }
  return new Date(stored.expiresAt).getTime() > Date.now();
}

async function validateAccess(accessKey, cfg) {
  if (!accessKey) {
    return false;
  }
  if (cfg.adminKey && safeEqual(accessKey, cfg.adminKey)) {
    return true;
  }
  if (!cfg.storageConnectionString) {
    return false;
  }

  const codeHash = hashCode(accessKey);
  const table = TableClient.fromConnectionString(cfg.storageConnectionString, cfg.memberTableName);
  const entities = table.listEntities({
    queryOptions: {
      filter: `PartitionKey eq 'member' and codeHash eq '${codeHash}'`
    }
  });

  for await (const entity of entities) {
    const stored = JSON.parse(entity.payload);
    return isActiveMember(stored);
  }

  return false;
}

function cacheBlobName(mode, limit, offset, channel, view) {
  return `home-browse/${channel}/${view}/${mode}/limit-${limit}/offset-${offset}.json`;
}

function getBlobClients(cfg, blobName) {
  if (!cfg.storageConnectionString) {
    return undefined;
  }
  const service = BlobServiceClient.fromConnectionString(cfg.storageConnectionString);
  const container = service.getContainerClient(cfg.cacheContainerName);
  return {
    container,
    blob: container.getBlockBlobClient(blobName)
  };
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function readCachedBrowse(cfg, blobName) {
  const clients = getBlobClients(cfg, blobName);
  if (!clients) {
    return undefined;
  }

  try {
    const download = await clients.blob.download();
    const buffer = await streamToBuffer(download.readableStreamBody);
    return JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    if (error.statusCode === 404 || error.code === "BlobNotFound" || error.code === "ContainerNotFound") {
      return undefined;
    }
    throw error;
  }
}

async function writeCachedBrowse(cfg, blobName, responsePayload, originUrl) {
  const clients = getBlobClients(cfg, blobName);
  if (!clients) {
    return;
  }

  await clients.container.createIfNotExists();
  const payload = {
    cachedAt: new Date().toISOString(),
    originUrl,
    response: responsePayload
  };
  await clients.blob.uploadData(Buffer.from(JSON.stringify(payload), "utf8"), {
    blobHTTPHeaders: {
      blobContentType: "application/json; charset=utf-8"
    }
  });
}

function cacheAgeMs(cached) {
  const cachedAt = new Date(cached?.cachedAt ?? "").getTime();
  return Number.isFinite(cachedAt) ? Date.now() - cachedAt : Number.POSITIVE_INFINITY;
}

async function fetchOriginBrowse(cfg, accessKey, mode, limit, offset, channel, view, timeoutMs) {
  const params = new URLSearchParams({
    mode,
    limit: String(limit),
    offset: String(offset)
  });
  if (channel !== "recommended") {
    params.set("channel", channel);
  }
  if (view !== "lucky") {
    params.set("view", view);
  }
  const url = `${cfg.originApiBaseUrl}/api/browse-assets?${params.toString()}`;
  const response = await fetch(url, {
    headers: {
      [accessHeaderName]: accessKey
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    throw new Error(`Origin browse failed with ${response.status}`);
  }
  return {
    url,
    payload: await response.json()
  };
}

function jsonResponse(status, payload, cacheStatus, cachedAt) {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-wwpdw-home-cache": cacheStatus,
      ...(cachedAt ? { "x-wwpdw-home-cache-at": cachedAt } : {})
    },
    body: {
      ...payload,
      homeCache: {
        status: cacheStatus,
        cachedAt,
        stale: cacheStatus === "stale"
      }
    }
  };
}

module.exports = async function (context, req) {
  const cfg = readConfig();
  const accessKey = req.headers[accessHeaderName];
    const mode = requestMode(req);
    const limit = requestLimit(req, mode);
    const offset = requestOffset(req);
    const channel = requestChannel(req);
    const view = requestView(req);
    const blobName = cacheBlobName(mode, limit, offset, channel, view);

  try {
    if (!await validateAccess(accessKey, cfg)) {
      context.res = {
        status: 401,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "private, no-store"
        },
        body: {
          error: "Access key did not match."
        }
      };
      return;
    }

    const cached = await readCachedBrowse(cfg, blobName);
    const ageMs = cacheAgeMs(cached);
    if (cached && ageMs <= cfg.freshSeconds * 1000) {
      context.res = jsonResponse(200, cached.response, "hit", cached.cachedAt);
      return;
    }

    try {
      const timeoutMs = cached ? cfg.staleRefreshTimeoutMs : cfg.originTimeoutMs;
      const origin = await fetchOriginBrowse(cfg, accessKey, mode, limit, offset, channel, view, timeoutMs);
      await writeCachedBrowse(cfg, blobName, origin.payload, origin.url);
      context.res = jsonResponse(200, origin.payload, cached ? "refresh" : "miss", new Date().toISOString());
      return;
    } catch (originError) {
      if (cached && ageMs <= cfg.staleSeconds * 1000) {
        context.log.warn(`home-browse origin refresh failed; serving stale cache: ${originError.message}`);
        context.res = jsonResponse(200, cached.response, "stale", cached.cachedAt);
        return;
      }
      throw originError;
    }
  } catch (error) {
    context.log.error(`home-browse failed: ${error.message}`);
    context.res = {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "private, no-store"
      },
      body: {
        error: error instanceof Error ? error.message : "Home browse cache failed."
      }
    };
  }
};
