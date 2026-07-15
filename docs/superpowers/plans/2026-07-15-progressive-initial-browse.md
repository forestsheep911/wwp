# Progressive Initial Browse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the first 12 ordinary browse results without waiting for the current 100- or 300-result payload, then continue loading the catalog in the background.

**Architecture:** Put all initial and append request-size defaults in one pure browse-load policy module. `CinemaApp` will use that policy whenever `refreshBrowseAssets` has no explicit override, while `LibraryTab` will share the same initial visible-count and append-size constants so the requested and rendered page sizes cannot drift apart.

**Tech Stack:** React 19, TypeScript, Node test runner through TSX, Vite, Azure Static Web Apps BFF, Azure Container Apps API.

## Global Constraints

- Every ordinary paged browse view requests exactly 12 results initially.
- `lucky` remains a 48-result random request.
- TSPDT remains a 2,000-result special paged request.
- Background append requests remain 100 results.
- Existing HttpOnly Cookie sessions, CSRF handling, API routing, IndexedDB 250 ms deadline, and stale-response rejection remain unchanged.
- `popular` and `mostWatched` may reorder visible cards while background pages complete their history-aware ranking.
- No new dependency and no new production setting.

---

### Task 1: Centralize and apply progressive browse request defaults

**Files:**
- Create: `apps/web/src/cinema/browse-load-policy.ts`
- Create: `apps/web/test/browse-load-policy.test.ts`
- Modify: `apps/web/src/App.tsx:119-160,448-485,1082-1090,2315-2324`
- Modify: `apps/web/src/cinema/components/LibraryTab.tsx:1-20,358-361,474-476`

**Interfaces:**
- Consumes: `BrowseViewId` from `apps/web/src/cinema/types.ts`.
- Produces: `BrowseLoadMode`, `browseInitialVisibleCount`, `browseAppendPageLimit`, `browseTspdtCatalogLimit`, and `browseRequestDefaults(view, append)`.

- [ ] **Step 1: Write the failing request-policy tests**

Create `apps/web/test/browse-load-policy.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  browseAppendPageLimit,
  browseInitialVisibleCount,
  browseRequestDefaults,
  browseTspdtCatalogLimit
} from "../src/cinema/browse-load-policy";

test("ordinary browse routes request only the visible first shelf", () => {
  assert.equal(browseInitialVisibleCount, 12);
  for (const view of ["newGood", "recent", "popular", "topRated", "mostWatched", "doubanRank", "imdbRank", "rottenRank"] as const) {
    assert.deepEqual(browseRequestDefaults(view, false), { mode: "paged", limit: 12 });
  }
});

test("append requests retain the larger background page", () => {
  assert.equal(browseAppendPageLimit, 100);
  assert.deepEqual(browseRequestDefaults("newGood", true), { mode: "paged", limit: 100 });
  assert.deepEqual(browseRequestDefaults("popular", true), { mode: "paged", limit: 100 });
});

test("lucky and TSPDT retain their special initial request sizes", () => {
  assert.equal(browseTspdtCatalogLimit, 2_000);
  assert.deepEqual(browseRequestDefaults("lucky", false), { mode: "random", limit: 48 });
  assert.deepEqual(browseRequestDefaults("tspdtRank", false), { mode: "paged", limit: 2_000 });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npx tsx --test apps/web/test/browse-load-policy.test.ts
```

Expected: FAIL because `../src/cinema/browse-load-policy` does not exist.

- [ ] **Step 3: Implement the minimal shared policy**

Create `apps/web/src/cinema/browse-load-policy.ts`:

```ts
import type { BrowseViewId } from "./types";

export type BrowseLoadMode = "paged" | "random";

export const browseInitialVisibleCount = 12;
export const browseAppendPageLimit = 100;
export const browseLuckyPageLimit = 48;
export const browseTspdtCatalogLimit = 2_000;

export function browseRequestDefaults(view: BrowseViewId, append: boolean): {
  mode: BrowseLoadMode;
  limit: number;
} {
  if (append) {
    return { mode: "paged", limit: browseAppendPageLimit };
  }
  if (view === "lucky") {
    return { mode: "random", limit: browseLuckyPageLimit };
  }
  if (view === "tspdtRank") {
    return { mode: "paged", limit: browseTspdtCatalogLimit };
  }
  return { mode: "paged", limit: browseInitialVisibleCount };
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```powershell
npx tsx --test apps/web/test/browse-load-policy.test.ts
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 5: Wire `CinemaApp` to the shared defaults**

In `apps/web/src/App.tsx`, import the shared policy and type:

```ts
import {
  browseRequestDefaults,
  type BrowseLoadMode
} from "./cinema/browse-load-policy";
```

Remove the local `browsePageLimit`, `browseCatalogPageLimit`, `browseFullViewLimit`, `tspdtBrowseCatalogLimit`, local `BrowseLoadMode`, `browseLoadModeForView`, and `browseLimitForView` definitions.

At the beginning of `refreshBrowseAssets`, replace the local mode and limit defaults with:

