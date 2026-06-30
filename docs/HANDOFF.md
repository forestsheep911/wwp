# WWPDW Web Cache Handoff

This document captures the current web-cache MVP so a future maintainer does not need the chat history.

## Current State

The cloud path has been proven end to end:

1. The Static Web App loads the thin web UI.
2. The user enters the private access key.
3. The API searches the scoped Notion library.
4. The user chooses a media variant/spec under a film entry.
5. The API queues a cache job and starts the Container Apps Job worker when no
   active cache job is already running.
6. The worker streams the resolved media URL into private Azure Blob Storage
   with SDK-managed block upload and byte-based progress.
7. The worker records media diagnostics for the ready asset.
8. The API returns a short-lived SAS playback URL with diagnostics metadata.
9. The browser plays the cached Blob video.

The Admin tab now includes household Cinema Pass management plus a recent cache
jobs view. Each pass is bound to a member name, but family members still sign in
with only the pass string. Passes carry a simple 🍀 balance that admins set when
creating the pass and can update later. The cache job view shows worker status, progress, job id,
asset key, latest request id, blob diagnostics, size, range support, and MP4
faststart status.

Known successful playback example:

- `Albert Nobbs (2011)` variant around 1.59 GB

## Azure Resources

Current development resource names:

- Resource group: `rg-ww-player-cache-dev`
- Static Web App: `stapp-ww-player-dev`
- API Container App: `ca-ww-player-api`
- Worker job: `job-ww-cache-worker`
- Cleanup job: `job-ww-cache-cleanup`
- Container Apps environment: `cae-ww-player-cache-dev`
- Storage account: `stwwcachee9219db7`
- Blob container: `cached-videos`
- Storage queue: `cache-jobs`
- Asset table: `cacheindex`
- Job table: `cachejobs`
- ACR: `acrwwcachee9219db7`
- Key Vault: `kv-wwcache-e9219db7`
- User-assigned managed identity: `id-ww-player-cache-dev`

Current public entry points:

- Web: `https://gentle-rock-049daed00.7.azurestaticapps.net`
- API: `https://ca-ww-player-api.kindplant-e2681add.eastasia.azurecontainerapps.io`

Do not store or print secrets in this repository. Runtime secrets live in Key Vault.

## Secrets

Expected Key Vault secrets:

- `NOTION-READ-ONLY-TOKEN`: read-only Notion integration token
- `WWPDW-ACCESS-KEY`: private family access key checked by the API

Container environment variables:

- API receives `NOTION_READ_ONLY_TOKEN` from `NOTION-READ-ONLY-TOKEN`
- API receives `WWPDW_ACCESS_KEY` from `WWPDW-ACCESS-KEY`
- API and worker use managed identity for Azure Storage and Azure Resource Manager

The frontend only stores the user-entered access key in browser `sessionStorage`.

## Member Allowances

External UI copy should call user keys `Cinema Passes` rather than access keys.
The API still uses `x-wwpdw-access-key` internally.

Default pass allowance settings:

- `MEMBER_DEFAULT_CREDITS=20`
- `MEMBER_CACHE_CREDIT_COST=1`

Search, playback, cache hits, and joining an already-running cache job are free.
Creating a new cache job with a member pass spends `MEMBER_CACHE_CREDIT_COST`
🍀. Admin keys bypass member allowance checks. A member request that exceeds the
remaining balance returns HTTP 429 before it creates a cache job.

Current accounting is stored on the member pass row in the `membercodes` table.
That is intentionally simple for a family-scale system. If usage grows, split
credit events into a separate ledger table with optimistic concurrency.

## Cache Retention

Ready cached videos track both `cachedAt` and `lastPlayedAt`. The playback API
refreshes `lastPlayedAt` whenever it issues a playback URL.

The cleanup job deletes Blob media and cache state when either condition is met:

- `expiresAt` has passed.
- The video has not been played for `CACHE_ASSET_IDLE_TTL_DAYS` days. The
  default is 7 days; never-played videos use `cachedAt` as the idle reference.

Azure Storage may also have a coarse lifecycle rule as a safety net, but the
application-level cleanup job is authoritative because it updates Table state and
deletes the matching cache job record.

## Data Flow

Notion search is intentionally library-scoped:

```text
root Notion page
  -> one direct child database
    -> direct database entries are film entries
      -> direct child pages are media variants/specs
        -> file/url/embed/bookmark/rich-text links are candidate media URLs
```

This avoids broad Notion page search. If a film entry is not a direct database entry under the configured library database, the web app should treat it as missing for now.

Current search behavior:

- First tries a Notion data-source title `contains` query when the title
  property is known.
- If that has no result, tries short CJK title segments.
- Then scans up to `NOTION_LIBRARY_QUERY_LIMIT` recent library rows and matches
  against the row title plus row properties/metadata.
