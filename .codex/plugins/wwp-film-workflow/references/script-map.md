# WWP Script Map

Use plugin helper scripts for generic media mechanics and existing repository tools for WWP Notion schema operations.

## Plugin Helpers

- `node .codex/plugins/wwp-film-workflow/scripts/scan-input-directory.mjs --root <input-dir> --output <scan.json>`
  - Summarizes top-level candidate folders, largest media files, subtitle sidecars, NFOs, and filename-derived flags before heavy probing.
- `node .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.mjs --root <input-dir> --state <state.json> --once`
  - Compares the latest scan with a saved state file and reports new, removed, or changed queue entries. Pass `--ledger .local-data/wwp-film-workflow.sqlite` so every scan writes source discoveries to the local ledger before the JSON baseline is replaced. It also accepts positional `root state output` arguments for npm-forwarding edge cases. Use `--interval-sec <seconds>` only when an active monitoring loop is desired.
- `node .codex/plugins/wwp-film-workflow/scripts/probe-media.mjs --input <media> --output <json>`
  - Runs `ffprobe` and writes structured JSON for source/final media.
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

- `npx tsx apps/api/src/notion-metadata-maintenance.ts --schema-only`
  - Preview managed metadata schema changes without scanning work pages. With `--apply`, rename legacy `Issue` to `Human Issue` in place and add missing `AI Issue` and `Last AI Check Time`. If both `Issue` and `Human Issue` already exist, preserve both for manual reconciliation instead of guessing.

- `node tools/film-ledger.mjs migrate-local-data --queue-state <state.json> [--queue-state <state.json> ...] --organizer-report <report.json> [--corrections <manifest.json>]`
  - One-time, explicit baseline import. Queue states create input roots and source discoveries only; they never auto-select work. Organizer reports register only explicit work/spec/episode page IDs and media block IDs. Human corrections require an exact output path and append a review event. This command is not a watcher and must not be run automatically.
- `node tools/film-ledger.mjs next --stage production --limit 5 --json`
  - Reads the bounded local production queue. `qc_passed` variants are excluded here to prevent duplicate encoding.
- `node tools/film-ledger.mjs import-production-manifest --production-manifest <manifest.json> --json`
  - Imports one already QC-verified local production manifest into the ledger. It records a `qc_passed` variant, its exact output/probe evidence, and its pre-created Notion destination; repeated import of the same destination is idempotent. Run this immediately after final local QC, before manual upload, so later production selection excludes the finished variant while Notion reconciliation waits for structure, media, and Media Assets evidence.
- `node tools/film-ledger.mjs adopt-existing-variant --variant <id> --output-path <file> --output-size <bytes> --probe-path <json> [--qc-artifact <image>] [--year <year>] --json`
  - Repairs an older migrated record only when it already has a registered Notion target and a newly verified local output. It advances that exact existing variant through QC, but clears any inherited media-block ID because a migrated ID is not proof that the required target spec still contains the matching media. `--year` fills a missing ledger year only; it rejects a conflicting existing year. Use it for completed legacy outputs, never to create a substitute for a missing source.
- `node tools/film-ledger.mjs handoff --limit 20 --json`
  - Reads only the local ledger and lists QC-passed outputs whose registered target has not yet verified a matching media block. Use the output as the manual-upload handoff: it includes the local file, exact work/spec/episode page IDs, expected filename, and current publication state. It never calls Notion or scans the library.
- `node tools/film-ledger.mjs reconcile-notion --limit 3 --json`
  - Inspects at most three due ledger targets by their recorded page IDs. There is no automatic full-database or recently-edited-page Notion watcher. Continue reconciliation until the four evidence gates produce `sync_ready`; `qc_passed` alone is not the final exit.

- `tools/notion-upload-movie-video.mjs`
  - Upload a playable movie MP4 to an existing or target movie/spec page. Use `--page-id <movie-page-id> --target-title "<spec title>" --prepare-only --apply` before long encode or manual upload handoff to create or reuse the destination spec child page without requiring a finished file. This is required for manual upload handoff because Notion API cannot move uploaded media blocks between pages.
- `tools/notion-upload-movie-package.mjs`
  - Create/update movie package structures and upload playable/source pieces when explicitly configured. Newly created work pages default to `Hide from Website=true`, `Needs Review=true`, and `Media Availability=needs_processing`; use the explicit gate flags only when a workflow has a better evidenced state. For large Notion uploads, preserve the generated upload manifest and command log so an interrupted run can resume parts instead of restarting.
- `tools/notion-upload-series-videos.mjs`
  - Upload episode playable files with series-aware mapping. It can also create a new series/season page, spec page, and missing episode pages when explicitly called with `--create --title <title> --create-episodes`; default existing-page behavior remains unchanged. Use `--prepare-only --apply` to create/reuse only the spec and episode page structure before long encode or manual upload handoff, with no file upload. Report the resulting episode page IDs so the user can upload each file to the correct episode page.
- `tools/notion-upload-series-source.mjs`
  - Handle series source package/upload flow when explicitly requested.
- `tools/notion-media-assets-audit.mjs`
  - Audit Notion pages for candidate playable/source Media Assets rows.
- `tools/notion-media-assets-write.mjs`
  - Write movie Media Assets rows from audited candidates. Prefer batch manifests with page IDs, expected-title guards, and ffprobe-backed `metadata` overrides for production apply runs. The writer must not treat a playable row as permission to un-hide website visibility; playback/QC review remains separate.
- `tools/notion-manual-upload-organizer.mjs`
  - Explicit one-shot diagnostic for a user-specified page set. Inspect root-level manual video/file uploads, report incomplete structure, and prepare/verify target spec pages before manual upload. The report includes `suggestedTarget` page IDs for manual move/reupload destinations; series root uploads should point to episode child page IDs when episode numbers can be parsed.
  - A parent page's `last_edited_time` is not an upload index: media-block-only changes may leave it stale. Register the exact work/spec/episode page IDs in the ledger and inspect those targets directly. Do not launch this tool in a background loop or use recent/full library scans as an automatic watcher.
- `tools/notion-media-assets-write-series.mjs`
  - Write episode-aware series Media Assets rows. Use `--metadata-manifest <json>` when final `ffprobe` data should override filename-derived metadata for episode outputs. Use `--update-existing-missing` only when existing rows should be patched for empty structured fields from stronger evidence; it must not overwrite human values. The writer must not treat a playable episode row as permission to un-hide website visibility.
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
  - Initialize/repair identity fields such as `WW Work ID`, parsed external IDs, schema, match/status/source/confidence, and title-derived fields. Use `--apply` only after dry-run.
- `npx tsx apps/api/src/notion-omdb-enrichment.ts --page-id <page> --limit 1 --max-updates 1 --report <json>`
  - OMDb enrichment path for Notion metadata: ratings, `分级`, Metascore, Rotten Tomatoes, box office fields, and English structured metadata. Respect quota and environment requirements. Use direct `npx tsx` form when passing flags; root npm forwarding may treat flags as npm config.
- `npx tsx apps/api/src/notion-family-age-enrichment.ts --page-id <page> --limit 1 --max-updates 1 --report <json>`
  - AI advisory enrichment for `AI建议最低年龄`, `AI年龄建议置信度`, `内容风险标签`, and `AI年龄建议理由`. Run after sourced metadata exists. Use `--apply` only after preview.
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
