import "./env.js";
import http from "node:http";
import { URL } from "node:url";
import { type EnsureCacheRequest, type SearchResult } from "@wwpdw/shared";
import { createCacheStore } from "@wwpdw/cache-store";
import { CacheWorkerTrigger } from "./job-trigger.js";
import { createSearchSource } from "./search-source.js";

const port = Number(process.env.API_PORT ?? 8787);
const store = createCacheStore();
const workerTrigger = new CacheWorkerTrigger();
const searchSource = createSearchSource();
const recentResults = new Map<string, SearchResult>();
const recentResultLimit = 200;

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

function rememberResults(results: SearchResult[]) {
  results.forEach((item) => recentResults.set(item.assetKey, item));

  while (recentResults.size > recentResultLimit) {
    const firstKey = recentResults.keys().next().value;
    if (!firstKey) {
      break;
    }
    recentResults.delete(firstKey);
  }
}

async function handleSearch(url: URL, response: http.ServerResponse) {
  const query = url.searchParams.get("q")?.trim() ?? "";
  const searchResults = await searchSource.search(query);
  rememberResults(searchResults);
  const assets = await store.listAssets(searchResults.map((item) => item.assetKey));
  const results = searchResults.map((item) => ({
    ...item,
    cache: assets[item.assetKey]
  }));

  sendJson(response, 200, { results });
}

async function handleEnsureCache(request: http.IncomingMessage, response: http.ServerResponse) {
  const body = await readBody<EnsureCacheRequest>(request);
  const result = body.result?.assetKey === body.assetKey
    ? body.result
    : recentResults.get(body.assetKey);

  if (!result) {
    sendJson(response, 404, { error: "Asset was not found." });
    return;
  }

  const output = await store.ensureCache(result);
  const trigger = await workerTrigger.start(output.job);

  sendJson(response, 200, {
    ...output,
    trigger
  });
}

async function handleStatus(jobId: string, response: http.ServerResponse) {
  const job = await store.getJob(jobId);

  if (!job) {
    sendJson(response, 404, { error: "Job was not found." });
    return;
  }

  sendJson(response, 200, {
    job,
    asset: await store.getAsset(job.assetKey)
  });
}

async function handlePlayback(assetKey: string, response: http.ServerResponse) {
  const playback = await store.getPlayback(assetKey);

  if (!playback) {
    sendJson(response, 409, { error: "Asset is not ready for playback." });
    return;
  }

  sendJson(response, 200, playback);
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
      sendJson(response, 200, {
        ok: true,
        store: await store.getHealth(),
        search: searchSource.description
      });
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
  console.log(`Cache store: ${store.description}`);
  console.log(`Search source: ${searchSource.description}`);
});
