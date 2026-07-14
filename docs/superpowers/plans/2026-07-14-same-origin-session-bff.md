# Same-Origin Session BFF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route production browser API traffic through a same-origin Azure Static Web Apps BFF so iOS WebKit retains the existing secure, revocable server session.

**Architecture:** A stateless managed HTTP Function proxies the Static Web Apps `/api/*` namespace to the existing Container Apps API, fixes the health-path exception, forwards the session and CSRF controls, and rewrites only the session cookie's SameSite attribute. The production web bundle uses relative URLs; the Container Apps API remains the sole authentication and business-logic authority.

**Tech Stack:** Azure Static Web Apps managed Functions, Azure Functions Node.js 20 programming model v3, CommonJS, native `fetch`, `node:test`, React, TypeScript, Vite, PowerShell, Azure CLI.

## Global Constraints

- Production browser requests use only the Static Web Apps origin for `/api/*`.
- The browser session cookie remains `HttpOnly` and `Secure`, and becomes `SameSite=Lax` at the BFF boundary.
- Session validation, expiry, revocation, device management, and CSRF enforcement remain in the Container Apps API.
- The BFF upstream host comes only from `WWPDW_ORIGIN_API_BASE_URL`; request data cannot select a host.
- The BFF never logs request bodies, passcodes, cookies, CSRF tokens, or session values.
- Production web assets must not contain the Container Apps API base URL.
- Local direct-API development remains supported through `VITE_API_BASE_URL`.
- The obsolete `home-browse` access-key Function and its secrets are removed.

---

### Task 1: Build and test the stateless BFF

**Files:**
- Create: `api/proxy/function.json`
- Create: `api/proxy/index.js`
- Create: `api/proxy/proxy.js`
- Create: `api/proxy/proxy.test.js`
- Modify: `api/package.json`
- Modify: `api/package-lock.json`
- Delete: `api/home-browse/function.json`
- Delete: `api/home-browse/index.js`

**Interfaces:**
- Consumes: `WWPDW_ORIGIN_API_BASE_URL`, `WWPDW_PUBLIC_WEB_ORIGIN`, and optional `WWPDW_BFF_TIMEOUT_MS`.
- Produces: `createProxyHandler({ fetchImpl?, env? })`, `buildUpstreamUrl(baseUrl, path, search)`, and `rewriteSessionCookie(value)` from `api/proxy/proxy.js`.
- Exposes: anonymous managed Function route `{*path}` for `GET`, `HEAD`, `POST`, `PUT`, `PATCH`, `DELETE`, and `OPTIONS`.

- [ ] **Step 1: Write failing BFF unit tests**

Create `api/proxy/proxy.test.js` with deterministic fetch and context fakes:

```js
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
```

- [ ] **Step 2: Run the BFF tests and verify the expected failure**

Run: `node --test api/proxy/proxy.test.js`

Expected: fail with `Cannot find module './proxy'`.

- [ ] **Step 3: Implement the pure proxy module and thin Function entry point**

Create `api/proxy/proxy.js` with these exact behaviors:

```js
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
```

Create `api/proxy/index.js`:

```js
const { createProxyHandler } = require("./proxy");

module.exports = createProxyHandler();
```

Create `api/proxy/function.json`:

```json
{
  "bindings": [
    {
      "authLevel": "anonymous",
      "type": "httpTrigger",
      "direction": "in",
      "name": "req",
      "methods": ["get", "head", "post", "put", "patch", "delete", "options"],
      "route": "{*path}"
    },
    {
      "type": "http",
      "direction": "out",
      "name": "res"
    }
  ]
}
```

- [ ] **Step 4: Remove the legacy Function and unused dependencies**

Delete `api/home-browse/`. Replace `api/package.json` with:

```json
{
  "name": "wwpdw-swa-api",
  "version": "0.1.0",
  "private": true,
  "license": "Apache-2.0",
  "type": "commonjs",
  "scripts": {
    "test": "node --test proxy/*.test.js"
  }
}
```

