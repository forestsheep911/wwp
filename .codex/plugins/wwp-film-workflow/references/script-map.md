# WWP Script Map

Use plugin helper scripts for generic media mechanics and existing repository tools for WWP Notion schema operations.

## Workflow Contract

- `../../references/workflow-cycle.md`
  - Defines the bounded four-lane cycle: intake, metadata maintenance, production, and publication/Media Assets. Use it with the producer skill so an empty media-block queue cannot end the overall film-library workflow.

## Plugin Helpers

- `node .codex/plugins/wwp-film-workflow/scripts/scan-input-directory.mjs --root <input-dir> --output <scan.json>`
  - Summarizes top-level candidate folders, largest media files, subtitle sidecars, NFOs, and filename-derived flags before heavy probing. Subtitle counts cover external files only and internal streams are explicitly unprobed; zero sidecars must never be interpreted as no Chinese subtitles.
- `node .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.mjs --root <input-dir> --state <state.json> --once`
  - Compares the latest scan with a saved state file and reports new, removed, or changed queue entries. Pass `--ledger .local-data/wwp-film-workflow.sqlite` so every scan writes source discoveries to the local ledger before the JSON baseline is replaced. It also accepts positional `root state output` arguments for npm-forwarding edge cases. Use `--interval-sec <seconds>` only when an active monitoring loop is desired.
- `node .codex/plugins/wwp-film-workflow/scripts/probe-media.mjs --input <media> --output <json>`
  - Runs `ffprobe` and writes structured JSON for source/final media.
- `node .codex/plugins/wwp-film-workflow/scripts/transcode-hevc-mp4.mjs --input <media> --output <mp4> --subtitle-stream <ordinal|none> [--subtitle-file <ass|ssa>] [--audio-channels <count>]`
  - Use `--audio-channels 6` when a TrueHD/Atmos 7.1 source should be delivered as broadly compatible AAC 5.1. Omitting it preserves the previous automatic channel-layout behavior.
- `node .codex/plugins/wwp-film-workflow/scripts/build-series-collections.mjs --manifest <json> [--apply]`
  - Probes already QC-passed episode MP4s, groups consecutive episodes toward 4.85GB, verifies identical stream layouts within each group, and concat-remuxes one `S01E01-E05` style upload asset per group. Dry-run is the default. Every applied output is checked against the hard 5,000,000,000-byte cap.
