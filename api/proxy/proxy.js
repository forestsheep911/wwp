const allowedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const requestHeaders = ["content-type", "cookie", "if-modified-since", "if-none-match", "range", "x-request-id", "x-wwpdw-csrf-token"];
const responseHeaders = ["accept-ranges", "cache-control", "content-range", "content-type", "etag", "last-modified", "location", "retry-after", "x-request-id"];

function normalizedBaseUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    throw new Error("Proxy upstream must use HTTPS");
  }
  parsed.pathname = parsed.pathname.replace(/\/$/, "");
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

function normalizedProxyPath(value) {
  const path = String(value || "").replace(/^\/+/, "");
  const segments = path.split("/");
  if (!path || segments.some((part) => !part || decodeURIComponent(part) === "." || decodeURIComponent(part) === "..")) {
    throw new Error("Invalid proxy path");
  }
  return path;
}

function buildUpstreamUrl(baseUrl, pathValue, search = "") {
  const path = normalizedProxyPath(pathValue);
  const upstreamPath = path === "health" ? "/health" : `/api/${path}`;
  return `${normalizedBaseUrl(baseUrl)}${upstreamPath}${search}`;
}

function rewriteSessionCookie(value) {
  return String(value).replace(/;\s*SameSite=None/gi, "; SameSite=Lax");
}

function requestBody(req, method) {
  if (method === "GET" || method === "HEAD") return undefined;
  if (Buffer.isBuffer(req.rawBody) || typeof req.rawBody === "string") return req.rawBody;
  if (Buffer.isBuffer(req.body) || typeof req.body === "string") return req.body;
  return req.body == null ? undefined : JSON.stringify(req.body);
}

function selectedHeaders(source, names) {
  return Object.fromEntries(names.flatMap((name) => source?.[name] == null ? [] : [[name, source[name]] ]));
}

function jsonError(status, error, requestId) {
  return {
    status,
    headers: { "Content-Type": "application/json", "x-request-id": requestId },
    body: JSON.stringify({ error, requestId })
  };
}

function createProxyHandler({ fetchImpl = fetch, env = process.env } = {}) {
  return async function proxy(context, req) {
    const startedAt = Date.now();
    const method = String(req.method || "GET").toUpperCase();
    const requestId = String(req.headers?.["x-request-id"] || `bff_${Date.now()}`);
    let path;
    try {
      path = normalizedProxyPath(context.bindingData?.path);
      if (!allowedMethods.has(method)) {
        context.res = jsonError(405, "Method not allowed", requestId);
        return;
      }
      if (!env.WWPDW_ORIGIN_API_BASE_URL || !env.WWPDW_PUBLIC_WEB_ORIGIN) {
        context.res = jsonError(503, "API proxy is not configured", requestId);
        return;
      }
      const publicOrigin = new URL(env.WWPDW_PUBLIC_WEB_ORIGIN).origin;
      const search = new URL(req.url).search;
      const headers = selectedHeaders(req.headers, requestHeaders);
      headers.origin = publicOrigin;
      headers["x-request-id"] = requestId;
      const timeoutMs = Number(env.WWPDW_BFF_TIMEOUT_MS || 90000);
      const upstream = await fetchImpl(buildUpstreamUrl(env.WWPDW_ORIGIN_API_BASE_URL, path, search), {
        method,
        headers,
        body: requestBody(req, method),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs)
      });
      const resultHeaders = selectedHeaders(Object.fromEntries(upstream.headers.entries()), responseHeaders);
      const setCookie = upstream.headers.get("set-cookie");
      if (setCookie) resultHeaders["Set-Cookie"] = rewriteSessionCookie(setCookie);
      context.res = {
        status: upstream.status,
        headers: resultHeaders,
        body: method === "HEAD" ? undefined : Buffer.from(await upstream.arrayBuffer())
      };
      context.log(`${method} ${path} ${upstream.status} ${Date.now() - startedAt}ms ${requestId}`);
    } catch (error) {
      const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
      context.log.error(`${method} ${path || "invalid"} ${timedOut ? 504 : 502} ${Date.now() - startedAt}ms ${requestId}`);
      context.res = jsonError(timedOut ? 504 : 502, timedOut ? "Upstream API timed out" : "Upstream API unavailable", requestId);
    }
  };
}

module.exports = { buildUpstreamUrl, createProxyHandler, rewriteSessionCookie };
