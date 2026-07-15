# Authentication Handoff Browse Scheduler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure login and session restoration always start the blank library route's first browse request.

**Architecture:** A pure scheduler decides whether a route is eligible and writes its route key only when a synchronous request-admission callback returns true. `CinemaApp` exposes synchronous browse admission and moves cache/network completion into an internal async runner. Auth and route entry points use the same scheduler.

**Tech Stack:** React 19, TypeScript, `tsx` Node tests, Vite, Azure Static Web Apps.

## Global Constraints

- Do not alter API endpoints, Cookie/session behavior, BFF settings, cache formats, or browse policy values.
- Initial ordinary browse remains `paged`, `offset=0`, `limit=12`; append remains `100`; Lucky remains `48`; TSPDT remains `2,000`.
- Do not mark a route scheduled until request admission succeeds.
- Production diagnostics must not print passcodes, Cookies, CSRF tokens, setting values, or response bodies.

---

### Task 1: Add an admission-aware route scheduler

**Files:**
- Create: `apps/web/src/cinema/browse-route-scheduler.ts`
- Create: `apps/web/test/browse-route-scheduler.test.ts`

**Interfaces:**
- Produces: `scheduleBrowseRoute(lastKey, route, start): { scheduled: boolean; routeKey: string }`.

- [ ] **Step 1: Write the failing test**

```ts
test("admission marks a blank library route only after its start callback accepts", () => {
  const route = { tab: "library" as const, channel: "recommended" as const, view: "newGood" as const, query: "" };
  assert.deepEqual(scheduleBrowseRoute("", route, () => false), { scheduled: false, routeKey: "" });
  assert.deepEqual(scheduleBrowseRoute("", route, () => true), { scheduled: true, routeKey: "recommended:newGood" });
});
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test apps/web/test/browse-route-scheduler.test.ts`

Expected: fail because the scheduler module is absent.

- [ ] **Step 3: Implement the pure scheduler**

```ts
import type { AppTab, BrowseChannel, BrowseViewId } from "./types";

type BrowseRoute = {
  tab: AppTab;
  channel: BrowseChannel;
  view: BrowseViewId;
  query: string;
};

export function scheduleBrowseRoute(lastKey: string, route: BrowseRoute, start: () => boolean) {
  const routeKey = `${route.channel}:${route.view}`;
  if (route.tab !== "library" || route.query.trim() || lastKey === routeKey) return { scheduled: false, routeKey: lastKey };
  return start() ? { scheduled: true, routeKey } : { scheduled: false, routeKey: lastKey };
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `npx tsx --test apps/web/test/browse-route-scheduler.test.ts`

Expected: 1 passing test, 0 failures.

Commit message: `feat: schedule admitted browse routes`

### Task 2: Use synchronous admission for all initial browse entry points

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/test/browse-state.test.ts`

**Interfaces:**
- Consumes: `scheduleBrowseRoute` and current `startBrowseRequest` / `finishBrowseRequest` helpers.
- Produces: `refreshBrowseAssets(options): boolean`; `true` means an internal async runner owns the admitted cache/network request.

- [ ] **Step 1: Write the failing App wiring regression**

```ts
test("CinemaApp schedules browse loading from manual login and restored auth", () => {
  const source = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(source, /function scheduleCurrentBrowseRoute/);
  assert.match(source, /const scheduled = scheduleBrowseRoute\(/);
  assert.match(source, /if \(scheduled\.scheduled\) \{\s*browseRouteLoadRef\.current = scheduled\.routeKey;/);
  assert.match(source, /onUnlock=\{[^]*scheduleCurrentBrowseRoute\(\)/);
  assert.match(source, /checkAccess\(\)[^]*scheduleCurrentBrowseRoute\(\)/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx tsx --test apps/web/test/browse-state.test.ts apps/web/test/browse-route-scheduler.test.ts`

Expected: fail because `CinemaApp` has no shared scheduler/admission handoff.

- [ ] **Step 3: Implement the minimal refactor**

1. Keep option resolution and `startBrowseRequest` in `refreshBrowseAssets`; return `false` when admission fails.
2. Invoke a private `async runBrowseRequest(...)` with `void` after admission and return `true` immediately.
3. Move the existing cache read, API call, stale-response checks, errors, and `finishBrowseRequest` into that runner unchanged.
4. Add `scheduleCurrentBrowseRoute(route)` that passes `() => refreshBrowseAssets({ channel: route.browseChannel, view: route.browseView })` to `scheduleBrowseRoute` and writes `browseRouteLoadRef` only when scheduled.
5. Replace initial direct browse calls in manual `onUnlock`, restored `checkAccess`, route initialization, `openBrowseChannel`, and `openBrowseView` with this scheduler; preserve forced refresh.

- [ ] **Step 4: Verify GREEN**

Run: `npx tsx --test apps/web/test/browse-route-scheduler.test.ts apps/web/test/browse-state.test.ts apps/web/test/browse-load-policy.test.ts apps/web/test/browse-cache.test.ts`

Expected: all focused tests pass, including cache/append/observer regressions.

- [ ] **Step 5: Build and commit**

Run: `npm run typecheck --workspace @wwpdw/web; npm run build --workspace @wwpdw/web; git diff --check`

Expected: exit 0; the known Vite large-chunk warning is allowed.

Commit message: `fix: schedule browse after auth handoff`

### Task 3: Validate and deploy

**Files:**
- Modify only ignored evidence: `.superpowers/sdd/auth-handoff-browse-scheduler-report.md`

- [ ] **Step 1: Run the full repository gate**

Run: `npm test --prefix api`; `npx tsx --test apps/web/test/*.test.ts apps/api/src/*.test.ts`; `node --test infra/deploy-web-staticapp.test.mjs`; `npm run typecheck`; `npm run build --workspace @wwpdw/web`; `git diff --check`; `git status --short`.

Expected: all tests, typechecks, build, diff, and clean status pass.

- [ ] **Step 2: Deploy the exact clean HEAD**

Run: `git rev-parse HEAD`; `.\infra\deploy-web-staticapp.ps1`.

Expected: deployment exits 0 and reports web/BFF success.

- [ ] **Step 3: Verify production safely**

1. Query setting names only and confirm the three BFF setting names remain unchanged.
2. Login only in diagnostic process memory, request `newGood` with `offset=0&limit=12`, and logout in `finally`.
3. Record statuses, timing, bytes, and Cookie flags only.
4. Confirm production API logs show the post-login `newGood` request with `limit=12` and `offset=0`.

- [ ] **Step 4: Record the exact deployed SHA and any unavailable rendered checks**
