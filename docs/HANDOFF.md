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

The Admin tab now includes member pass management, a ready cached-video
view, and a recent cache jobs view. Each pass is bound to a member name, but
family members still sign in with only the pass string. Passes do not expire by
date; they carry a simple 🍀 balance that admins set when creating the pass and
can update later. The cache job view shows worker status, progress, job id, asset
key, latest request id, blob diagnostics, size, range support, and MP4 faststart
status. Admins can retry failed cache jobs, delete failed/stuck job records, and
delete ready cached videos together with their Blob and job state.

Known successful playback example:

- `Albert Nobbs (2011)` variant around 1.59 GB

Search now has a persistent movie metadata index. The API checks this index
before live Notion search, then falls back to Notion and writes fallback results
back to the index. Cache requests still refresh the selected Notion page before
queueing work, because Notion-hosted file URLs may be temporary.

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
- Movie metadata index table: `movieindex`
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
- `WWPDW-ADMIN-KEY`: static administrator key for the Admin tab

Container environment variables:

- API receives `NOTION_READ_ONLY_TOKEN` from `NOTION-READ-ONLY-TOKEN`
- API receives `WWPDW_ADMIN_KEY` from `WWPDW-ADMIN-KEY`
- API and worker use managed identity for Azure Storage and Azure Resource Manager

The frontend only stores the user-entered key in browser `sessionStorage`. Regular family access uses generated member passes stored in the member-code table.

## Member Allowances

External UI copy should call user keys `member passes` rather than access keys.
The API still uses `x-wwpdw-access-key` internally.

Default pass allowance settings:

- `MEMBER_DEFAULT_CREDITS=20`
- `MEMBER_CACHE_CREDIT_COST=1`
- `MEMBER_PLAYBACK_REPLAY_FREE_HOURS=24`
- `MEMBER_PLAYBACK_CREDIT_BYTES=1000000000`

Search, cache hits, and joining an already-running cache job are free. Creating
a new cache job with a member pass spends `MEMBER_CACHE_CREDIT_COST` 🍀.
Playback spends `ceil(contentLength / MEMBER_PLAYBACK_CREDIT_BYTES)` 🍀, but the
same member can replay the same asset within `MEMBER_PLAYBACK_REPLAY_FREE_HOURS`
without another playback charge. Admin keys bypass member allowance checks. A
member request that exceeds the remaining balance returns HTTP 429 before it
creates a cache job or issues a playback URL.

Member passes do not currently expire by date. Existing stored `expiresAt`
values are retained for backward compatibility, but `revokedAt` is the only
member-pass status control besides deleting the pass row.

Current accounting is stored on the member pass row in the `membercodes` table.
That is intentionally simple for a family-scale system. If usage grows, split
credit events into a separate ledger table with optimistic concurrency.

## Cache Retention

Ready cached videos track both `cachedAt` and `lastPlayedAt`. The playback API
refreshes `lastPlayedAt` whenever it issues a playback URL. The cache
`expiresAt` value represents the current idle-expiry timestamp, not an absolute
lifetime cap.

The cleanup job deletes Blob media and cache state when the video has not been
played for `CACHE_ASSET_IDLE_TTL_DAYS` days. The default is 7 days; never-played
videos use `cachedAt` as the idle reference.

The application-level cleanup job is authoritative because it updates Table
state and deletes the matching cache job record. Azure Storage lifecycle rules
should not impose a separate absolute retention cap on cached videos.

Admins can also delete a ready cache entry manually from the Admin tab. That path
uses the same cache-store deletion flow as cleanup: remove Blob media first,
then remove the asset row and linked job row. The Admin tab has a dedicated
ready cached-video list for this. Failed cache jobs can be retried, which
refreshes the source URL from Notion before resetting the same job to `queued`
and re-enqueuing it for the worker, or deleted when the source is no longer
useful. Stuck in-progress jobs can also be deleted from the recent cache jobs
view. New jobs store the Notion page id for the page carrying the media link as
`sourcePageId`; older jobs can usually recover the same id from the
`notion-page-...` asset key. `sourceBreadcrumb` is stored only for operator
context.

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