```ts
const append = options.append === true;
const requestView = options.view ?? browseView;
const defaults = browseRequestDefaults(requestView, append);
const mode = options.mode ?? defaults.mode;
const limit = options.limit ?? defaults.limit;
```

Make `openBrowseView` rely on the shared defaults instead of restating them:

```ts
void refreshBrowseAssets({
  view: nextView,
  force: options.refresh === true
});
```

Make the post-login library effect rely on the same defaults:

```ts
void refreshBrowseAssets({ view: browseView });
```

Keep explicit 100-result watchlist loads unchanged because they are not ordinary first-shelf navigation.

- [ ] **Step 6: Share render and append constants with `LibraryTab`**

In `apps/web/src/cinema/components/LibraryTab.tsx`, import:

```ts
import {
  browseAppendPageLimit,
  browseInitialVisibleCount,
  browseTspdtCatalogLimit
} from "../browse-load-policy";
```

Remove the local `browseInitialCount` and `tspdtBrowseCatalogLimit` declarations. Replace all `browseInitialCount` references with `browseInitialVisibleCount`, and replace the ordinary `100` in `browseRequestLimit` with `browseAppendPageLimit`:

```ts
const browseRequestLimit = showingTspdtRank ? browseTspdtCatalogLimit : browseAppendPageLimit;
```

- [ ] **Step 7: Verify the focused behavior and web build**

Run:

```powershell
npx tsx --test apps/web/test/browse-load-policy.test.ts apps/web/test/browse-cache.test.ts apps/web/test/browse-state.test.ts
npm run typecheck --workspace @wwpdw/web
npm run build --workspace @wwpdw/web
git diff --check
```

Expected: all focused tests pass, TypeScript exits 0, Vite exits 0, and `git diff --check` has no output. The existing Vite large-chunk warning is allowed.

- [ ] **Step 8: Commit the source change**

```powershell
git add -- apps/web/src/cinema/browse-load-policy.ts apps/web/test/browse-load-policy.test.ts apps/web/src/App.tsx apps/web/src/cinema/components/LibraryTab.tsx
git commit -m "fix: render the first browse shelf progressively"
```

---

### Task 2: Verify, deploy, and measure the production first shelf

**Files:**
- Create: `.superpowers/progressive-browse-acceptance.md` (ignored local report; do not commit)
- Deploy from: `infra/deploy-web-staticapp.ps1`

**Interfaces:**
- Consumes: committed Task 1 behavior and the existing production Static Web Apps deployment script.
- Produces: a deployed web/BFF build plus secret-safe timing and lifecycle evidence.

- [ ] **Step 1: Run the full local verification gate**

Run:

```powershell
npm test --prefix api
npx tsx --test apps/web/test/*.test.ts apps/api/src/*.test.ts
node --test infra/deploy-web-staticapp.test.mjs
npm run typecheck
npm run build
git diff --check
git status --short
```

Expected: API tests pass, all TSX tests including the 3 new policy tests pass, 5 deployment contract tests pass, all three workspaces type-check and build, diff check is empty, and the worktree is clean.

- [ ] **Step 2: Deploy the exact clean HEAD**

Run:

```powershell
git rev-parse --short HEAD
.\infra\deploy-web-staticapp.ps1
```

Expected: the deployment exits 0 after building and publishing the web app and BFF. Record the exact HEAD before deployment.

- [ ] **Step 3: Confirm the production settings boundary**

Run the existing Azure settings-name query and confirm the output contains exactly:

```text
WWPDW_BFF_TIMEOUT_MS
WWPDW_ORIGIN_API_BASE_URL
WWPDW_PUBLIC_WEB_ORIGIN
```

Do not print setting values, passcodes, cookies, or CSRF tokens.

- [ ] **Step 4: Run a secret-safe production lifecycle and first-page timing**

Create a temporary diagnostic session through `/api/auth/login`, retain its Cookie only in memory, request both of these paths, and immediately call `/api/auth/logout` in `finally`:

```text
/api/browse-assets?mode=paged&channel=recommended&view=newGood&offset=0&limit=12
/api/browse-assets?mode=paged&channel=recommended&view=popular&offset=0&limit=12
```

Record only login/browse/logout statuses, durations, response byte counts, and Cookie flag booleans. Expected: lifecycle `200/200/200/200`, each browse payload is materially smaller than the prior 2.36 MB/7.12 MB responses, login Cookie is `HttpOnly + Secure + SameSite=Lax`, and logout carries `Max-Age=0`.

- [ ] **Step 5: Verify rendered behavior where browser access permits**

Use the in-app browser against `https://gentle-rock-049daed00.7.azurestaticapps.net`. After a clean login, verify the first ordinary shelf reaches visible cards without selecting another browse tab, then select `popular` and confirm its first cards appear before background pages finish. Do not expose the passcode or session data. If the in-app browser cannot present an authenticated session, record rendered desktop/mobile acceptance as pending user confirmation rather than claiming it passed.

- [ ] **Step 6: Report remaining concerns**

Report the exact deployed commit, test counts, first-page timings and sizes, any transient Azure failures, the existing Vite chunk warning, and whether mobile user acceptance remains pending. Do not create another commit unless deployment evidence requires a tracked source change.