Run `npm install --package-lock-only --prefix api` to regenerate `api/package-lock.json` without Azure Storage packages.

- [ ] **Step 5: Run the BFF tests**

Run: `npm test --prefix api`

Expected: all proxy tests pass and no package engine warning is emitted.

- [ ] **Step 6: Commit the BFF**

```powershell
git add -- api
git commit -m "feat: add same-origin API BFF"
```

### Task 2: Switch production web routing to same-origin

**Files:**
- Create: `apps/web/src/api-routing.ts`
- Create: `apps/web/test/api-routing.test.ts`
- Modify: `apps/web/src/api.ts`

**Interfaces:**
- Produces: `normalizeApiBaseUrl(value)`, `apiRequestUrl(baseUrl, path)`, and `healthRequestUrl(baseUrl)`.
- Consumes: optional `VITE_API_BASE_URL`; an empty value means same-origin production routing.

- [ ] **Step 1: Write failing routing tests**

Create `apps/web/test/api-routing.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { apiRequestUrl, healthRequestUrl, normalizeApiBaseUrl } from "../src/api-routing";

test("production requests stay on the current Static Web Apps origin", () => {
  assert.equal(normalizeApiBaseUrl(undefined), "");
  assert.equal(apiRequestUrl("", "/api/auth/login"), "/api/auth/login");
  assert.equal(healthRequestUrl(""), "/api/health");
});

test("local direct API development keeps the unprefixed health endpoint", () => {
  const base = normalizeApiBaseUrl("http://127.0.0.1:8787/");
  assert.equal(apiRequestUrl(base, "/api/auth/check"), "http://127.0.0.1:8787/api/auth/check");
  assert.equal(healthRequestUrl(base), "http://127.0.0.1:8787/health");
});
```

- [ ] **Step 2: Run the routing tests and verify the expected failure**

Run: `npx tsx --test apps/web/test/api-routing.test.ts`

Expected: fail because `apps/web/src/api-routing.ts` does not exist.

- [ ] **Step 3: Implement the URL boundary and use it in the API client**

Create `apps/web/src/api-routing.ts`:

```ts
export function normalizeApiBaseUrl(value?: string) {
  return (value ?? "").replace(/\/$/, "");
}

export function apiRequestUrl(baseUrl: string, path: string) {
  return `${baseUrl}${path}`;
}

export function healthRequestUrl(baseUrl: string) {
  return apiRequestUrl(baseUrl, baseUrl ? "/health" : "/api/health");
}
```

Update `apps/web/src/api.ts` to import the helpers and replace the local URL logic:

```ts
import { apiRequestUrl, healthRequestUrl, normalizeApiBaseUrl } from "./api-routing";

const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);

function apiUrl(path: string) {
  return apiRequestUrl(apiBaseUrl, path);
}

export async function wakeBackend() {
  const response = await fetch(healthRequestUrl(apiBaseUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(backendWakeTimeoutMs)
  });
  return response.ok;
}
```

- [ ] **Step 4: Run web tests, typecheck, and build**

Run: `npx tsx --test apps/web/test/*.test.ts && npm run typecheck --workspace @wwpdw/web && npm run build --workspace @wwpdw/web`

Expected: all web tests pass, TypeScript emits no errors, and Vite completes the production build.

- [ ] **Step 5: Commit same-origin web routing**

```powershell
git add -- apps/web/src/api.ts apps/web/src/api-routing.ts apps/web/test/api-routing.test.ts
git commit -m "fix: route browser API calls through same origin"
```

### Task 3: Make deployment BFF-first and remove legacy secrets

**Files:**
- Create: `infra/deploy-web-staticapp.test.mjs`
- Modify: `infra/deploy-web-staticapp.ps1`
- Modify: `infra/README.md`
- Modify: `README.md`