- First checks the persistent movie metadata index when
  `SEARCH_INDEX_ENABLED=true`.
- If the index has no match or cannot be read, falls back to live Notion.
- Live Notion fallback results are written back into the index when
  `SEARCH_INDEX_WRITE_THROUGH=true`.
- First tries a Notion data-source title `contains` query when the title
  property is known.
- If that has no result, tries short CJK title segments.
- Then scans up to `NOTION_LIBRARY_QUERY_LIMIT` recent library rows and matches
  against the row title plus row properties/metadata.
- It does not search child-page block text until a matching library row is
  being parsed or refreshed by the metadata sync job.

TV-series parsing has an extra nested pass:

- A season row may contain a version/spec child page, such as `简英`,
  `繁英`, `繁简英`, a resolution/size label, or `片源`/`资源`.
- That child page may contain episode child pages.
- The parser enters each episode child page and exposes playable video/file
  blocks as variants, capped by `NOTION_VARIANT_LIMIT`.
- If an episode child-page title contains a parseable episode number, the
  website normalizes the visible variant label to `Episode NN`. This keeps old
  manual Notion titles from leaking into the UI, but it is not a substitute for
  cleaning the Notion tree itself.
- Playable variants now have optional `MediaVariant.metadata`, parsed
  conservatively from the spec page title plus media filename. This is
  variant-level data, not work-level movie metadata. Use it for future website
  display of edition, audio language, subtitle language, resolution, codec,
  approximate size, and CQ/ICQ-style quality tags.
- Archive/download bundles such as `.7z`, `.zip`, subtitles, PDFs, and text
  sidecars are filtered out because they are not browser-playable assets.

Operator notes for maintaining the Notion media layout, uploading playable
movie/TV files, and future encode-to-upload work live in
`docs/notion-media-workflow-notes.md`.

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

Metadata index flow:

```text
manual full metadata job
  -> scan all library database rows slowly
  -> parse each row with the same Notion parser used by live search
  -> write SearchResult metadata into Azure Table Storage
  -> delete index rows no longer seen by the full crawl

scheduled incremental metadata job
  -> read latest indexed Notion last_edited_time
  -> scan recent library rows with a small overlap window
  -> upsert changed rows into the same index

web search
  -> API /api/search
  -> movie metadata index first
  -> live Notion fallback only on miss/error
```

Rows with `Hide from Website` checked in Notion are intentionally excluded from
the website. Metadata sync skips those pages and deletes their existing
`notion-page-<pageId>` search-index entry when encountered; unchecked or missing
means normal sync.

Title prefixes `【敬请期待】` and `【仅供下载】` are Notion operator markers, not work
titles. Website display strips both. `【敬请期待】` means unfinished/waiting-view
production; `【仅供下载】` means source/archive materials exist but playable web
media is not ready. Do not remove the latter from Notion until playback has
actually been produced and verified.

For cleaned/new rows, prefer `Media Availability` over title prefixes. Use
`source_only` when only original/source/download material exists. `Developer
Memo` is an internal Notion note for source defects, missing subtitles,
failed/possible remux or transcode fixes, and future processing plans; it should
not be used as public website copy.

Source/original-disc packages should eventually carry their own asset metadata
too. Filenames such as Blu-ray/UHD Blu-ray/ISO/remux encode important facts, but
the website and future processing queues should not depend on filename parsing
alone.

Notion IDs are now explicit in local `.env`:

- Main library DB: `f47ef878-8acb-4e12-b604-011e95fb1738`
- Main library data source: `7eced5e7-83de-492f-80f8-31eecd5679b0`
- Media Assets DB: `9bacb469-eff7-4c92-80bd-8db16838f2e2`
- Media Assets data source: `5d2f4cad-caca-43eb-9b0a-99bede43bd8d`

