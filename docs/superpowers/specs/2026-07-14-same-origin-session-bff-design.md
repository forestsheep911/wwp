# Same-Origin Session BFF Design

## Context

WWP currently serves the web application from Azure Static Web Apps and the API from an Azure Container Apps domain. The API issues an `HttpOnly`, `Secure`, `SameSite=None` session cookie. Desktop browsers can accept that cross-site cookie, but iOS WebKit can reject or withhold it as a third-party cookie. The observed result is a successful login response followed immediately by authenticated requests returning `401`, which appears to the user as a repeated login redirect.

The site does not yet have a custom domain. The solution must preserve the existing revocable server-side sessions, CSRF protection, session expiry, and device/session management without returning to browser-stored passcodes or access tokens.

## Decision

Add a same-origin Backend for Frontend (BFF) to the existing Static Web Apps managed Functions API. Production browsers will call the Static Web Apps origin for all `/api/*` traffic. The BFF will forward those requests to the Container Apps API and return the upstream response.

The browser-facing session cookie will therefore be a first-party cookie on the Static Web Apps host. The BFF will rewrite the upstream cookie's `SameSite=None` attribute to `SameSite=Lax` while preserving `HttpOnly`, `Secure`, expiry, path, and deletion semantics.

This is preferred over an auth-only proxy because all authenticated requests must carry the same session cookie. A custom app/API domain pair remains a compatible future replacement when a custom domain is available.

## Architecture and Boundaries

### Browser client

- In production, the web bundle uses a relative API base and sends requests to its own origin.
- Local development may continue to use `VITE_API_BASE_URL` or the Vite development proxy.
- The health/wake request moves from `/health` to the same-origin BFF route `/api/health`.
- Existing `credentials: "include"` and CSRF-header behavior remain in place.

### Static Web Apps BFF

- A catch-all HTTP function accepts the supported paths below the Static Web Apps `/api/` prefix.
- A request for `/api/auth/login` is forwarded to the Container Apps `/api/auth/login` path.
- A request for `/api/health` is forwarded to the Container Apps `/health` path.
- The upstream base URL comes only from a trusted Static Web Apps application setting. User input cannot select a host, so the function cannot become an open proxy.
- The BFF forwards the HTTP method, query string, request body, cookie, content type, request ID, range headers where applicable, and `x-wwpdw-csrf-token`.
- Authenticated state-changing requests use the configured public web origin as their upstream `Origin`, allowing the API's existing origin and CSRF checks to continue working reliably.
- The BFF returns the upstream status, body, content type, cache metadata, request ID, and session cookie. It preserves binary response bodies rather than parsing every response as JSON.
- Hop-by-hop headers, arbitrary authorization headers, host headers, and upstream CORS headers are not forwarded.
- Logs may include method, normalized path, status, duration, and request ID, but never request bodies, passcodes, cookies, CSRF tokens, or session values.

### Container Apps API

The API remains the only component that authenticates passcodes, creates and validates sessions, enforces CSRF, manages expiry and revocation, and performs application operations. The BFF does not duplicate authentication logic and stores no session state.

The existing `home-browse` managed Function is removed because it implements the obsolete browser access-key scheme and would create a second, conflicting authorization path.

## Request and Session Flow

1. The browser posts a passcode to same-origin `/api/auth/login`.
2. The BFF forwards the request to the Container Apps API.
3. The API validates the passcode, creates a revocable session, and returns the CSRF token plus `Set-Cookie`.
4. The BFF rewrites only the cookie's SameSite attribute and returns it from the Static Web Apps origin.
5. The browser stores the cookie as a first-party, `HttpOnly`, `Secure`, `SameSite=Lax` cookie.
6. Later same-origin `/api/*` requests automatically include the cookie. The BFF forwards it to the API.
7. State-changing requests also include the CSRF header kept in frontend memory. The API continues to validate both the trusted origin and CSRF token.
8. Logout or current-session revocation propagates the upstream cookie-deletion header through the BFF, clearing the first-party cookie.

Refreshing a page therefore retains the server session without exposing the session secret to JavaScript. Closing tabs does not end the session; explicit logout, revocation, idle expiry, or absolute expiry does.

## Failure Handling

- Missing or invalid BFF configuration fails closed with a `503` response.
- Unsupported methods or invalid paths are rejected without contacting the upstream API.
- Upstream connection failures and timeouts return a stable `502` or `504` response and a request ID suitable for correlating sanitized logs.
- API status codes such as `400`, `401`, `403`, `409`, and `429` pass through unchanged so existing frontend behavior remains meaningful.
- The health route uses a short timeout and does not initiate authentication or open a login/wake dialog by itself.
- The proxy must not convert an upstream authentication failure into a login success or silently retry non-idempotent requests.

## Deployment

The Static Web Apps deployment script will:

- set the trusted upstream API base URL for the managed Function;
- set the public Static Web Apps origin used when forwarding authenticated unsafe requests;
- build production web assets without embedding the cross-site Container Apps URL; and
- deploy the web assets and managed Functions together.

The API may retain its existing allowed-origin configuration during the transition. After the BFF deployment is verified, browser traffic should no longer call the Container Apps hostname directly.

## Testing and Acceptance Criteria

Automated tests will cover:

- path and query mapping, including the health-route exception;
- forwarding request bodies, cookies, request IDs, range headers, and CSRF headers;
- fixed upstream origin behavior and prevention of arbitrary proxy targets;
- response status and binary-body preservation;
- session-cookie rewriting for login, renewal, logout, and revocation;
- upstream timeout and failure responses without secret leakage; and
- production frontend URL construction using same-origin API paths.

Deployment verification will cover a clean browser session and the sequence:

1. Open the production site and remain on the login screen until the user submits.
2. Log in once and load the initial home view without an extended empty skeleton.
3. Refresh and remain authenticated without flashing or redirecting through login.
4. Navigate through authenticated views and session management.
5. Log out and confirm the next authenticated request is rejected.
6. Repeat the login and refresh checks on iOS Safari or another iOS WebKit browser.

Success means production network requests use the Static Web Apps origin, the session cookie is first-party, the API continues to enforce server-side sessions and CSRF, and the previously observed mobile login loop no longer occurs.

## Out of Scope

- Custom domains and reverse-proxy DNS changes.
- OAuth, passkeys, or MFA enrollment.
- Changing session expiry policy or the device/session management model.
- Replacing the Container Apps API or moving business logic into managed Functions.
