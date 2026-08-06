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

- `MEMBER_DEFAULT_CREDITS=200`
- `MEMBER_CACHE_CREDIT_COST=2`
- `MEMBER_CACHE_CREDIT_BYTES=2000000000`
- `MEMBER_DOMESTIC_PLAYBACK_CREDIT_BYTES=200000000`
- `MEMBER_PLAYBACK_REPLAY_FREE_HOURS=168`
- `MEMBER_PLAYBACK_CREDIT_BYTES=100000000`

Search, cache hits, and joining an already-running cache job are free. Creating
a new cache job spends the greater of `MEMBER_CACHE_CREDIT_COST` and
`ceil(contentLength / MEMBER_CACHE_CREDIT_BYTES)` 🍀. Domestic playback spends
`ceil(contentLength / MEMBER_DOMESTIC_PLAYBACK_CREDIT_BYTES)` 🍀; international
playback spends `ceil(contentLength / MEMBER_PLAYBACK_CREDIT_BYTES)` 🍀. The
same member can replay the same asset on the same line within
`MEMBER_PLAYBACK_REPLAY_FREE_HOURS` without another playback charge. Admin keys
bypass member allowance checks. A
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

Prepared OSS videos use the same idle policy. The API updates `lastPlayedAt`
and `expiresAt` in `osspreparejobs` before issuing an OSS signed playback URL.
The Azure cleanup Job conditionally claims the Table row with its ETag, deletes
only objects under `ALIYUN_OSS_OBJECT_PREFIX`, and then removes the preparation
row. This prevents a playback touch and cleanup from winning at the same time.
Legacy ready rows without `expiresAt` are never deleted from their historical
completion time; the first active cleanup run backfills a fresh idle window.
Deploy OSS cleanup in dry-run first, inspect the execution summary, and only
then pass `-AliyunOssCleanupDryRun false` to `deploy-cleanup-job.ps1`.

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
- A spec/source child-page title without a real playable media block is
  `untrusted_title_only`. Metadata sync skips library rows with no playable
  variants and deletes their existing `notion-page-<pageId>` search-index row,
  even if the Notion title lacks `【仅供下载】` or `【敬请期待】`.
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

For newly produced or reprocessed media, use `ffprobe` on the final local file
before Notion writeback and populate structured `Media Assets` fields whenever
possible: container, duration, resolution, video codec/profile, HDR/SDR signal,
frame rate, audio codec/channel layout/languages, subtitle stream languages, and
exact byte size. Old Notion title/filename parsing is only a migration fallback;
new assets should be self-contained enough for the website to display variant
details without guessing. In other words, old cleanup may infer metadata from
titles and filenames, but new production should write probed media facts back to
Notion as part of the normal packaging step. Future upload/package helpers
should make `ffprobe` a normal writeback step so the website can render variant
details from structured Notion data rather than parsing human-readable titles.
For legacy migration, filename evidence should outrank stale spec-title evidence
for technical fields such as resolution and video codec. Use the title mainly as
a fallback and for human language/subtitle hints.
For the Notion `Video Codec` select field, keep codec-family values instead of
encoder names: `hevc`, `h264`, and `av1` are the current canonical Notion values.
`x265` is an HEVC encoder signal, so normalize `h265`/`H.265`/`x265` to `hevc`;
normalize `avc`/`x264` to `h264`. The API display parser can still expose
`HEVC`, `H.264`, and `AV1` for website-facing metadata. A July 6, 2026 cleanup
used `tools/notion-media-assets-normalize-codec.mjs` and left zero old codec
candidates; the final Notion distribution was `hevc = 2132`, `h264 = 548`, and
`av1 = 4`.

The guarded Media Assets writer is available for small representative migrations:

```powershell
npm run notion:asset-write -- --query "风之谷" --max-assets 3
npm run notion:asset-write -- --query "风之谷" --max-assets 3 --apply
```

It writes `Source Page ID` and `Media Block ID` for traceability, skips duplicate
rows for the same work/source/block, and treats source/original-disc rows as
hidden from the website by default.