If Node SDK calls to Notion fail with TLS resets while DNS resolves
`api.notion.com` to `198.18.0.11`, use curl with
`--resolve api.notion.com:443:208.103.161.1`. For data-source endpoints, send
`Notion-Version: 2025-09-03`; older `2022-06-28` returns invalid request URL
for `/v1/data_sources/...`.

Cache concurrency and visibility:

- The member-facing `Current tasks` panel is intentionally browser/session
  scoped. It only shows cache jobs that this browser requested or explicitly
  joined by clicking a result/history item. It should not become a global family
  activity feed.
- If member A clicks a video that member B already requested and the asset is
  still downloading, the API should return the existing active job for the same
  `assetKey`. A's browser then adds that job to A's local task panel and polls
  the latest status/progress. Joining an already-running job is free and should
  not create a duplicate download.
- The Admin cache jobs view is global. It can show jobs requested by any
  member, plus ready/failed/stuck state for operations.
- Different videos can queue independently. The worker currently caps active
  cache work with `WORKER_MAX_CONCURRENT` so Notion and Blob traffic do not
  spike too hard from one public IP.

Admin retry flow:

```text
Admin Continue
  -> API loads the failed job
  -> refreshes the same Notion source page by sourcePageId or assetKey page id
  -> falls back to a title search only if direct page refresh misses
  -> updates sourceUrl on the same job
  -> worker downloads with the refreshed URL
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
.\infra\deploy-metadata-sync-job.ps1 -Mode full
.\infra\deploy-metadata-sync-job.ps1 -Mode incremental
.\infra\deploy-web-staticapp.ps1
```

Run the initial full movie metadata crawl:

```powershell
.\infra\start-metadata-sync-job.ps1 -Mode full
```

Manual worker run:

```powershell
.\infra\start-worker-job.ps1
```

## Operations

API logs:

```powershell
az containerapp logs show `
  --name ca-ww-player-api `
  --resource-group rg-ww-player-cache-dev `
  --container ca-ww-player-api `
  --tail 100 `
  --format text
```

Latest worker job logs:

```powershell
az containerapp job logs show `
  --name job-ww-cache-worker `
  --resource-group rg-ww-player-cache-dev `
  --container job-ww-cache-worker `
  --tail 100 `
  --format text
```

Latest cleanup job logs:

```powershell
az containerapp job logs show `
  --name job-ww-cache-cleanup `
  --resource-group rg-ww-player-cache-dev `
  --container job-ww-cache-cleanup `
  --tail 100 `
  --format text
```

Latest metadata sync job logs:

```powershell
az containerapp job logs show `
  --name job-ww-meta-index-full `
  --resource-group rg-ww-player-cache-dev `
  --container job-ww-meta-index-full `
  --tail 100 `
  --format text
```

List job executions:

```powershell
az containerapp job execution list `
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
- `sourcePageId`
- `sourceUrlChanged`

Useful retry-source events:

- `api.admin.cache_jobs.retry_source_refresh_start`
- `api.admin.cache_jobs.retry_source_refresh_hit`
- `api.admin.cache_jobs.retry_source_refresh_miss`
- `api.admin.cache_jobs.retry_source_refresh_failed`

The frontend includes the request id in most API error messages. Use that request id to find the matching API log line.

## Common Failures

Access key fails:

- Check Key Vault secret `WWPDW-ADMIN-KEY` for administrator login.
- Check API logs for `api.auth.denied` or `api.auth.missing_config`.

Search returns no results:

- Check `/api/admin/search-index` as admin to see whether the metadata index has
  entries and recent sync runs.
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
4. Harden cache concurrency before broader rollout. Add an asset-key scoped
   atomic create/lease so simultaneous first clicks on the same uncached video
   can never create duplicate jobs. Add a short worker-trigger lease so multiple
   API instances do not start redundant worker executions at the same time, and
   consider a scheduled watchdog that periodically drains queued/stuck work if a
   one-shot worker exits early.
5. Later, migrate the thin UI to a shadcn/Vite style and consider ArtPlayer or Vidstack.