- `node .codex/plugins/wwp-film-workflow/scripts/remux-audio-variant.mjs --video-source <qc-passed-mp4> --audio-source <media> --audio-stream <ordinal> --output <mp4> [--audio-channels 6]`
  - Reuse an already QC-passed `hvc1` video stream when only the audio variant changes. The selected source audio is encoded to AAC while the video is stream-copied, and the final MP4 still fails closed above `--max-bytes`. Do not use this for different hard-subtitle variants because their video pixels differ.
  - Burns a selected PGS subtitle with `--subtitle-stream`, uses `none` when the source already has a verified hard subtitle, or burns extracted ASS/SSA text subtitles through libass with `--subtitle-file`. Writes an MKV work file first, then remuxes to MP4 with `hvc1`. Supports `--duration` for bounded subtitle/color smoke tests, `--scale WIDTHxHEIGHT` for an explicit delivery resolution, `--video-bitrate RATE` for size-oriented outputs, and `--tone-map-sdr` for validated HDR/Dolby Vision to BT.709 conversion. Refuses outputs over the 5GB workflow cap.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .codex/plugins/wwp-film-workflow/scripts/make-qc-contact-sheet.ps1 -InputPath <media> -Output <png>`
  - Runs `ffmpeg` to create a contact sheet from evenly spaced timestamps.
- `node .codex/plugins/wwp-film-workflow/scripts/plan-stream-variants.mjs --matrix <json>`
  - Explains which planned variants need video encode, audio encode, remux, or cannot reuse streams.
- `node .codex/plugins/wwp-film-workflow/scripts/imdb-rating-inspect.mjs tt43592244`
  - Looks up IMDb ratings by IMDb ID. Prefer the official IMDb non-commercial `title.ratings.tsv.gz` dataset; optionally falls back to IMDb title-page JSON-LD. Use when OMDb rejects a current IMDb ID or returns stale/missing `imdbRating`.
- `node tools/notion-imdb-rating-enrichment.mjs --page-id <page> --imdb-id <ttid>`
  - Dry-run/apply Notion IMDb score fallback writes after OMDb. It fills only an empty `IMDB评分` field from `imdb-rating-inspect.mjs`, appends source labels such as `imdb-datasets` or `imdb-page`, and records vote-count evidence in `Developer Memo` when that field is empty. It must not overwrite existing human or OMDb values.
- `node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --imdb-id <ttid> --discover-only`
  - Discovers Rotten Tomatoes and Metacritic official page URLs from Wikidata external IDs. Use this when OMDb lacks critic fields and an IMDb ID exists. Discovery is not enough to write scores; verify page identity and parse the official page next.
- `node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --rotten-url <url> --metacritic-url <url>`
  - Parses official Rotten Tomatoes and Metacritic pages for critic scores when OMDb is missing stale critic fields. Rotten Tomatoes parsing supports `media-scorecard-json`, `<score-board>`, and official JSON-LD `AggregateRating`; Metacritic parsing supports current `global-score-value`, legacy `metascore_w`, and official JSON-LD `AggregateRating`. It also accepts `--imdb-id <ttid>` to discover official page URLs through Wikidata before parsing. Use confirmed official page URLs, saved official-page HTML, or Wikidata-discovered official URLs; do not apply title-search guesses without verifying title/year/page identity. When `--rotten-url` or `--metacritic-url` points to saved HTML, add `--rotten-source-url <official-url>` or `--metacritic-source-url <official-url>` so reports keep the original page.
- `node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --imdb-url <url-or-html>`
  - Parses IMDb official title-page HTML for displayed Metascore when OMDb/Metacritic direct-page paths are missing or stale. Record this as `imdb-page-metascore`; do not use it for Rotten Tomatoes. When parsing saved IMDb HTML, add `--imdb-source-url <official-imdb-url>`.
- `node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --ratings-json <trusted-evidence.json>`
  - Reads trusted structured fallback values for Rotten Tomatoes and Metascore when official lookups are blocked but licensed export data or manually verified evidence exists. Each value must include a source label such as `licensed-source:<name>` or `manual-evidence:<name>` plus URL/date evidence. This is a last fallback, not a substitute for identity matching.
- `node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --title "<title>" --year <year> --search-only --discover-search`
  - Emits Rotten Tomatoes and Metacritic official search URLs and parses their official search pages into candidate official detail-page URLs when Wikidata has no critic-site external IDs. Search candidates and their visible snippets are never score evidence; use them only to find a same-title/same-year/same-season official page, then parse that confirmed page or saved HTML before writing a score. For saved search HTML, pass `--rotten-search-url <html>` or `--metacritic-search-url <html>`.
- `node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --url-hints <search-result-html-or-text> --search-only`
  - Extracts official Rotten Tomatoes and Metacritic detail-page URL candidates from generic browser/search-result text when official-site search or Wikidata discovery is incomplete. URL hints are discovery only; do not write search-result snippets or hinted visible scores. Confirm the title/year/scope and rerun with `--rotten-url <confirmed-url>` or `--metacritic-url <confirmed-url>`.

## Existing Repository Tools

- `node tools/film-ledger.mjs cycle --limit 3 --json`
  - Refreshes deferred intake reviews and due metadata reviews, then reports bounded intake, catalog-maintenance, production, and publication lanes. It does not query Notion.
  - Bounded start-of-cycle dashboard. Reopens due deferred intake reviews and refreshes due local catalog-maintenance tasks, then reports new-resource intake, catalog maintenance, playable production, and publication independently.

- `node tools/film-ledger.mjs queue --stage intake --limit 3 --json`
  - Lists newly discovered or changed sources that still need identity, duplicate, Notion-state, and routing analysis.
- `node tools/film-ledger.mjs queue --stage metadata --limit 3 --json`
  - Lists independent work-level metadata backfill/maintenance tasks. This queue remains meaningful even when production and publication queues are empty.
- `node tools/film-ledger.mjs complete-task --task <id> --failure-detail "backfill completed" --json`
  - Marks one intake/metadata task complete after readback evidence. Use the task reason for unresolved or deferred decisions rather than silently dropping the task.
- `node tools/film-ledger.mjs schedule-metadata --work-id <id> --failure-detail "refresh stale fields" [--next-review-at <ISO>] --json`
  - Reopens a completed work-level metadata task for a later repair or AI/rating refresh. Use this for old entries; it does not imply that playable media or Media Assets exist.
- `node tools/film-ledger.mjs update-source --source-id <id> --probe-path <json> --quality-state <state> --subtitle-evidence '<json>' --audio-evidence '<json>' --color-risk <state> --json`
  - Records source evidence discovered after identity binding without reopening the intake task. Use it for ffprobe, subtitle identity, audio labels, baked-caption checks, and HDR/Dolby Vision risk.
- `node tools/film-ledger.mjs attach-variant-source --variant <id> --source-id <id> --failure-detail "<evidence>" --json`
  - Repairs a legacy QC/publication variant whose source link is missing. It only permits a source already bound to the same work, refuses replacing a different existing source, and is idempotent. Use it after proving that an apparently unproduced source is actually represented by an existing variant; otherwise source-level candidate reports will repeatedly select completed work.
- `node tools/film-ledger.mjs rename-work --work-id <id> --canonical-title "<title>" --expected-current "<old title>" --json`
  - Keeps the local ledger identity aligned after an exact Notion/Douban title correction. The expected-current guard prevents a stale run from overwriting a newer title.
- `node tools/film-ledger.mjs split-source --source-id <collection-id> --members <members.json> --json`
  - Fans a collection, box set, or multi-ISO source into member sources. Each member must carry its own `workId` or remain an explicit pending intake member; the parent task closes only when every member is bound.
- `node tools/film-ledger.mjs task-status --json`
  - Reports local intake and metadata task counts without contacting Notion.
- `node tools/film-ledger.mjs status --json`
  - Reports the complete local workflow dashboard: intake, work-level metadata maintenance, playable production, publication/Media Assets, and the underlying production/publication state counts. An empty publication queue does not mean there is no new-resource or metadata work.
- `node tools/film-ledger.mjs retry-production --variant <id> --failure-detail "corrected filter or source decision"`
  - Reopens a `qc_failed` or deferred production candidate as `selected` after the failure cause has been corrected. It preserves the failure event and does not erase QC evidence.

- `npx tsx apps/api/src/notion-metadata-maintenance.ts --schema-only`
  - Preview managed metadata schema changes without scanning work pages. With `--apply`, rename legacy `Issue` to `Human Issue` in place and add missing managed fields including `AI Issue`, `Last AI Check Time`, `Workflow Status`, and `Workflow Note`. If both `Issue` and `Human Issue` already exist, preserve both for manual reconciliation instead of guessing.

- `node tools/notion-workflow-handoff.mjs schema|scan|claim|set`
  - Maintains the shared work-level collaboration channel without a recently-edited watcher. `schema` previews/applies only `Workflow Status` and `Workflow Note`; `scan` queries at most three AI-actionable states and mirrors known work-page IDs into SQLite; `claim --apply` re-reads and claims them as `AI 处理中`; `set` performs one validated transition and appends a timestamped actor note.
- `node tools/film-ledger.mjs queue --stage handoff --limit 3 --json`
  - Reads the mirrored local handoff queue. It contains only `待 AI 处理`, `已上传待 AI 收尾`, and `已确认待 AI 发布`; it does not call Notion.

- `node tools/film-ledger.mjs migrate-local-data --queue-state <state.json> [--queue-state <state.json> ...] --organizer-report <report.json> [--corrections <manifest.json>]`
  - One-time, explicit baseline import. Queue states create input roots and source discoveries only; they never auto-select work. Organizer reports register only explicit work/spec/episode page IDs and media block IDs. Review corrections require an exact output path and append a review event; they may repair `displayTitle`, `audioVariant`, `subtitleVariant`, or a guarded failed/deferred production state after stronger evidence overrides filename inference. Repeating the same correction is a no-op. This command is not a watcher and must not be run automatically.
- `node tools/film-ledger.mjs next --stage production --limit 5 --json`
  - Reads the bounded local production queue. `qc_passed` variants are excluded here to prevent duplicate encoding.
- `node tools/film-ledger.mjs import-production-manifest --production-manifest <manifest.json> --json`
  - Imports one already QC-verified local production manifest into the ledger. It records a `qc_passed` variant, its exact output/probe evidence, and its pre-created Notion destination. Reimport reuses the exact output path or exact work/spec/episode page target even when a legacy spec key or uploaded filename differs; it must not create a second variant for the same destination. Run this immediately after final local QC, before manual upload, so later production selection excludes the finished variant while Notion reconciliation waits for structure, media, and Media Assets evidence.
- `node tools/film-ledger.mjs merge-variant --variant <duplicate-id> --canonical-variant <canonical-id> --json`
  - Repairs an already-created local duplicate only when both variants belong to the same work and their registered Notion targets are identical. It preserves the canonical publication evidence, adopts the duplicate's stronger production evidence, moves local history, and records `variant_duplicate_merged`. Different Notion targets fail closed.
- `node tools/film-ledger.mjs adopt-existing-variant --variant <id> --output-path <file> --output-size <bytes> --probe-path <json> [--qc-artifact <image>] [--year <year>] --json`
  - Repairs an older migrated record only when it already has a registered Notion target and a newly verified local output. It advances that exact existing variant through QC, but clears any inherited media-block ID because a migrated ID is not proof that the required target spec still contains the matching media. `--year` fills a missing ledger year only; it rejects a conflicting existing year. Use it for completed legacy outputs, never to create a substitute for a missing source.
- `node tools/film-ledger.mjs handoff --limit 20 --json`
  - Reads only the local ledger and lists QC-passed outputs whose registered target has not yet verified a matching media block. Use the output as the manual-upload handoff: it includes the local file, exact work/spec/episode page IDs, expected filename, and current publication state. It never calls Notion or scans the library.
- `node tools/film-ledger.mjs reconcile-notion --limit 3 --json`
- `tools/film-cleanup-candidates.mjs`
  - Report only local playable outputs whose ledger state is `sync_ready`, whose path is inside the requested output root, and whose current byte size matches the recorded output size. It never deletes files; use the report as the handoff for explicit manual cleanup or a separately authorized deletion operation.
  - Inspects at most three due ledger targets by their recorded page IDs. There is no automatic full-database or recently-edited-page Notion watcher. Continue reconciliation until the four evidence gates produce `sync_ready`; `qc_passed` alone is not the final exit.
- `node tools/film-ledger.mjs register-target --variant <id> --work-page <id> --spec-page <id> [--episode-page <id>] [--expected-filename <name>] [--media-block-id <id>] --json`
  - Registers an exact destination. Use `--media-block-id` only after a human or bounded organizer inspection identifies the uploaded block; it allows a filename different from the local output to be reconciled without fuzzy matching.

- `tools/notion-upload-movie-video.mjs`
  - Upload a playable movie MP4 to an existing or target movie/spec page. Use `--page-id <movie-page-id> --target-title "<spec title>" --prepare-only --apply` before long encode or manual upload handoff to create or reuse an empty destination spec child page without requiring a finished file. Prepare-only fails when the exact target already contains video; inspect that existing playable asset instead of starting a duplicate encode. This is required for manual upload handoff because Notion API cannot move uploaded media blocks between pages.
- `tools/notion-upload-movie-package.mjs`
  - Create/update movie package structures and upload playable/source pieces when explicitly configured. Newly created work pages default to `Hide from Website=true`, `Needs Review=true`, and `Media Availability=needs_processing`; use the explicit gate flags only when a workflow has a better evidenced state. For large Notion uploads, preserve the generated upload manifest and command log so an interrupted run can resume parts instead of restarting.
- `tools/notion-upload-series-videos.mjs`
  - Upload episode playable files with series-aware mapping. It can also create a new series/season page, spec page, and missing episode pages when explicitly called with `--create --title <title> --create-episodes`; default existing-page behavior remains unchanged. Use `--prepare-only --apply` to create/reuse only the spec and episode page structure before long encode or manual upload handoff, with no file upload. Report the resulting episode page IDs so the user can upload each file to the correct episode page.
- `tools/notion-upload-series-source.mjs`
  - Handle series source package/upload flow when explicitly requested.
- `tools/notion-media-assets-audit.mjs`
  - Audit Notion pages for candidate playable/source Media Assets rows.
- `tools/notion-media-assets-write.mjs`
  - Write movie Media Assets rows from audited candidates. Prefer batch manifests with page IDs, expected-title guards, `mediaBlockId`/`expectedFilename` exact targets, and ffprobe-backed `metadata` overrides for production apply runs. The writer must not treat a playable row as permission to un-hide website visibility; playback/QC review remains separate.
- `tools/notion-manual-upload-organizer.mjs`
  - Explicit one-shot diagnostic for a user-specified page set. Inspect root-level manual video/file uploads, report incomplete structure, and prepare/verify target spec pages before manual upload. The report includes `suggestedTarget` page IDs for manual move/reupload destinations; series root uploads should point to episode child page IDs when episode numbers can be parsed.
  - A parent page's `last_edited_time` is not an upload index: media-block-only changes may leave it stale. Register the exact work/spec/episode page IDs in the ledger and inspect those targets directly. Do not launch this tool in a background loop or use recent/full library scans as an automatic watcher.
- `tools/notion-media-assets-write-series.mjs`
  - Write episode-aware series Media Assets rows from a series structure audit or the exact bounded report produced by `notion-manual-upload-organizer.mjs`. Reusing the organizer report avoids a second traversal of every episode page after manual-upload inspection. Use `--metadata-manifest <json>` when final `ffprobe` data should override filename-derived metadata for episode outputs. Use `--update-existing-missing` only when existing rows should be patched for empty structured fields from stronger evidence; it must not overwrite human values. The writer must not treat a playable episode row as permission to un-hide website visibility.
  - Use `--metadata-manifest <json> --correct-existing` only for exact, evidence-backed corrections to already matched rows. The manifest must declare `replaceExistingFields`; the writer permits only technical metadata fields and permanently protects Name, Work, Playback Verified, and Hide from Website. Always dry-run before `--apply`.
- `tools/notion-media-assets-stats.mjs`
  - Read-only Media Assets stats/readback.
- `tools/notion-media-assets-generate-batch.mjs`
  - Generate guarded batch manifests for missing Media Assets candidates.
- `tools/notion-media-assets-filter-batch.mjs`
  - Filter generated Media Assets batch manifests before applying.
- `tools/notion-media-assets-leftovers-report.mjs`
  - Summarize leftovers after batch processing.
- `tools/notion-media-assets-normalize-codec.mjs`
  - Normalize codec select values.
- `tools/notion-metadata-backfill.mjs`
  - Backfill work-level metadata, including Douban search/fetch/poster behavior and structured fields such as `Release Year`, `上映日期`, `Countries`, `Languages`, `Traditional Chinese Title (Taiwan)`, `Traditional Chinese Title (Hong Kong)`, `旨趣`, `外部类型原文`, `未映射类型`, `Runtime Minutes`, `Directors`, `Writers`, `Cast`, source/status/confidence, and update date. It does not write legacy `Release Date`.
- `tools/notion-create-work-page.mjs`
  - Create one explicit metadata-first movie/series work page after duplicate preflight. It is dry-run by default; use verified Chinese/English titles, year, and external IDs with `--apply`. It sets `Hide from Website=true`, `Needs Review=true`, and `Media Availability=needs_processing`; it does not create playable specs or Media Assets and must not be used for a broad library scan.
- `tools/notion-work-identity-correction.mjs`
  - Safely correct one existing work page's canonical title and structured Chinese/original title fields after a verified identity review. Use `--expected-current` and dry-run first; apply only after comparing the Douban display heading and existing media identity.
- `tools/notion-child-page-list.mjs`
  - Lists a work page's child-page structure without scanning or mutating media. Use `--top-level-only` to audit series spec naming before changing season, main-series, or edition labels.
- `tools/manual-douban-subject-update.mjs`
  - Manually apply explicit Douban Subject IDs and posters.
- `tools/omdb-inspect.mjs`
  - Inspect OMDb payloads.
- `node tools/notion-critic-rating-enrichment.mjs --page-id <page> --imdb-id <ttid>`
  - Dry-run/apply Notion critic-score fallback writes after OMDb. It fills only empty `烂番茄新鲜度` and `Metascore` from `critic-rating-inspect.mjs` results, appends source labels such as `rotten-tomatoes-page`, `metacritic-page`, `imdb-page-metascore`, `licensed-source:<name>`, or `manual-evidence:<name>`, and preserves official source URLs in `Developer Memo` without overwriting existing memo text. It also reuses official RT/Metacritic URLs already present in Notion URL/text fields or `Developer Memo`, so a confirmed page link can drive later fallback passes without passing `--rotten-url` or `--metacritic-url` again. Use explicit URL flags, `--imdb-url`, or `--ratings-json` when official URLs, saved official HTML, trusted exports, or manually verified evidence are already confirmed; use `--rotten-source-url`, `--metacritic-source-url`, or `--imdb-source-url` when the parse input is a saved HTML file and no official URL is already in Notion text. `--search-only` reports official search URLs but does not write scores. Later search-index parsing recognizes official RT/Metacritic URLs in Notion text as `externalIds.rottenTomatoes` and `externalIds.metacritic` for direct rating-badge links.
- `node tools/notion-critic-rating-enrichment.mjs --page-id <page> --search-only --discover-search`
  - Dry-runs official RT/Metacritic search candidate discovery from the page title/year when IDs and direct critic URLs are missing. `--discover-search` also works when the page has an IMDb ID: the tool still passes title/year so official search can cover missing Wikidata external IDs. The report's `searchDiscovery` block gives candidate official page URLs only; it does not write Notion score fields. After identity/scope confirmation, rerun with `--rotten-url <confirmed-url>` or `--metacritic-url <confirmed-url>`.
- `node tools/notion-critic-rating-enrichment.mjs --page-id <page> --url-hints <search-result-html-or-text> --search-only`
  - Dry-runs generic official URL hint extraction for a Notion page. Use this with saved search result/browser text when direct RT/Metacritic discovery fails. The report's `urlHints` block gives candidate official page URLs only; apply remains blocked until a confirmed official page or trusted structured evidence yields a parsed score.
- `npx tsx apps/api/src/notion-metadata-maintenance.ts --page-id <page> --pages --limit 1 --report <json>`
  - Initialize/repair identity fields such as `WW Work ID`, parsed external IDs, schema, match/status/source/confidence, and title-derived fields. Use `--apply` only after dry-run. It promotes `Metadata Status` to `verified` only after core identity, descriptive, poster, and AI advisory fields are present and issue fields are empty. Optional absent values such as TMDb, critic ratings, box office, regional titles, unmapped genres, and manual age overrides do not permanently force `partial`.
- `npx tsx apps/api/src/notion-omdb-enrichment.ts --page-id <page> --limit 1 --max-updates 1 --report <json>`
  - OMDb enrichment path for Notion metadata: ratings, `分级`, Metascore, Rotten Tomatoes, box office fields, and English structured metadata. Respect quota and environment requirements. Use direct `npx tsx` form when passing flags; root npm forwarding may treat flags as npm config.
- `npx tsx apps/api/src/notion-family-age-enrichment.ts --page-id <page> --limit 1 --max-updates 1 --report <json>`
  - AI advisory enrichment for `AI建议最低年龄`, `AI年龄建议置信度`, `内容风险标签`, and `AI年龄建议理由`. Run after sourced metadata exists. Use `--apply` only after preview.
  - After stronger metadata is added, rerun one exact page with `--page-id <page> --refresh`; broad refresh is rejected. A successful refresh may clear only the tool's own resolved `AI 年龄建议待复核` issue and never touches `Human Issue` or unrelated AI findings.
  - Pages explicitly marked as old media carriers, old duplicates, or old invalid structures are skipped by default so advisory work is spent on canonical work pages. Use `--include-legacy-pages` only for an intentional exception.
  - For repeated batches, create one local candidate cache with `--write-candidate-cache .local-data/family-age-candidates.json`, then run later batches with `--candidate-cache` and the default local JSONL progress file. This avoids repeating a full Notion data-source scan for every batch and reduces rate-limit pressure.
  - Each successful progress record must retain the page ID, title, updated fields, and complete AI advisory result. A terminated batch can then be audited locally without rereading every completed Notion page.
- `apps/api/src/notion-metadata-audit.ts`
  - Audit metadata completeness and source expectations.
- `apps/api/src/notion-metadata-maintenance.ts`
  - Maintenance path for normalized Notion metadata fields.

Run each tool with `--help` or inspect its usage block before applying. Many tools default to dry-run and require `--apply` for mutation.

## Upload Notes

- Preserve `.local-data/notion-*-upload-*.json` manifests and command logs. If a Notion multipart upload is interrupted, rerun the same command before the upload object expires so it resumes from `sentParts + 1`.
- Large playable uploads can be route-limited. A 0.44GB test upload took about 25 minutes in one run, so set command timeouts from observed throughput rather than file size alone.
