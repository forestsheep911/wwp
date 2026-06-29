import http from "node:http";
import { URL } from "node:url";
import {
  type CacheAsset,
  type EnsureCacheRequest,
  mockSearchResults
} from "@wwpdw/shared";
import { createJob, getStatePath, readState, updateState } from "./state.js";

const port = Number(process.env.API_PORT ?? 8787);

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
  });
  response.end(JSON.stringify(payload));
}

async function readBody<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

function isFreshReady(asset?: CacheAsset) {
  if (!asset || asset.status !== "ready" || !asset.expiresAt) {
    return false;
  }

  return new Date(asset.expiresAt).getTime() > Date.now();
}

async function handleSearch(url: URL, response: http.ServerResponse) {
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const state = await readState();
  const results = mockSearchResults
    .filter((item) => {
      if (!query) {
        return true;
      }
      return [item.title, item.source, item.summary, item.assetKey]
        .join(" ")
        .toLowerCase()
        .includes(query);
    })
    .map((item) => ({
      ...item,
      cache: state.assets[item.assetKey]
    }));

  sendJson(response, 200, { results });
}

async function handleEnsureCache(request: http.IncomingMessage, response: http.ServerResponse) {
  const body = await readBody<EnsureCacheRequest>(request);
  const result = mockSearchResults.find((item) => item.assetKey === body.assetKey);

  if (!result) {
    sendJson(response, 404, { error: "Asset was not found." });
    return;
  }

  const output = await updateState((state) => {
    const existingAsset = state.assets[result.assetKey];
    const existingJob = existingAsset?.jobId ? state.jobs[existingAsset.jobId] : undefined;

    if (isFreshReady(existingAsset) && existingJob) {
      existingAsset.lastRequestedAt = new Date().toISOString();
      return { asset: existingAsset, job: existingJob };
    }

    if (existingAsset && existingJob && existingJob.status !== "failed") {
      existingAsset.lastRequestedAt = new Date().toISOString();
      return { asset: existingAsset, job: existingJob };
    }

    const job = createJob({
      assetKey: result.assetKey,
      title: result.title,
      source: result.source
    });

    state.jobs[job.id] = job;
    state.assets[result.assetKey] = {
      assetKey: result.assetKey,
      title: result.title,
      source: result.source,
      status: "queued",
      jobId: job.id,
      lastRequestedAt: job.createdAt
    };

    return {
      asset: state.assets[result.assetKey],
      job
    };
  });

  sendJson(response, 200, output);
}

async function handleStatus(jobId: string, response: http.ServerResponse) {
  const state = await readState();
  const job = state.jobs[jobId];

  if (!job) {
    sendJson(response, 404, { error: "Job was not found." });
    return;
  }

  sendJson(response, 200, {
    job,
    asset: state.assets[job.assetKey]
  });
}

async function handlePlayback(assetKey: string, response: http.ServerResponse) {
  const state = await readState();
  const asset = state.assets[assetKey];

  if (!isFreshReady(asset) || !asset?.playbackUrl || !asset.expiresAt) {
    sendJson(response, 409, { error: "Asset is not ready for playback." });
    return;
  }

  sendJson(response, 200, {
    assetKey: asset.assetKey,
    title: asset.title,
    playbackUrl: asset.playbackUrl,
    expiresAt: asset.expiresAt
  });
}

async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse) {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const pathname = url.pathname;

  try {
    if (request.method === "GET" && pathname === "/health") {
      sendJson(response, 200, { ok: true, statePath: getStatePath() });
      return;
    }

    if (request.method === "GET" && pathname === "/api/search") {
      await handleSearch(url, response);
      return;
    }

    if (request.method === "POST" && pathname === "/api/cache") {
      await handleEnsureCache(request, response);
      return;
    }

    const statusMatch = pathname.match(/^\/api\/cache\/([^/]+)$/);
    if (request.method === "GET" && statusMatch) {
      await handleStatus(decodeURIComponent(statusMatch[1]), response);
      return;
    }

    const playbackMatch = pathname.match(/^\/api\/playback\/([^/]+)$/);
    if (request.method === "GET" && playbackMatch) {
      await handlePlayback(decodeURIComponent(playbackMatch[1]), response);
      return;
    }

    sendJson(response, 404, { error: "Route was not found." });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unexpected server error."
    });
  }
}

http.createServer(handleRequest).listen(port, () => {
  console.log(`WWPDW API listening on http://localhost:${port}`);
  console.log(`Local cache state: ${getStatePath()}`);
});
