# WWPDW Architecture Check

Last reviewed: 2026-07-02

## Current Shape

The repository has a clear product split:

- `apps/web`: React/Vite private family cinema UI.
- `apps/api`: Node HTTP API for auth, search, cache orchestration, playback, admin, forum, notices, and movie requests.
- `apps/worker`: background cache worker and cleanup modes.
- `packages/cache-store`: local/Azure persistence adapters.
- `packages/shared`: cross-app DTOs, validation helpers, and logging helpers.
- `infra`: Azure provisioning and deployment scripts.

This shape is still sound. The main scaling risk is not package layout; it is a few files carrying too many unrelated responsibilities.

## Changes From This Check

- Extracted web route parsing/history helpers into `apps/web/src/cinema/routing.ts`.
- Extracted direct-download browser mechanics into `apps/web/src/cinema/download.ts`.
- Added shared Radix-backed `Accordion` and `DropdownMenu` UI wrappers.
- Replaced the Help FAQ hand-rolled disclosure logic with `Accordion`.
- Replaced the account menu hand-rolled outside-click/Escape/state handling with `DropdownMenu`.

These changes make future tab/deep-link changes, browser download changes, and menu/FAQ styling changes less likely to require editing the main app shell.

## Frontend Boundaries

`apps/web/src/App.tsx` is still the largest frontend coordination point. It now delegates more generic mechanics, but it still owns several state domains:

- session/auth/member profile
- routing and active tab coordination
- library search/browse/cache result state
- playback and history
- cache task polling
- member notices, movie requests, and forum state
- admin member/cache/job/audit state

Next worthwhile frontend split:

1. `useCinemaSession`: access key, role, member, lock/unlock, profile save.
2. `useCinemaRoute`: active tab/channel/query/player route writes and popstate.
3. `useCacheTasks`: tracked items, polling, job/asset refresh.
4. `useMemberInbox`: notices, movie requests, credit usage.
5. `useAdminData`: admin unlock and admin-only tables/actions.

Do this one state domain at a time. Avoid a broad "move everything into context" pass until the hook boundaries above are real and tested.

## Backend Boundaries

`apps/api/src/server.ts` is the highest-risk growth point. It mixes:

- HTTP transport helpers and CORS response formatting
- request context/logging/auth guards
- route matching
- member auth/profile/invitations
- credit accounting and preview
- search/index/cache/playback orchestration
- forum, notices, and movie request handlers
- admin handlers

Next worthwhile backend split:

1. Extract transport primitives: `http.ts` for `sendJson`, body parsing, request id, request context, and guard helpers.
2. Extract route registration: a tiny internal router with `method`, `pattern`, `guard`, and handler entries. Keep behavior equivalent; do not adopt a framework just for routing yet.
3. Move domains behind modules: `member-routes.ts`, `admin-routes.ts`, `media-routes.ts`, `forum-routes.ts`.
4. Keep store creation and runtime config centralized so tests can later inject local stores without loading Azure config.

The API should not be split by endpoint count alone. Split when a domain can own its validation, logging names, and store calls without reaching into another domain's local variables.

## UI Component Policy

Prefer the existing Radix/shadcn-style wrappers for interactive controls:

- tabs, dialog, progress, label, input, button, badge
- accordion for collapsible FAQ or detail rows
- dropdown menu for account/action menus

Hand-rolled components are still fine for static cards, grids, and domain-specific media cards. Avoid hand-rolling focus traps, outside-click dismissal, keyboard menu navigation, or accordion semantics.

## Verification Expectations

For future changes touching these boundaries, run:

```powershell
npm run typecheck
npm run build
```

For UI changes, start the local site and capture at least desktop and mobile screenshots of the changed surface before deployment.