- It does not currently maintain a local metadata index, and it does not search
  child-page block text until a matching library row is being parsed.

TV-series parsing has an extra nested pass:

- A season row may contain a version/spec child page, such as `简英`,
  `繁英`, `繁简英`, a resolution/size label, or `片源`/`资源`.
- That child page may contain episode child pages.
- The parser enters each episode child page and exposes playable video/file
  blocks as variants, capped by `NOTION_VARIANT_LIMIT`.
- Archive/download bundles such as `.7z`, `.zip`, subtitles, PDFs, and text
  sidecars are filtered out because they are not browser-playable assets.

Cache flow:

```text
web search
  -> API /api/search
  -> user selects variant
  -> API /api/cache
  -> Azure Queue + Table state
  -> Container Apps Job worker, one cache item at a time
  -> Blob cache write with progress updates
  -> Table ready state
  -> API /api/playback/{assetKey}
  -> SAS URL
  -> browser video playback
```

## Deployment

Provision foundation once:

```powershell
.\infra\provision.ps1
```

Build/deploy worker:

```powershell
.\infra\build-worker-image.ps1
.\infra\deploy-worker-job.ps1
.\infra\deploy-cleanup-job.ps1
```

Build/deploy API and web:

```powershell
.\infra\build-api-image.ps1
.\infra\deploy-api-containerapp.ps1
.\infra\deploy-web-staticapp.ps1
```

Manual worker run:

```powershell
.\infra\start-worker-job.ps1
```

## Operations

API logs:

```powershell
az2 containerapp logs show `
  --name ca-ww-player-api `
  --resource-group rg-ww-player-cache-dev `
  --container ca-ww-player-api `
  --tail 100 `
  --format text
```

Latest worker job logs:

```powershell
az2 containerapp job logs show `
  --name job-ww-cache-worker `
  --resource-group rg-ww-player-cache-dev `
  --container job-ww-cache-worker `
  --tail 100 `
  --format text
```

Latest cleanup job logs:

```powershell
az2 containerapp job logs show `
  --name job-ww-cache-cleanup `
  --resource-group rg-ww-player-cache-dev `
  --container job-ww-cache-cleanup `
  --tail 100 `
  --format text
```

List job executions:

```powershell
az2 containerapp job execution list `
  --name job-ww-cache-worker `
  --resource-group rg-ww-player-cache-dev `
  --output table
```

The API and worker write structured JSON logs. The most useful fields are:

- `event`
- `level`
- `requestId`
- `assetKey`
- `jobId`
- `durationMs`
- `statusCode`
- `jobStatus`
- `progress`

The frontend includes the request id in most API error messages. Use that request id to find the matching API log line.

## Common Failures

Access key fails:

- Check Key Vault secret `WWPDW-ACCESS-KEY`.
- Check API logs for `api.auth.denied` or `api.auth.missing_config`.

Search returns no results:

- Confirm `NOTION_READ_ONLY_TOKEN` is attached to the API.
- Confirm the Notion integration is shared with the root page.
- Confirm the film is a direct database entry under the configured library database.

Cache request fails:

- Check API logs for `api.cache.ensure`.
- Check worker job executions.
- Check worker logs for `worker.job.failed` or `cache.blob.upload_failed`.
- If multiple cache requests arrive together, only the first request should
  start the worker. Later requests join the active queue and should show as
  queued/preparing in the web UI.

Playback does not start:

- Check `api.playback.ready` and whether the asset is still fresh.
- Check the media diagnostics shown in the web UI and logged by `api.playback.ready`.
- Check Blob properties: `Content-Type` should be video-like, content length should be nonzero, and range requests should work.
- H.265 playback depends on the browser/device. The web player library cannot fix unsupported codecs by itself.
- MP4 seeking depends on browser range support and whether the MP4 metadata is near the front of the file.

## Design Decisions

First version avoids NAS because Azure Blob + Container Apps Job is simpler to operate, easier to scale briefly, and has fewer home-network failure modes.

Container Apps Job is used for caching because download duration can exceed a request/response API call. Jobs also let the API scale to zero while cache work runs separately.

CDN is deferred. For small private family usage, direct Blob playback is cheaper and simpler. Mainland China playback may still be variable, but CDN/private-access tradeoffs should be evaluated only after real usage data.

The Notion token is read-only because the app may later add AI-assisted parsing/resolution, and write-capable credentials would create unnecessary risk.

## Near-Term Code Priorities

1. Improve player error states: expired SAS, codec unsupported, network stall, and blob missing.
2. Expand the admin/debug view if needed for playback attempts and request-log drilldown. Recent cache jobs and request ids are already visible.
3. Add optional remux/faststart handling for MP4 files whose `moov` box is late. Diagnostics exist; remuxing does not.
4. Later, migrate the thin UI to a shadcn/Vite style and consider ArtPlayer or Vidstack.
