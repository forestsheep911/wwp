# Cross-Origin Session Security Design

## Goal

Replace browser-persisted access passcodes with revocable server-side sessions
while preserving login across closed tabs. The present Azure Static Web App and
Container App deployment remains on separate origins; a custom domain is not a
prerequisite.

## Scope

- The API authenticates an opaque, random session identifier held only in a
  `HttpOnly`, `Secure`, `SameSite=None` cookie.
- The cookie is accepted only through credentialed requests from configured
  first-party web origins. Wildcard CORS is removed for authenticated API
  routes.
- A synchronizer CSRF token is returned by the authenticated session endpoint
  and must accompany every unsafe request in `x-wwpdw-csrf-token`.
- Sessions have an idle expiry, an absolute expiry, a bounded rolling renewal,
  device metadata, per-session logout, and all-sessions logout.
- Password/passcode changes revoke all member sessions. Administrative reset
  revokes the affected member's sessions.
- Members can review and terminate their own sessions. Administrators can
  review and revoke all non-administrator sessions; administrator sessions are
  separately manageable by the administrator who created them.
- Existing member identities, invitations, credits, audit records, and APIs
  remain intact. Existing localStorage and old access-key header authentication
  is removed rather than retained as a silent fallback.

## Non-goals

- OAuth provider configuration, email delivery, hardware keys, and MFA
  enrollment are not enabled in this change. The account and session records
  will carry `authProvider` and `mfaVerifiedAt` extension fields so those flows
  can issue exactly the same session type later.
- A custom domain / reverse proxy is not required. When one is added later the
  deployment should change cookie `SameSite` to `Lax` (or `Strict` after
  validating navigation flows) without changing the session data model.

## Architecture

### Session record

Create a separate `sessions` partition in the existing Access Store / Azure
Table. A record contains a random 32-byte session secret *hash* (never the raw
secret), a public session id, account subject (`admin` or member id), creation,
last-seen, idle expiry, absolute expiry, revocation metadata, device label, IP
address and user agent. The cookie value is `sessionId.secret`; lookup first
uses the public id and then timing-safe compares the stored secret hash.

Session defaults are configured by environment variables: 30-day idle period,
90-day absolute period, and 24-hour renewal threshold. A request that falls
within the renewal threshold extends the idle deadline only up to the absolute
deadline. Revoked and expired records never authenticate.

### Login and authentication

`POST /api/auth/login` takes the passcode in its JSON body, resolves the
account, creates a session and replies with the cookie plus a minimal auth
payload. Registration and successful passcode-reset also create sessions. API
authentication reads only the session cookie.

`GET /api/auth/check` validates the session, returns the identity and CSRF
token, and may renew the cookie. It records login activity only once when a
new session is created, rather than on each page refresh.

`POST /api/auth/logout` revokes the current session and clears its cookie.
`GET /api/auth/sessions` lists the current subject's sessions; `DELETE
/api/auth/sessions/:id` revokes a selected session; `POST
/api/auth/logout-all` revokes all sessions for the subject except optionally
the current session. Member passcode change and admin reset use full subject
revocation.

### Cross-origin and CSRF controls

The API reads a comma-separated `WWPDW_ALLOWED_WEB_ORIGINS` allowlist. For an
allowed request it sets `Access-Control-Allow-Origin` to the exact `Origin`,
sets `Access-Control-Allow-Credentials: true`, and varies by Origin. Requests
from other origins receive no credentialed CORS headers. The frontend sends
`credentials: "include"` on every API request.

Unsafe methods require a valid Origin allowlist match and the per-session CSRF
secret from `x-wwpdw-csrf-token`. `GET`, `HEAD`, and `OPTIONS` do not require a
CSRF token. Since the web and API origins are cross-site, the cookie uses
`SameSite=None; Secure`; local HTTP development uses a non-Secure cookie only
when `NODE_ENV=development` and an explicitly configured local origin is in
the allowlist.

### Client migration and UI

Delete access-key storage and the custom access-key header. On initial load the
web application calls `checkAccess`; a valid persistent cookie restores the
session even after all tabs were closed. On 401 it presents the existing access
gate. The existing logout action calls the logout endpoint before clearing
local UI identity.

The member profile shows a "signed-in devices" panel containing device, IP
location, last active time, current-session state, and an action to revoke a
device. The admin panel exposes the corresponding audit view and session
revocation control. User-visible copy explains that changing a passcode signs
out all devices.

### Forward compatibility

The session subject is modeled independently of the credential used to create
it. `authProvider` values (`passcode`, `oauth`) and optional MFA verification
time are stored as extensible fields. Future OAuth callbacks and MFA challenge
completion will validate their factors and then call the same `createSession`
function; no front-end bearer-token migration is needed.

## Error handling and migration

- Missing/invalid/expired/revoked session: `401`, cookie cleared when present.
- Cross-origin unsafe request without an allowed Origin or CSRF token: `403`.
- Session storage failure during login: no cookie is sent and the request
  returns `503`.
- A deployment configuration with no allowed web origin fails closed for
  browser credentialed access; health remains available without credentials.
- On rollout, all legacy localStorage passcodes are removed from the web app.
  Users sign in once with their passcode; no plaintext credentials are migrated
  or retained.

## Verification

Tests must demonstrate: raw passcodes are neither stored nor sent after login;
session cookies authenticate after a simulated tab close; unlisted origins do
not receive credentialed CORS; unsafe requests fail without CSRF; expiry and
revocation fail authentication; passcode change invalidates prior sessions;
the current-session logout clears browser access; and device-list authorization
does not leak one member's sessions to another.

Run the API unit/integration suite, web tests, TypeScript builds, and a local
credentialed browser/API smoke test. The deployment scripts must pass a
concrete Static Web App origin to `WWPDW_ALLOWED_WEB_ORIGINS` and document the
required environment settings.