**Interfaces:**
- Produces Static Web Apps settings `WWPDW_ORIGIN_API_BASE_URL`, `WWPDW_PUBLIC_WEB_ORIGIN`, and `WWPDW_BFF_TIMEOUT_MS=90000`.
- Deletes obsolete settings `WWPDW_ADMIN_KEY`, `AZURE_STORAGE_MEMBER_TABLE`, and every `WWPDW_HOME_*` key.
- Builds production assets with an empty `VITE_API_BASE_URL` and rejects any bundle containing the Container Apps origin.

- [ ] **Step 1: Write a failing deployment-contract test**

Create `infra/deploy-web-staticapp.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const script = await readFile(new URL("./deploy-web-staticapp.ps1", import.meta.url), "utf8");

test("web deployment configures the BFF and removes the access-key Function settings", () => {
  assert.match(script, /WWPDW_PUBLIC_WEB_ORIGIN=\$publicWebOrigin/);
  assert.match(script, /WWPDW_BFF_TIMEOUT_MS=90000/);
  assert.match(script, /staticwebapp appsettings delete/);
  assert.match(script, /WWPDW_ADMIN_KEY/);
  assert.doesNotMatch(script, /storage container create/);
  assert.doesNotMatch(script, /WWPDW_HOME_CACHE_STORAGE_CONNECTION_STRING=\$storageConnectionString/);
});

test("production assets are built without the cross-site API origin", () => {
  assert.match(script, /\$env:VITE_API_BASE_URL = ""/);
  assert.match(script, /\$builtScript\.Contains\(\$ApiBaseUrl\)/);
  assert.match(script, /Built web asset still contains cross-site API base URL/);
});
```

- [ ] **Step 2: Run the deployment-contract test and verify the expected failure**

Run: `node --test infra/deploy-web-staticapp.test.mjs`

Expected: fail because the current script still provisions the legacy cache Function and embeds `$ApiBaseUrl` in the bundle.

- [ ] **Step 3: Refactor the deployment script around the BFF contract**

Make these concrete changes in `infra/deploy-web-staticapp.ps1`:

```powershell
param(
    [string]$ResourceGroup = "rg-ww-player-cache-dev",
    [string]$StaticAppName = "stapp-ww-player-dev",
    [string]$Location = "eastasia",
    [string]$ApiAppName = "ca-ww-player-api",
    [string]$ApiBaseUrl = "",
    [string]$AzCli = $(if ($env:WWPDW_AZ_CLI) { $env:WWPDW_AZ_CLI } else { "az" })
)
```

After creating or locating the Static Web App, resolve its first-party origin before setting app settings:

```powershell
$hostName = & $AzCli staticwebapp show `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --query "defaultHostname" `
    --output tsv

if (-not $hostName) {
    throw "Could not find Static Web App hostname."
}

$publicWebOrigin = "https://$hostName"
$appSettings = @(
    "WWPDW_ORIGIN_API_BASE_URL=$ApiBaseUrl",
    "WWPDW_PUBLIC_WEB_ORIGIN=$publicWebOrigin",
    "WWPDW_BFF_TIMEOUT_MS=90000"
)
```

Delete legacy settings only when they exist:

```powershell
$legacySettingNames = @(
    "WWPDW_ADMIN_KEY",
    "AZURE_STORAGE_MEMBER_TABLE",
    "WWPDW_HOME_BROWSE_FRESH_SECONDS",
    "WWPDW_HOME_BROWSE_ORIGIN_TIMEOUT_MS",
    "WWPDW_HOME_BROWSE_STALE_REFRESH_TIMEOUT_MS",
    "WWPDW_HOME_BROWSE_STALE_SECONDS",
    "WWPDW_HOME_CACHE_CONTAINER",
    "WWPDW_HOME_CACHE_STORAGE_CONNECTION_STRING"
)
$existingSettings = (& $AzCli staticwebapp appsettings list `
    --name $StaticAppName `
    --resource-group $ResourceGroup `
    --output json | ConvertFrom-Json).properties
