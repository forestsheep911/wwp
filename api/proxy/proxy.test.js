const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildUpstreamUrl,
  createProxyHandler,
  healthProxyTimeoutMs,
  maxAbortSignalTimeoutMs,
  proxyTimeoutMsForPath,
  rewriteSessionCookie
} = require("./proxy");

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

test("health uses a shorter route-specific proxy deadline", () => {
  assert.equal(healthProxyTimeoutMs, 25_000);
  assert.equal(proxyTimeoutMsForPath("health", 90_000), 25_000);
  assert.equal(proxyTimeoutMsForPath("health", 10_000), 10_000);
  assert.equal(proxyTimeoutMsForPath("auth/check", 90_000), 90_000);
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

test("malformed or insecure remote BFF URLs fail configuration with 503", async () => {
  const cases = [
    {
      name: "malformed upstream URL",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "not a URL",
        WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example"
      }
    },
    {
      name: "insecure remote upstream URL",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "http://api.example",
        WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example"
      }
    },
    {
      name: "malformed public web origin",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
        WWPDW_PUBLIC_WEB_ORIGIN: "not a URL"
      }
    },
    {
      name: "insecure remote public web origin",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
        WWPDW_PUBLIC_WEB_ORIGIN: "http://web.example"
      }
    }
  ];

  for (const { name, env } of cases) {
    let fetched = false;
    const ctx = context("auth/check");
    await createProxyHandler({
      env,
      fetchImpl: async () => {
        fetched = true;
        return new Response();
      }
    })(ctx, request("auth/check"));
    assert.equal(ctx.res.status, 503, name);
    assert.equal(fetched, false, `${name} must fail before fetch`);
  }
});

test("non-HTTP URL protocols fail configuration even for local hosts", async () => {
  const cases = [
    {
      name: "FTP upstream on localhost",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "ftp://localhost",
        WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example"
      }
    },
    {
      name: "WebSocket upstream on loopback",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "ws://127.0.0.1",
        WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example"
      }
    },
    {
      name: "file upstream",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "file://localhost/tmp",
        WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example"
      }
    },
    {
      name: "FTP public origin on localhost",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
        WWPDW_PUBLIC_WEB_ORIGIN: "ftp://localhost"
      }
    },
    {
      name: "WebSocket public origin on loopback",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
        WWPDW_PUBLIC_WEB_ORIGIN: "ws://127.0.0.1"
      }
    },
    {
      name: "file public origin",
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
        WWPDW_PUBLIC_WEB_ORIGIN: "file://localhost/tmp"
      }
    }
  ];

  for (const { name, env } of cases) {
    let fetched = false;
    const ctx = context("auth/check");
    await createProxyHandler({
      env,
      fetchImpl: async () => {
        fetched = true;
        return new Response();
      }
    })(ctx, request("auth/check"));
    assert.equal(ctx.res.status, 503, name);
    assert.equal(fetched, false, `${name} must fail before fetch`);
  }
});

test("invalid BFF timeout values fail configuration with 503", async () => {
  for (const timeoutValue of ["0", "-1", "1.5", "NaN", "Infinity"]) {
    let fetched = false;
    const ctx = context("auth/check");
    await createProxyHandler({
      env: {
        WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
        WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example",
        WWPDW_BFF_TIMEOUT_MS: timeoutValue
      },
      fetchImpl: async () => {
        fetched = true;
        return new Response();
      }
    })(ctx, request("auth/check"));
    assert.equal(ctx.res.status, 503, `invalid timeout ${timeoutValue}`);
    assert.equal(fetched, false, `invalid timeout ${timeoutValue} must fail before fetch`);
  }
});

test("BFF timeouts outside AbortSignal.timeout range fail before ordinary and health fetches", async () => {
  assert.equal(maxAbortSignalTimeoutMs, 4_294_967_295);
  for (const path of ["auth/check", "health"]) {
    for (const timeoutValue of ["4294967296", "9007199254740992"]) {
      let fetched = false;
      const ctx = context(path);
      await createProxyHandler({
        env: {
          WWPDW_ORIGIN_API_BASE_URL: "https://api.example",
          WWPDW_PUBLIC_WEB_ORIGIN: "https://web.example",
          WWPDW_BFF_TIMEOUT_MS: timeoutValue
        },
        fetchImpl: async () => {
          fetched = true;
          return new Response();
        }
      })(ctx, request(path));
      assert.equal(ctx.res.status, 503, `${path} with timeout ${timeoutValue}`);
      assert.equal(fetched, false, `${path} with timeout ${timeoutValue} must fail before fetch`);
    }
  }
});
