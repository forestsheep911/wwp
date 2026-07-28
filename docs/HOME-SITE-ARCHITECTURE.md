# WWP Home Site Architecture

Status: proposed implementation baseline  
Date: 2026-07-27

## Decision

A home-hosted WWP site is feasible and is a good fit for moving media
preparation, storage, and playback traffic away from Azure.

The production home endpoint must use HTTPS from its first public trial. Keep
Azure as the identity authority, but do not copy passcodes or credential rows
into a second local account database. Run media preparation and playback on the
home machine.

The recommended first production shape is:

```text
family browser
  -> HTTPS home hostname
  -> Caddy on the home machine
       -> web UI
       -> local WWP API
       -> authenticated local media range endpoint

local WWP API
  -> Azure WWP API: login exchange, account status, revocation
  -> local metadata snapshot: browse and search
  -> local job database: preparation state

local worker
  -> source media
  -> partial file on local disk
  -> atomic rename after verification
  -> local media library
```

The cloud site can remain available during the transition. The two sites share
account identity, but their browser cookies remain origin-specific.

## Why Public HTTP Is Not the Baseline

The current session design uses an `HttpOnly` cookie with `SameSite=None` and
uses `Secure` outside development. Browsers require `Secure` cookies to travel
over HTTPS, and `SameSite=None` also requires `Secure`. Disabling that protection
for a public home endpoint would expose session and passcode traffic and would
weaken the existing CSRF boundary.

Localhost development may continue to use HTTP. Internet-facing traffic must
terminate as HTTPS before reaching the app.

## HTTPS Options

### Recommended for direct router forwarding

Use a domain or inexpensive domain plus dynamic DNS, forward TCP 80 and 443 to
Caddy, and let Caddy obtain and renew a publicly trusted ACME certificate.

- Caddy redirects port 80 to 443.
- Caddy serves the built web app and reverse-proxies `/api`.
- The app sees one origin, so cookie and CORS handling become simpler.
- A changing residential IP is handled by the dynamic-DNS updater.

This uses a free publicly trusted certificate. It is not a private root
certificate that must be installed on each family device.

### Viable alternatives

- A Cloudflare Tunnel supplies public HTTPS through an outbound tunnel and does
  not require router forwarding. It is attractive for initial testing and
  hiding the home IP, but routing all video traffic through a third party should
  be evaluated before treating it as the permanent media path.
- A private Tailscale route is the safest simple family-only option when every
  viewing device can install a client. It is less convenient for arbitrary TVs
  and browsers.
- Let's Encrypt now offers short-lived certificates for public IP addresses.
  They require frequent automated renewal and a stable reachable public IP, so
  a hostname remains the more maintainable default.
- A self-signed or locally generated root certificate is suitable only when its
  root is installed on every client. It is not suitable for the general public
  endpoint.

## Account Sharing

### Target model: Azure identity authority with one-time exchange

Do not synchronize credential databases.

1. The home site starts an authentication request with a random state value and
   PKCE-style verifier.
2. The browser authenticates against the Azure WWP origin, reusing an existing
   cloud session when available.
3. Azure creates a one-time, short-lived code bound to the home callback,
   requested audience, state, and verifier challenge.
4. The browser returns the code to the home site.
5. The home API redeems it server-to-server and creates a home-origin session
   cookie.
6. Account revocation and member status remain authoritative in Azure. Home
   sessions are short enough to recheck status regularly, and logout-all
   revokes both audiences.

This gives the user one account without sharing a cookie across unrelated
domains and leaves a clean path to OAuth and MFA later.

### First implementation shortcut

For the first private trial, the home API may submit the entered member pass to
a dedicated Azure login-exchange endpoint over HTTPS and create a local session
from the signed response. This is simpler than the redirect flow, but the final
one-time-code flow is preferred because the home app never needs to handle the
cloud credential directly.

The home machine must not receive an Azure Storage account key. If direct Azure
Table access is temporarily required for development, use a least-privilege
service principal or certificate and treat it as temporary scaffolding, not the
production trust model.

## Local Media Backend

The existing `CACHE_BACKEND=local` implementation is a mock state backend. It
marks jobs ready with `mock://` URLs and does not persist real video bytes.
Therefore, the home site needs a real filesystem media backend rather than a
configuration-only deployment.

Required behavior:

- Store jobs and cache metadata in SQLite, not a JSON file shared by the API and
  worker processes.
- Download to `<asset>.partial` and atomically rename only after validation.
- Keep the existing source resolver and media diagnostics where possible.
- Record content length, content type, MP4 fast-start status, duration, and
  checksum or stable fingerprint.