$settingsToDelete = @($legacySettingNames | Where-Object { $existingSettings.PSObject.Properties.Name -contains $_ })
if ($settingsToDelete.Count -gt 0) {
    & $AzCli staticwebapp appsettings delete `
        --name $StaticAppName `
        --resource-group $ResourceGroup `
        --setting-names $settingsToDelete `
        --output none
}
```

Build and assert the same-origin bundle:

```powershell
$previousApiBaseUrl = $env:VITE_API_BASE_URL
try {
    $env:VITE_API_BASE_URL = ""
    Push-Location $repoRoot
    try {
        npm run build --workspace @wwpdw/web
        $builtIndexPath = Join-Path $repoRoot "apps\web\dist\index.html"
        $builtIndex = Get-Content $builtIndexPath -Raw
        $builtScriptMatch = [regex]::Match($builtIndex, "/assets/[^`"']+\.js")
        if (-not $builtScriptMatch.Success) { throw "Could not find built web JavaScript asset in $builtIndexPath." }
        $builtScriptPath = Join-Path (Join-Path $repoRoot "apps\web\dist") ($builtScriptMatch.Value.TrimStart("/") -replace "/", "\")
        $builtScript = Get-Content $builtScriptPath -Raw
        if ($builtScript.Contains($ApiBaseUrl)) { throw "Built web asset still contains cross-site API base URL $ApiBaseUrl." }
        if (-not $builtScript.Contains("/api/auth/login")) { throw "Built web asset does not contain the same-origin login route." }
    } finally {
        Pop-Location
    }
} finally {
    $env:VITE_API_BASE_URL = $previousApiBaseUrl
}
```

- [ ] **Step 4: Update deployment documentation**

Document these exact operating rules in `README.md` and `infra/README.md`:

```markdown
- Production web requests use the Static Web Apps `/api/*` BFF; do not set `VITE_API_BASE_URL` during production builds.
- `WWPDW_ORIGIN_API_BASE_URL` is the fixed Container Apps upstream.
- `WWPDW_PUBLIC_WEB_ORIGIN` is the Static Web Apps `https://<defaultHostname>` origin forwarded for API CSRF/origin checks.
- The BFF holds no session state and no passcode or admin key. OAuth and MFA remain future authentication extensions.
```

- [ ] **Step 5: Run deployment tests and a complete local verification**

Run:

```powershell
node --test infra/deploy-web-staticapp.test.mjs
npm test --prefix api
npx tsx --test apps/web/test/*.test.ts apps/api/src/*.test.ts
npm run typecheck
npm run build
git diff --check
```

Expected: every test passes, all three workspaces typecheck and build, and `git diff --check` emits no output.

- [ ] **Step 6: Commit deployment and documentation changes**

```powershell
git add -- infra README.md
git commit -m "ops: deploy web through same-origin BFF"
```

### Task 4: Deploy and verify the production authentication lifecycle

**Files:**
- Verify only: `apps/web/dist/`
- Verify only: Azure Static Web Apps application settings and production endpoints

**Interfaces:**
- Production site: `https://gentle-rock-049daed00.7.azurestaticapps.net`.
- Production BFF endpoints: `/api/health`, `/api/auth/login`, `/api/auth/check`, `/api/credit-policy`, and `/api/auth/logout`.

- [ ] **Step 1: Confirm the working tree and commits are ready**

Run: `git status --short && git log -5 --oneline`

Expected: clean status and three focused implementation commits after the design and plan commits.

- [ ] **Step 2: Deploy the web and managed Function together**

Run:

```powershell
.\infra\deploy-web-staticapp.ps1
```

Expected: Vite build succeeds, Static Web Apps CLI reports a production deployment, and the script returns the Static Web Apps URL plus Container Apps upstream URL.

- [ ] **Step 3: Verify settings without printing their values**

Run:

```powershell
$settings = (az staticwebapp appsettings list --name stapp-ww-player-dev --resource-group rg-ww-player-cache-dev --output json | ConvertFrom-Json).properties
$settings.PSObject.Properties.Name | Sort-Object
```

Expected keys: `WWPDW_BFF_TIMEOUT_MS`, `WWPDW_ORIGIN_API_BASE_URL`, and `WWPDW_PUBLIC_WEB_ORIGIN`. No admin key, member table, storage connection string, or `WWPDW_HOME_*` setting remains.

- [ ] **Step 4: Verify health and the full cookie session using a secret-safe PowerShell web session**

Run this without echoing `$adminKey`, the request body, the cookie collection, or `$csrf`:

```powershell
$site = "https://gentle-rock-049daed00.7.azurestaticapps.net"
$health = Invoke-WebRequest "$site/api/health" -UseBasicParsing
if ($health.StatusCode -ne 200) { throw "BFF health failed: $($health.StatusCode)" }

$adminKey = az keyvault secret show --vault-name kv-wwcache-e9219db7 --name WWPDW-ADMIN-KEY --query value --output tsv
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-WebRequest "$site/api/auth/login" -Method Post -ContentType "application/json" -Body (@{ passcode = $adminKey } | ConvertTo-Json -Compress) -WebSession $session -UseBasicParsing
if ($login.StatusCode -ne 200) { throw "Login failed: $($login.StatusCode)" }
if ($login.Headers["Set-Cookie"] -notmatch "HttpOnly" -or $login.Headers["Set-Cookie"] -notmatch "Secure" -or $login.Headers["Set-Cookie"] -notmatch "SameSite=Lax") { throw "Login cookie does not meet the BFF policy." }
$loginPayload = $login.Content | ConvertFrom-Json
$csrf = $loginPayload.csrfToken

$check = Invoke-WebRequest "$site/api/auth/check" -WebSession $session -UseBasicParsing
$policy = Invoke-WebRequest "$site/api/credit-policy" -WebSession $session -UseBasicParsing
if ($check.StatusCode -ne 200 -or $policy.StatusCode -ne 200) { throw "Authenticated BFF requests failed." }

$logout = Invoke-WebRequest "$site/api/auth/logout" -Method Post -ContentType "application/json" -Headers @{ "x-wwpdw-csrf-token" = $csrf } -Body "{}" -WebSession $session -UseBasicParsing
if ($logout.StatusCode -ne 200 -or $logout.Headers["Set-Cookie"] -notmatch "Max-Age=0") { throw "Logout did not clear the BFF cookie." }

try {
    Invoke-WebRequest "$site/api/auth/check" -WebSession $session -UseBasicParsing -ErrorAction Stop | Out-Null
    throw "Auth check unexpectedly succeeded after logout."
} catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 401) { throw }
}
```

Expected: health `200`, login `200` with a first-party Lax cookie, authenticated check and policy `200`, logout `200` with cookie deletion, and post-logout check `401`.

- [ ] **Step 5: Perform the rendered desktop smoke test**

Open the production site in a clean in-app browser context and verify: the untouched login screen does not display the wake quiz; login reaches the home page; the initial shelf resolves; refresh stays authenticated without a login flash; logout returns to login.

- [ ] **Step 6: Request the final iOS WebKit confirmation**

Ask the user to repeat the clean mobile sequence in iOS Safari. Expected: one login, home data loads, refresh remains authenticated, and there is no repeated login redirect. If it fails, collect the BFF request IDs and production logs without collecting cookie or passcode values.

## References

- Azure Static Web Apps managed Functions integrate APIs under the same `/api` route without custom browser CORS rules: https://learn.microsoft.com/en-us/azure/static-web-apps/apis-functions
- Azure Functions HTTP triggers support custom route templates through `function.json`: https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-http-webhook-trigger
- Azure Functions Node.js responses support cookies and binary body values: https://learn.microsoft.com/en-us/azure/azure-functions/functions-reference-node
