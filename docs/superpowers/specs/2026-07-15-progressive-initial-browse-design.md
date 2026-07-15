# Progressive Initial Browse Design

Date: 2026-07-15  
Status: Approved

## Problem

The library renders only 12 cards initially, but the first request currently fetches 100 rich results for ordinary views and 300 results for `popular` and `mostWatched`. Production measurements showed approximately 2.36 MB for 100 results and 7.12 MB for 300 results. The 300-result path took 13.8 seconds in a warm diagnostic session and 19.6 seconds inside the API during the reported cold path. No cards can render until the complete JSON response arrives.

Changing the selected browse tab starts a different request, which makes the delayed result look like a tab-state problem. The authentication and same-origin session remain valid throughout.

## Goals

- Show a useful first shelf without requiring a browse-tab switch.
- Make the first ordinary browse response contain only the 12 results the UI can initially display.
- Continue filling the catalog in the background with the existing pagination behavior.
- Preserve session security, routing, caching, stale-response protection, and browse-view semantics.

## Non-goals

- Do not redesign the cards or loading skeleton.
- Do not introduce a second compact browse API.
- Do not change the special one-shot `lucky` batch or the static TSPDT catalog in this fix.
- Do not change server-side authentication or BFF behavior.

## Chosen Design

Extract the initial request-size decision into a small, testable browse-load policy. Every ordinary paged browse view, including `newGood`, `recent`, `popular`, `topRated`, `mostWatched`, and the rating views, requests 12 results initially. `lucky` keeps its existing random batch of 48, and TSPDT keeps its existing special catalog limit.

After the first 12 results arrive, `LibraryTab` renders them immediately. Existing intersection and full-view effects may then request subsequent 100-result pages. For `popular` and `mostWatched`, background pages can cause a small ordering adjustment while the client completes its history-aware ranking; this trade-off is explicitly accepted in preference to a blank shelf.

The initial request policy must be used both after login and when opening a new channel or browse view. Append requests remain separate and must not enlarge the initial response again.

## Error and Race Handling

- Existing request IDs continue to reject responses from an obsolete channel or view.
- A failed background page must not remove the already displayed first 12 results.
- Existing error messages and loading indicators remain in use.
- IndexedDB reads retain their 250 ms deadline and may still provide an immediate cached shelf before the network response.

## Testing

- Add a failing policy test proving ordinary views, especially `newGood`, `popular`, and `mostWatched`, use an initial limit of 12.
- Prove `lucky` and TSPDT retain their existing special limits.
- Verify the application uses the shared policy for automatic login loads and explicit view changes.
- Run the complete web/API tests, deployment contract tests, type checks, and production builds.

## Production Acceptance

- A clean login starts the ordinary browse request with `limit=12`.
- The first shelf displays without switching browse tabs.
- Later pages load in the background and preserve correct cards and navigation.
- Refresh remains logged in, and logout still invalidates the session.
- Validate both desktop and mobile behavior; record first-response timing and payload size without exposing session data.
