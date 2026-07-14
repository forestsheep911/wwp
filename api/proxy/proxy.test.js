const assert = require("node:assert/strict");
const test = require("node:test");

const { buildUpstreamUrl, createProxyHandler, rewriteSessionCookie } = require("./proxy");

function request(path, overrides = {}) {
  return {
    method: "GET",
    url: `https://gentle-rock-049daed00.7.azurestaticapps.net/api/${path}`,
    headers: { "x-request-id": "req-test" },
    ...overrides
  };
}

function context(path) {
  const messages = [];
  return {
    bindingData: { path },
    log: Object.assign((message) => messages.push(String(message)), {
      error: (message) => messages.push(String(message)),
      warn: (message) => messages.push(String(message))
    }),
    messages
  };
}

test("buildUpstreamUrl maps API and health routes without accepting another host", () => {
  assert.equal(
    buildUpstreamUrl("https://api.example", "auth/check", "?mode=full"),
    "https://api.example/api/auth/check?mode=full"
  );
  assert.equal(buildUpstreamUrl("https://api.example", "health", ""), "https://api.example/health");
  assert.throws(() => buildUpstreamUrl("https://api.example", "../other", ""), /Invalid proxy path/);
});

test("rewriteSessionCookie makes the proxied session first-party Lax", () => {
  const cookie = "wwpdw_session=secret; Path=/; HttpOnly; SameSite=None; Secure; Expires=Wed, 01 Jan 2027 00:00:00 GMT";
  const rewritten = rewriteSessionCookie(cookie);
  assert.match(rewritten, /HttpOnly/);
  assert.match(rewritten, /Secure/);
  assert.match(rewritten, /SameSite=Lax/);
  assert.doesNotMatch(rewritten, /SameSite=None/);
});

test("rewriteSessionCookie preserves logout deletion semantics", () => {
  const rewritten = rewriteSessionCookie("wwpdw_session=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0");
  assert.match(rewritten, /SameSite=Lax/);
  assert.match(rewritten, /Max-Age=0/);
});

test("login forwards only selected request data and rewrites Set-Cookie", async () => {
  let upstream;
  const handler = createProxyHandler({
    env: {
      WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
      WWPDW_PUBLIC_WEB_ORIGIN: "https://gentle-rock-049daed00.7.azurestaticapps.net"
    },
    fetchImpl: async (url, init) => {
      upstream = { url, init };
      return new Response(JSON.stringify({ ok: true, csrfToken: "csrf" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": "wwpdw_session=value; Path=/; HttpOnly; SameSite=None; Secure",
          "x-request-id": "req-upstream"
        }
      });
    }
  });
  const ctx = context("auth/login");
  await handler(ctx, request("auth/login", {
    method: "POST",
    rawBody: JSON.stringify({ passcode: "not-logged" }),
    headers: {
      cookie: "wwpdw_session=old",
      "content-type": "application/json",
      "x-request-id": "req-test",
      authorization: "must-not-forward"
    }
  }));

  assert.equal(upstream.url, "https://api.example/api/auth/login");
  assert.equal(upstream.init.headers.origin, "https://gentle-rock-049daed00.7.azurestaticapps.net");
  assert.equal(upstream.init.headers.cookie, "wwpdw_session=old");
  assert.equal(upstream.init.headers.authorization, undefined);
  assert.match(ctx.res.headers["Set-Cookie"], /SameSite=Lax/);
  assert.equal(ctx.res.status, 200);
  assert.equal(ctx.messages.some((message) => message.includes("not-logged")), false);
});

test("health maps to the unprefixed upstream endpoint", async () => {
  let target;
  const handler = createProxyHandler({
    env: {
      WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
      WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example"
    },
    fetchImpl: async (url) => {
      target = url;
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    }
  });
  const ctx = context("health");
  await handler(ctx, request("health"));
  assert.equal(target, "https://api.example/health");
  assert.equal(ctx.res.status, 200);
});

test("authenticated range requests preserve CSRF, status, metadata, and binary bodies", async () => {
  let upstreamInit;
  const handler = createProxyHandler({
    env: {
      WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
      WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example"
    },
    fetchImpl: async (_url, init) => {
      upstreamInit = init;
      return new Response(Uint8Array.from([0, 1, 2, 255]), {
        status: 206,
        headers: {
          "content-type": "application/octet-stream",
          "content-range": "bytes 0-3/4",
          "x-request-id": "req-upstream"
        }
      });
    }
  });
  const ctx = context("media/file");
  await handler(ctx, request("media/file", {
    method: "POST",
    rawBody: "{}",
    headers: {
      cookie: "wwpdw_session=value",
      range: "bytes=0-3",
      "x-request-id": "req-test",
      "x-wwpdw-csrf-token": "csrf"
    }
  }));
  assert.equal(upstreamInit.headers.range, "bytes=0-3");
  assert.equal(upstreamInit.headers["x-wwpdw-csrf-token"], "csrf");
  assert.equal(ctx.res.status, 206);
  assert.equal(ctx.res.headers["content-range"], "bytes 0-3/4");
  assert.deepEqual(ctx.res.body, Buffer.from([0, 1, 2, 255]));
});

test("invalid methods, missing configuration, upstream failures, and timeouts fail closed", async () => {
  const invalidMethod = context("auth/check");
  await createProxyHandler({ env: {}, fetchImpl: async () => new Response() })(invalidMethod, request("auth/check", { method: "TRACE" }));
  assert.equal(invalidMethod.res.status, 405);

  const missing = context("auth/check");
  await createProxyHandler({ env: {}, fetchImpl: async () => new Response() })(missing, request("auth/check"));
  assert.equal(missing.res.status, 503);

  const unavailable = context("auth/check");
  await createProxyHandler({
    env: {
      WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
      WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example"
    },
    fetchImpl: async () => { throw new Error("connection refused"); }
  })(unavailable, request("auth/check"));
  assert.equal(unavailable.res.status, 502);

  const timeout = context("auth/check");
  await createProxyHandler({
    env: {
      WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
      WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example"
    },
    fetchImpl: async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }
  })(timeout, request("auth/check"));
  assert.equal(timeout.res.status, 504);
});
