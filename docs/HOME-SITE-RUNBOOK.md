# WWP Home Site Runbook

Status: home-hosted production site
Default local port: `43187/TCP`  
Public URL: `https://www888eee.synology.me:38443`

## Current Scope

The home process serves the production React build, WWP API, cache worker, and
Notion metadata synchronizer from one launcher. Member accounts, sessions,
notices, forum data, requests, and credits stay shared through Azure Tables.
The movie search index, TSPDT browse data, posters, video bytes, and cache-job
state are local. Movie metadata is synchronized directly from Notion and does
not use the hosted Azure movie index as an upstream source. Local cache
preparation and playback are free and do not show a charge confirmation;
the Azure site keeps its existing credit rules.

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

If Windows classifies the Ethernet connection as `Public`, open an elevated
PowerShell window once and add a LAN-only inbound rule:

```powershell
New-NetFirewallRule `
  -DisplayName "WWP Home Site 43187 (LAN only)" `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 43187 `
  -RemoteAddress LocalSubnet `
  -Profile Public,Private
```

This permits the NAS to reach the home process without allowing arbitrary
non-local source addresses directly through Windows Firewall.

## Configuration

Place machine-specific values in the ignored repository `.env`:

```dotenv
WWPDW_HOME_PORT=43187
WWPDW_HOME_PUBLIC_ORIGIN=https://www888eee.synology.me:38443
WWPDW_HOME_DATA_DIR=.local-data/home-site
WWPDW_HOME_CACHE_BACKEND=filesystem
WWPDW_MEDIA_ROOT=F:\wwp_storage
WWPDW_MEDIA_MAX_BYTES=1099511627776
WWPDW_MEDIA_MIN_FREE_BYTES=107374182400
WWPDW_MAX_PLAYBACK_STREAMS=8
WWPDW_PLAYBACK_GRANT_MINUTES=360
WWPDW_WEB_DIST_DIR=apps/web/dist
WWPDW_AUTH_BACKEND=azure
WWPDW_SESSION_BACKEND=azure
SEARCH_INDEX_BACKEND=local
TSPDT_BROWSE_BACKEND=local
SEARCH_INDEX_WRITE_THROUGH=false
WWPDW_HOME_NOTION_SYNC_ENABLED=true
WWPDW_HOME_NOTION_SYNC_INTERVAL_MINUTES=30
WWPDW_HOME_NOTION_FULL_SYNC_MIN_ENTRIES=500
SEARCH_INDEX_SYNC_CONCURRENCY=2
```

The launcher forces `WWPDW_CREDIT_BILLING_ENABLED=false` for the home process.
The variable defaults to `true` elsewhere, so the Azure deployment remains
chargeable unless explicitly changed.

When `WWPDW_HOME_PUBLIC_ORIGIN` starts with `https://`, the home launcher uses
production secure cookies. The origin must include the explicit public port.

Do not set `VITE_API_BASE_URL` for this build. The browser must use relative
`/api` routes so the web app and API remain same-origin.

The configured media quota is 1 TiB and the cache refuses a download that
would leave less than 100 GiB free. Ready files expire after the existing idle
retention period and can also be removed from the admin cache screen.

## Azure Account Access

The home process uses the current Windows user's Azure CLI credential. That
user needs these data-plane roles on the WWP storage account:

```text
Storage Table Data Contributor
Storage Blob Data Reader
```

Table access keeps members, sessions, invitations, credits, notices, forum
threads, movie requests, and audit records common with the hosted site. Movie
metadata is not read from Azure Tables. Video bytes and the local poster cache
stay on `F:\wwp_storage`.

Run `az login` again if the user credential is explicitly revoked or the Azure
CLI cache is removed. No storage account key is stored in `.env`.

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
  local media playback is streamed.
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
- `/health` reports the filesystem media root, local movie index, and Azure
  access/session stores.
- `/api/playback/<asset-key>` issues a session-bound, expiring playback grant.
- `/api/media/<asset-key>?grant=...` supports authenticated byte ranges.
- `/api/posters/<poster-key>` serves the local poster cache.
- At most four media streams run concurrently by default.

## Automatic Startup

Install a per-user scheduled task:

```powershell
pwsh -File tools/manage-home-site-task.ps1 install
pwsh -File tools/manage-home-site-task.ps1 start
pwsh -File tools/manage-home-site-task.ps1 status
```

The task starts after the current Windows user signs in, because Azure CLI
credentials are stored in that user's profile. It restarts the process up to
five times after failure, starts missed runs when available, and does not stop
when switching to battery power. Logs are written to:

```text
.local-data/home-site.stdout.log
.local-data/home-site.stderr.log
```

Each log rotates to a single `.1` archive before a new process starts if it
has reached 20 MB.

The Notion movie library is synchronized into
`.local-data/home-site/search-index.json`. The launcher starts an incremental
sync immediately and repeats it every 30 minutes. If the local index contains
fewer than 500 entries, it performs a full rebuild first.

Run an incremental sync manually with:

```powershell
npm run home:sync-index
```

Run a complete Notion rebuild after a large catalog or schema change with:

```powershell
npm run home:sync-index -- full
```

Normal browse and search read the local index immediately. Synchronization
downloads posters into the local filesystem cache and updates the local TSPDT
browse projection after a successful run.

To stop or remove the task:

```powershell
pwsh -File tools/manage-home-site-task.ps1 stop
pwsh -File tools/manage-home-site-task.ps1 uninstall
```
