# WWP Home Site Runbook

Status: initial single-origin site shell  
Default local port: `43187/TCP`  
Suggested public port: `38443/TCP`

## Current Scope

The initial home process serves the production React build and the WWP API from
one local port. This removes the Vite development server from the deployment
shape and gives the NAS one stable reverse-proxy target.

This checkpoint does not yet provide the Azure login exchange or real
filesystem video cache described in `HOME-SITE-ARCHITECTURE.md`. Its local cache
and member data are intentionally isolated under `.local-data/home-site`.

## Build and Start

From the repository root:

```powershell
npm run home:build
npm run home:start
```

Or build and start in one foreground command:

```powershell
npm run home:serve
```

Local checks:

```text
http://127.0.0.1:43187/
http://127.0.0.1:43187/health
```

The process listens on all local interfaces, so the NAS can reach it at:

```text
http://<home-PC-LAN-IP>:43187
```

## Configuration

Place machine-specific values in the ignored repository `.env`:

```dotenv
WWPDW_HOME_PORT=43187
WWPDW_HOME_PUBLIC_ORIGIN=https://your-ddns-host.example:38443
WWPDW_HOME_DATA_DIR=.local-data/home-site
WWPDW_HOME_CACHE_BACKEND=local
WWPDW_WEB_DIST_DIR=apps/web/dist
```

When `WWPDW_HOME_PUBLIC_ORIGIN` starts with `https://`, the home launcher uses
production secure cookies. The origin must include the explicit public port.

Do not set `VITE_API_BASE_URL` for this build. The browser must use relative
`/api` routes so the web app and API remain same-origin.

## NAS Reverse Proxy

Recommended request path:

```text
browser https://<DDNS>:38443
  -> router TCP 38443
  -> NAS HTTPS reverse proxy
  -> http://<home-PC-LAN-IP>:43187
```

NAS proxy requirements:

- Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
- Allow long-lived responses.
- Do not buffer complete video responses.
- Preserve `Range`, `If-Range`, `Content-Range`, and HTTP `206` responses when
  filesystem playback is added.
- Do not expose the NAS administration application on the same public listener.

Only TCP is required for the initial endpoint. UDP on the public port is
optional and is not needed for HTTP/1.1 or HTTP/2.

## Verification

After each restart:

```powershell
Invoke-WebRequest http://127.0.0.1:43187/ -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:43187/health
Get-NetTCPConnection -LocalPort 43187 -State Listen
```

Expected behavior:

- `/` returns the WWP HTML shell.
- `/assets/*` returns the hashed production assets with immutable cache
  headers.
- a browser route such as `/library/recent` returns the React shell.
- `/health` returns API, local-store, and search-source diagnostics.

## Process Lifetime

The first checkpoint is a normal Node process. It survives terminal closure
when started as a hidden background process, but it is not yet installed as a
Windows auto-start service. Service installation, log rotation, health
restarts, and sleep/power recovery belong to the hardening phase.