- Enforce a configurable disk quota and idle-retention policy.
- Serve `GET` and `HEAD` with byte ranges, `206 Partial Content`,
  `Content-Range`, and stable seeking behavior.
- Authorize media through a short-lived signed local playback grant. Never
  expose an unrestricted disk directory.
- Keep concurrency conservative by default: two preparation jobs and a bounded
  number of playback streams.
- Resume interrupted downloads when the source supports ranges.

Preparation that requires remuxing or transcoding can invoke the existing local
ffmpeg workflow, but should be a separate job type from a simple source copy.

## Configuration Boundaries

The current `CACHE_BACKEND` setting selects cache state, access/member data,
sessions, and several indexes together. The home site needs these concerns
split:

```text
WWPDW_MEDIA_BACKEND=filesystem
WWPDW_JOB_BACKEND=sqlite
WWPDW_AUTH_BACKEND=azure-exchange
WWPDW_SEARCH_BACKEND=local-snapshot
WWPDW_CLOUD_API_BASE_URL=https://...
WWPDW_HOME_PUBLIC_ORIGIN=https://...
WWPDW_MEDIA_ROOT=D:\...
WWPDW_MEDIA_MAX_BYTES=...
```

Exact names can change during implementation, but media locality must not force
identity locality.

## Metadata and Browse

Browse and search should not wake Azure on every page load.

- Export the existing Azure/Notion movie index to a versioned local snapshot.
- Import it into local SQLite on a schedule or on an authenticated admin action.
- Use the cloud or Notion only as a fallback for an index miss and for source
  URL refresh before preparation.
- Keep posters in a small local cache.

This makes normal browsing local even when the Azure Container App is asleep.

## Network and Operations Gates

Router port forwarding works only when the home connection has reachable public
IPv4 or usable inbound IPv6. Carrier-grade NAT cannot be solved by router
configuration alone; use a tunnel, request a public IP, or use IPv6.

Before public rollout, verify:

- public IP or IPv6 reachability and whether the address changes;
- ISP inbound-port restrictions;
- sustained upload bandwidth and latency from outside the home network;
- router NAT loopback behavior, or split DNS for devices inside the home;
- Windows firewall scope and a dedicated non-administrator service account;
- automatic startup for Caddy, API, worker, and metadata sync;
- sleep/hibernation behavior and recovery after power/network loss;
- disk capacity, retention, and backup of SQLite/configuration;
- login rate limiting, audit logging, request size/time limits, and admin-route
  protection.

Home upload bandwidth becomes the playback bottleneck. One remote stream must
fit comfortably below sustained upload capacity, with headroom for other home
traffic. Test from a real external mobile connection before declaring a media
profile supported.

## Delivery Plan

### Phase 0: network proof

- Check public IPv4/IPv6 versus carrier-grade NAT.
- Measure external upload throughput.
- Choose a hostname and ingress mode.
- Expose only a health page over HTTPS.

Exit gate: a stable trusted HTTPS URL works from an external phone network.

### Phase 1: local read-only browse

- Run the built React site and local API behind Caddy.
- Add the local metadata snapshot and poster cache.
- Keep preparation and playback disabled.

Exit gate: login, browse, search, restart recovery, desktop, and mobile smoke
tests pass without waking Azure for normal browse.

### Phase 2: shared accounts

- Add the Azure one-time login exchange.
- Create origin-specific home sessions.
- Propagate member disable/revocation and logout-all.
- Restrict home admin functions to MFA or a private network until stronger admin
  authentication is in place.

Exit gate: the same member account works on cloud and home, while cookies and
session secrets are not copied between browsers or domains.

### Phase 3: filesystem preparation and playback

- Add SQLite job state and the filesystem media store.
- Run one local worker.
- Add authenticated byte-range playback and disk retention.
- Test interrupted download, restart, seeking, concurrent reads, and deletion.

Exit gate: one representative large MP4 prepares, survives restart, seeks
correctly, and plays remotely without Azure Blob traffic.

### Phase 4: production hardening

- Install processes as auto-starting services.
- Add structured health checks, free-space alarms, backups, and log rotation.
- Add optional remux/transcode jobs and hardware acceleration.
- Decide whether the Azure media path remains a fallback or is retired.

## Initial Recommendation

Start with a normal hostname, dynamic DNS, Caddy, and direct 443 forwarding if
the connection has a reachable public address. Use Cloudflare Tunnel only for
the Phase 0 proof or when carrier-grade NAT prevents direct ingress. Build the
Azure one-time login exchange before exposing member accounts publicly, and
build a real filesystem cache backend before claiming that the current local
mode can play media.
