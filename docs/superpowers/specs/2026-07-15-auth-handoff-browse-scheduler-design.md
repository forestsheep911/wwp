# Authentication Handoff Browse Scheduler

## Problem

After a manual login, the initial library screen can remain empty until the user changes a browse tab. Production logs show that the login succeeds but no initial `browse-assets` request reaches the API; a later tab change sends a normal successful `limit=12` request.

The current flow splits responsibility between the auth transition, a library `useEffect`, `browseRouteLoadRef`, request state, cache reads, and pagination effects. In particular, `lockCinema()` cleared browse results but left `browseRouteLoadRef` intact. A subsequent login in the same SPA therefore treated `recommended:newGood` as already scheduled, while changing a tab supplied a new key and made the list appear. The route ref can also be marked independently of an accepted request, leaving no retry path when the auth-to-library effect is skipped.

## Decision

Create one browse-route scheduler with this contract:

- Inputs are the authenticated route (`tab`, channel, view, and query) and an optional forced refresh.
- It returns without loading only when the route is not a blank library browse route.
- It delegates request admission to the existing synchronous browse request state.
- It records a route as scheduled only after a non-append request is accepted.
- Manual login, session restoration, route initialization, and browse channel/view changes use this scheduler instead of independently mutating the route-load ref and calling the fetcher.
- Logout and an unauthorized response clear route admission so the next authenticated handoff can load the initial route.
- The existing cache, stale-response, and pagination rules remain downstream of an accepted initial request.

## Rejected alternatives

1. Invoke `refreshBrowseAssets` only in the manual-login callback. This does not cover session restoration or later route initialization.
2. Add timer-based retries. This hides the missing handoff edge, can duplicate requests, and makes cold-start behavior less predictable.

## Error handling

- A rejected duplicate request does not mark the route as scheduled.
- A failed accepted request clears loading as today and leaves the route eligible for an explicit future retry.
- An unauthorized request retains the current logout behavior and clears route admission.

## Tests and acceptance

- A regression test proves the authenticated library handoff schedules `newGood` with `offset=0` and `limit=12`.
- A test proves a route is not marked loaded before the request state admits it.
- Existing request-state tests continue to cover cache waits, stale requests, append, and observer retries.
- Local and production validation confirm the first browse request is present after login; rendered desktop and mobile confirmation remains required when the in-app browser is available.

## Scope

This changes only the web browse scheduling path. It does not alter API endpoints, Cookie/session handling, BFF configuration, cache formats, or pagination policy values.
