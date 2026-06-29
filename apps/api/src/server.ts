import http from "node:http";
import { URL } from "node:url";
import {
  type EnsureCacheRequest,
  mockSearchResults
} from "@wwpdw/shared";
import { createCacheStore } from "@wwpdw/cache-store";
import { CacheWorkerTrigger } from "./job-trigger.js";

const port = Number(process.env.API_PORT ?? 8787);
const store = createCacheStore();
const workerTrigger = new CacheWorkerTrigger();

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

async function handleSearch(url: URL, response: http.ServerResponse) {
  const query = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
  const filteredResults = mockSearchResults
    .filter((item) => {
      if (!query) {
        return true;
      }
      return [item.title, item.source, item.summary, item.assetKey]
        .concat(item.sourceUrl)
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  const assets = await store.listAssets(filteredResults.map((item) => item.assetKey));
  const results = filteredResults.map((item) => ({
    ...item,
    cache: assets[item.assetKey]
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
      sendJson(response, 200, { ok: true, store: await store.getHealth() });
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
});
