# Cross-Origin Session Security Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace persisted access keys with revocable HttpOnly cross-origin sessions, CSRF protection, and device/session controls.

**Architecture:** A focused `session-store` owns opaque token hashing, lifetime checks, and subject-wide revocation in the existing local/Azure access backends. The HTTP server owns cookie, exact-origin CORS, CSRF validation, and routes. The web client is credentialed-cookie-only and obtains CSRF state from the server.

**Tech Stack:** Node.js `http`, TypeScript, Azure Table Storage, React, Vite, `node:test`.

## Global Constraints

- Cookie is `HttpOnly`, `Secure`, and `SameSite=None` in production.
- Browser origins come only from `WWPDW_ALLOWED_WEB_ORIGINS`; no wildcard credentialed CORS.
- Do not retain `x-wwpdw-access-key` or browser persistence of passcodes.
- Unsafe API methods require a session-bound CSRF token and an allowed Origin.
- Sessions have 30-day idle and 90-day absolute defaults, configurable through environment variables.
- Passcode changes/reset revoke every existing member session.
- Account/session records preserve extension fields for `passcode`/`oauth` authentication and MFA verification.

---

### Task 1: Model and persist sessions

**Files:**
- Create: `apps/api/src/session-store.ts`
- Create: `apps/api/src/session-store.test.ts`
- Modify: `apps/api/src/access-store.ts`
- Modify: `apps/api/src/env.ts`

**Interfaces:**
- Produces `SessionStore.create`, `authenticate`, `listForSubject`, `revoke`, `revokeSubject`, and `renew`.
- Session subjects are `{ role: "admin" }` or `{ role: "member"; memberId: string; memberName: string }`.

- [ ] **Step 1: Write failing session tests**

```ts
test("a raw session secret is never persisted and authenticates only before expiry", async () => {
  const store = createSessionStore({ now: () => new Date("2026-07-14T00:00:00Z") });
  const issued = await store.create(memberSubject);
  assert.equal((await store.authenticate(issued.cookieValue))?.subject.memberId, "member-1");
  assert.equal((await store.debugRecord(issued.id))?.secretHash, hash(issued.secret));
});

test("revoking a subject invalidates every previous session", async () => { /* issue two, revoke, both reject */ });
```

- [ ] **Step 2: Run the failing tests**

Run: `npx tsx --test apps/api/src/session-store.test.ts`

Expected: failure because `session-store.ts` does not exist.

- [ ] **Step 3: Implement the session store and Access Store persistence**

Create opaque `id.secret` tokens from cryptographic random bytes; store only SHA-256 secret hashes. Persist under a distinct `session` partition in Azure Table and a `sessions` collection in local state. Reject hash mismatch, revocation, idle expiry, and absolute expiry; renewal cannot exceed absolute expiry.

- [ ] **Step 4: Run the session tests**

Run: `npx tsx --test apps/api/src/session-store.test.ts`

Expected: pass.

### Task 2: Protect HTTP authentication, CORS, and CSRF

**Files:**
- Create: `apps/api/src/auth-http.ts`
- Create: `apps/api/src/auth-http.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `.env.example`

**Interfaces:**
- `createAuthHttpConfig(env)` parses exact allowed origins and cookie flags.
- `applyCors`, `readSessionCookie`, `setSessionCookie`, `clearSessionCookie`, and `validateCsrf` centralize HTTP controls.

- [ ] **Step 1: Write failing HTTP policy tests**

```ts
test("an allowed origin receives exact credentialed CORS headers", () => { /* no wildcard */ });
test("unlisted origins receive no CORS headers", () => { /* fail closed */ });
test("unsafe cross-origin requests require the session CSRF token", () => { /* 403 */ });
test("production cookies are HttpOnly Secure SameSite=None", () => { /* inspect Set-Cookie */ });
```

- [ ] **Step 2: Run the failing HTTP policy tests**

Run: `npx tsx --test apps/api/src/auth-http.test.ts`

Expected: failure because `auth-http.ts` does not exist.

- [ ] **Step 3: Implement central HTTP policy and migrate server authentication**

Replace header-key identity resolution with session-cookie authentication. Add login, logout, logout-all, session listing and selected-session deletion routes. Issue sessions on member registration, reset, and explicit login. Require CSRF for POST/DELETE routes and exact CORS handling for all API responses. Revoke sessions after passcode changes/resets.

- [ ] **Step 4: Run API policy tests and typecheck**

Run: `npx tsx --test apps/api/src/auth-http.test.ts apps/api/src/session-store.test.ts && npm run typecheck --workspace @wwpdw/api`

Expected: pass.

### Task 3: Remove browser credential storage and add session UI

**Files:**
- Delete: `apps/web/src/cinema/access-key-storage.ts`
- Delete: `apps/web/test/access-key-storage.test.ts`
- Create: `apps/web/src/cinema/session-state.ts`
- Create: `apps/web/test/session-state.test.ts`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/cinema/components/AccessGate.tsx`
- Modify: `apps/web/src/cinema/components/ProfileDialog.tsx`
- Modify: `apps/web/src/cinema/components/AdminPanel.tsx`
- Modify: `apps/web/src/cinema/i18n.ts`

**Interfaces:**
- `request` always uses `credentials: "include"`; `sessionCsrfToken` is memory-only.
- `listSessions`, `revokeSession`, `logout`, and `logoutAll` map to the new API routes.

- [ ] **Step 1: Write failing web session-state tests**

```ts
test("a valid check response restores identity without reading localStorage", () => { /* state comes from response */ });
test("logout removes in-memory CSRF state", () => { /* no storage mutation */ });
```

- [ ] **Step 2: Run the failing web tests**

Run: `npx tsx --test apps/web/test/session-state.test.ts`

Expected: failure because `session-state.ts` does not exist.

- [ ] **Step 3: Implement credentialed client flow and session controls**

Delete storage access and access-key headers. Login posts a passcode only once; successful auth check captures CSRF in memory. Replace local logout with server logout. Add member device-list/revoke controls and admin session auditing/revocation controls using the existing dialogs/panels.

- [ ] **Step 4: Run web tests and build**

Run: `npx tsx --test apps/web/test/*.test.ts && npm run build --workspace @wwpdw/web`

Expected: pass.

### Task 4: Wire deployment, validate regression coverage, and document rollout

**Files:**
- Modify: `infra/deploy-api-containerapp.ps1`
- Modify: `infra/deploy-web-staticapp.ps1`
- Modify: `infra/README.md`
- Modify: `README.md`

- [ ] **Step 1: Write/extend failing configuration checks**

Add deterministic tests for environment parsing and deployment-script text assertions that require `WWPDW_ALLOWED_WEB_ORIGINS` and session lifetime variables.

- [ ] **Step 2: Run configuration tests to prove failure**

Run: `npx tsx --test apps/api/src/auth-http.test.ts`

Expected: failure until the required configuration is implemented.

- [ ] **Step 3: Configure deployment and rollout documentation**

Derive the Static Web App default hostname during deployment and pass it as the API's allowed origin. Document all secret-free variables, cross-site cookie requirements, local development setup, and post-deploy browser smoke test.

- [ ] **Step 4: Run full verification**

Run: `npx tsx --test apps/api/src/*.test.ts apps/web/test/*.test.ts && npm run typecheck && npm run build && git diff --check`

Expected: pass with no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api apps/web infra README.md .env.example docs
git commit -m "feat: add revocable cookie sessions"
```