For larger runs, use `--batch-manifest` with page IDs and
`expectedTitleContains` guards instead of broad title queries. Keep operational
batch manifests in `.local-data`; the checked-in example is
`tools/notion-media-assets-batch.example.json`. Generate the next operational
manifest with `npm run notion:asset-batch -- --output .local-data/media-assets-batch.json --max-items 50`.
Pass `--exclude-preview` with the previous preview report to keep empty or
high-issue pages out of subsequent candidate batches. The generator also skips
main-library pages whose normalized full title already belongs to a Work covered
by Media Assets, because duplicate Notion rows can otherwise bypass relation-id
dedupe.
Before applying a broad batch, run `npm run notion:asset-filter -- --manifest
.local-data/media-assets-batch.json --preview
.local-data/media-assets-batch-preview.json --output
.local-data/media-assets-batch-low-risk.json`, then dry-run and apply that
filtered manifest. The filter is local-only and keeps conservative movie-like
pages: at least one dry-run creation, no title mismatch, at most one issue, at
most three selected assets, no series-looking title, and stronger title evidence
for single-asset pages.
The generator also checks the main library `影别` property when present. Broad
movie batches exclude leading full-width bracket operator/status prefixes such
as `【敬请期待】`, `【仅供下载】`, or `【缺】`, and exclude non-movie kinds such as
`TV Series` and `TV Mini Series` unless `--include-series` is explicitly passed;
TV assets should use a separate episode-aware migration path.
The generator can also accept that filtered manifest path via
`--exclude-preview`; its `filteredOut` entries are treated as exclusions for
later rounds.
For large TV follow-up batches, the series writer supports `--skip-pages`; this
skips already completed safe pages from the audit report so later batches do not
rescan old episode trees. Use it only after an apply plus rerun has confirmed
the earlier pages are already represented by `skip_existing` rows.
The series writer strips leading operator/status markers such as `【敬请期待】`
from generated Media Assets names, while keeping the Work relation pointed at
the original Notion page.
For direct spec-page media, use `--include-direct-spec` only after a dry-run. It
writes rows only when the media title or filename contains a parseable episode
number such as `S02E01`; unparseable direct media and duplicate parsed episode
numbers stay as reported issues. The first successful direct-spec pass wrote 8
rows for `辐射 第二季`, then reran as 8 `skip_existing`.
The read-only series audit also supports `--skip-targets` so remaining series
pages can be scanned in chunks. A later chunk found and wrote 85 more standard
episode rows plus 10 direct-spec rows for `太平洋战争`; `兄弟连` was initially left
manual because 2 episode pages are unparseable even though 42 playable rows
exist.
For confirmed cases like this, the series writer now has an explicit
`--allow-partial-episodes` flag. It keeps default behavior conservative, but can
write parseable episode rows while leaving unparseable specials/bonus rows as
issues. The 2026-07-06 leftover-series audit covered all 49 remaining series
pages: 48 had no writable media, while `兄弟连` had 40 parseable main episodes
plus 2 unparseable `Episode Specials` rows. A partial write created those 40
main-episode rows and reran as 40 `skip_existing`; latest stats after that pass
are 3233 active Media Assets rows, 928 covered works, 2559 playable rows, 674
source-only rows, and zero traceability gaps. Fresh leftovers are now 202
uncovered pages, including 48 remaining series pages.
`【仅供下载】` rows can be migrated to source-only Media Assets rows when a real
source/original-disc/subtitle file block exists. Keep `allowedAssetTypes` to
`original_disc`, `source_archive`, and `subtitle_package`; do not create playable
rows from empty playable spec placeholders. The 2026-07-06 source-only pass
wrote 19 movie pages and 14 TV/series pages, then reran as `skip_existing`.
Remaining download-only rows are mostly title-only/empty source groups, duplicate
source-file pages, or series pages where no real source file block was found.
For `【敬请期待】` rows that already contain real playable/source media, do not
write public playable assets while leaving the waiting prefix in the main title.
Use `notion-title-prefix-cleanup.mjs` after the Media Assets apply/rerun. The
first guarded promotion pass wrote 20 rows for 7 zero-issue movie pages and then
removed `【敬请期待】` from those 7 titles; a cleanup rerun reported
`skip_prefix_absent`. A second waiting-prefix chunk wrote 13 rows for 4 more
zero-issue pages and removed those prefixes too. Latest stats after that pass:
3185 active Media Assets rows, 924 covered works, 2514 playable rows, 671
source-only rows, and zero traceability gaps. Two later low-yield waiting chunks
promoted `无间道3：终极无间` and `囚徒`, bringing the latest stats to 3190 active
Media Assets rows, 926 covered works, 2517 playable rows, 673 source-only rows,
and zero traceability gaps. The final non-series waiting chunk promoted only
`少数派报告`, wrote 3 rows, removed its waiting prefix, and brought the latest
stats to 3193 active Media Assets rows, 927 covered works, 2519 playable rows,
674 source-only rows, and zero traceability gaps. All non-series waiting pages
have now been audited once; the remaining waiting rows either have no candidates
or have empty playable spec/source groups that must be renamed, removed, or
repaired before automatic promotion.
A later operator-prefix pass checked 15 remaining unpreviewed `【敬请期待】`
non-series pages. Only `无依之地` and `饥饿站台2` were zero-issue; the writer
created 7 rows, reran as 7 `skip_existing`, and title cleanup removed both
waiting prefixes. `超级马力欧兄弟大电影` still has real media but also an empty
source-group issue, so keep it in structure cleanup until that group is renamed,
removed, or populated.
The two weak-title leftovers, `乱` and `翼`, were safe with explicit page IDs and
full expected-title guards. The writer created 6 rows and reran as 6
`skip_existing`. Latest stats after that pass are 3246 active Media Assets rows,
932 covered works, 2568 playable rows, 678 source-only rows, and zero
traceability gaps. Fresh leftovers are now 198 uncovered pages: 130
operator/status-prefixed pages, 48 series pages, 13 no-media placeholders, 6
no-write pages, and 1 manually excluded title-pattern page.
A prefixed-series audit then checked all 31 remaining operator-prefixed TV-like
rows. Only three `【敬请期待】` pages were complete and zero-issue:
`绝代双骄`, `沙丘：预言 第一季`, and `最后生还者 第一季`. The series writer created 46
playable episode rows, reran as 46 `skip_existing`, and title cleanup removed
the three waiting prefixes. `基地 第一季` still has playable rows but is missing
Episode 01 and Episode 02, so leave it as incomplete. Latest stats after this
pass are 3292 active Media Assets rows, 935 covered works, 2614 playable rows,
678 source-only rows, and zero traceability gaps. Fresh leftovers are now 195
uncovered pages, including 127 operator/status-prefixed pages.
The 6 `noWritePages` were rechecked against current Notion state and still have
zero candidates and zero issues. The remaining manual-excluded row, `耀眼`, had
a real source archive plus an empty playable placeholder; it was written as one
`source_only` source archive row with website hide enabled and reran as
`skip_existing`. Latest stats after that pass are 3293 active Media Assets rows,
936 covered works, 2614 playable rows, 679 source-only rows, and zero
traceability gaps. Fresh leftovers are now 194 uncovered pages: 127
operator/status-prefixed pages, 48 series pages, 13 no-media placeholders, and 6
no-write pages.
The round38 operator source-only pass then dry-ran all 127 operator/status
leftovers in chunks and wrote only a safe subset of real source-only candidates:
34 `original_disc`, `source_archive`, or `subtitle_package` rows. Each row has
`Media Availability = source_only`, `Hide from Website = true`, Work relation,
`Source Page ID`, and `Media Block ID`; the rerun was 34 `skip_existing`.
`【仅供下载】皮克斯短片集` was excluded because of prior duplicate short-title
source risk, and `【缺】闪灵` was excluded because the missing marker needs
manual semantic review. Latest stats after this pass are 3327 active Media
Assets rows, 970 covered works, 2614 playable rows, 713 source-only rows, and
zero traceability gaps. A regenerated round39 manifest has 18 ordinary items,
but its dry-run found zero candidates. Fresh leftovers are now 101 uncovered
pages: 53 operator/status-prefixed pages and 48 series pages.
All 68 remaining TV-like uncovered pages, including operator-prefixed seasons,
were then audited in three chunks. The audit found zero playable episode media
and zero direct spec-page playable media; remaining TV rows are empty episode
shells or empty spec shells, so standard automatic series writing is exhausted.
A final operator/status all-type dry-run found 10 pages with candidates. Seven
`【敬请期待】` pages were promoted safely: `搭错车`, `飞驰人生2`, `夜班`,
`那些年，我们一起追的女孩`, `戏梦巴黎`, `卧虎藏龙`, and `哪吒之魔童闹海`. The
writer created 15 playable rows, reran as 15 `skip_existing`, and title cleanup
removed `【敬请期待】` from those seven work titles. `【无字幕】秘密会议`,
`【仅供下载】皮克斯短片集`, and `【敬请期待】姜子牙` remain manual-review items.
Latest stats after this pass are 3342 active Media Assets rows, 977 covered
works, 2629 playable rows, 713 source-only rows, and zero traceability gaps. A
regenerated round40 manifest still has 18 ordinary items, but its dry-run found
zero candidates. Fresh leftovers are now 94 uncovered pages: 46
operator/status-prefixed pages and 48 series pages.
`姜子牙` was promoted in a follow-up after the writer/audit display-label cleanup
learned to strip dangling standalone `GB`/`GiB` units from generated asset
labels while preserving valid sizes such as `1.76GB`. The targeted dry-run
produced `姜子牙 繁简英 普通话`, created one playable row, reran as
`skip_existing`, and removed the `【敬请期待】` title prefix. Latest stats after
this pass are 3343 active Media Assets rows, 978 covered works, 2630 playable
rows, 713 source-only rows, and zero traceability gaps. Fresh leftovers are now
93 uncovered pages: 45 operator/status-prefixed pages and 48 series pages. The
latest operator/status dry-run found only two pages with candidates:
`【无字幕】秘密会议` and `【仅供下载】皮克斯短片集`; keep both for manual review.
`秘密会议` was then migrated as a hidden non-public playable asset using the
writer's manifest override support. The row is `Asset Type = playable_video`,
`Media Availability = needs_processing`, `Hide from Website = true`, and its
Developer Memo records the no-subtitle operator marker; the `【无字幕】` title
prefix remains for operator routing. The apply created one row and reran as
`skip_existing`. Latest stats after this pass are 3344 active Media Assets rows,
979 covered works, 2630 public playable rows, 1 hidden `needs_processing` row,
713 source-only rows, and zero traceability gaps. Fresh leftovers are now 92
uncovered pages: 44 operator/status-prefixed pages and 48 series pages. The
latest operator/status dry-run has only one remaining candidate page:
`【仅供下载】皮克斯短片集`, still excluded for duplicate short-title source risk. A
direct Media Assets lookup confirmed that the same `Original File Name`, `Pixar
Short Films Collection Vol 1 2007 1080p BluRay AVC LPCM 5.1-CHDBits.7z.001`, is
already represented as a hidden `source_only` row under
`【仅供下载】皮克斯短片集 The Pixar Shorts Collection`, so the short-title page should be
merged/removed manually rather than migrated again.
The movie Media Assets audit/write tools now also understand the newer movie
page structure where playable spec child pages and the `片源` source container
sit directly under the movie page instead of inside callout/toggle wrappers. A
guarded manifest wrote 14 rows for `冲出宁静号`, `美好的世界`, `十二宫`, `钢琴课`,
`再见列宁`, and `边缘日记`: 10 playable rows plus 4 hidden `source_only`
archives. The apply reran as 14 `skip_existing`. Latest stats after this pass
are 3358 active Media Assets rows, 985 covered works, 2640 public playable rows,
1 hidden `needs_processing` row, 717 source-only rows, and zero traceability
gaps. A regenerated round43 manifest has 12 ordinary movie pages; its dry-run
found zero candidates because all 12 have placeholder spec/source titles but no
attached media blocks. Those 12 need manual Notion cleanup, file attachment, or
production before automatic writeback. Global leftovers remain 92 uncovered
skipped pages: 44 operator/status-prefixed pages and 48 series pages.
After each broad write, run `node tools/notion-media-assets-stats.mjs --report
.local-data/media-assets-stats.json`. It is read-only and reports active row
counts, Work coverage, asset type/availability distribution, website hide flags,
playback verification flags, and traceability gaps such as missing
`Source Page ID`, `Media Block ID`, or Work relation.

For newly encoded, remuxed, repaired, or re-uploaded playable assets, run
`ffprobe` on the final local media file before Notion writeback and persist the
measured stream/file facts into `Media Assets`. Old cleanup can still bootstrap
from titles and filenames, but new production should not depend on title parsing
for website variant display.

Notion IDs are now explicit in local `.env`:

- Main library DB: `f47ef878-8acb-4e12-b604-011e95fb1738`
- Main library data source: `7eced5e7-83de-492f-80f8-31eecd5679b0`
- Media Assets DB: `9bacb469-eff7-4c92-80bd-8db16838f2e2`
- Media Assets data source: `5d2f4cad-caca-43eb-9b0a-99bede43bd8d`

If Node SDK calls to Notion fail with TLS resets while DNS resolves
`api.notion.com` to `198.18.0.11`, use curl with
`--resolve api.notion.com:443:208.103.161.1`, or pass
`--resolve-ip 208.103.161.1` to the local Notion tools. This came from the
network-failure recovery notes in conversation `019f27b0-19d0-7ac2-a2bf-686f4bec7b76`.
For data-source endpoints, send `Notion-Version: 2025-09-03`; older
`2022-06-28` returns invalid request URL for `/v1/data_sources/...`.

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
