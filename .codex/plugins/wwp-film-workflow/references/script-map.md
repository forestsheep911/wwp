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
  - Parses official Rotten Tomatoes and Metacritic pages for critic scores when OMDb is missing stale critic fields. Rotten Tomatoes parsing supports `media-scorecard-json`, `<score-board>`, and official JSON-LD `AggregateRating`; Metacritic parsing supports current `global-score-value`, legacy `metascore_w`, and official JSON-LD `AggregateRating`. It also accepts `--imdb-id <ttid>` to discover official page URLs through Wikidata before parsing. Use confirmed official page URLs, saved official-page HTML, or Wikidata-discovered official URLs; do not apply title-search guesses without verifying title/year/page identity.
- `node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --imdb-url <url-or-html>`
  - Parses IMDb official title-page HTML for displayed Metascore when OMDb/Metacritic direct-page paths are missing or stale. Record this as `imdb-page-metascore`; do not use it for Rotten Tomatoes.
- `node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --ratings-json <trusted-evidence.json>`
  - Reads trusted structured fallback values for Rotten Tomatoes and Metascore when official lookups are blocked but licensed export data or manually verified evidence exists. Each value must include a source label such as `licensed-source:<name>` or `manual-evidence:<name>` plus URL/date evidence. This is a last fallback, not a substitute for identity matching.
- `node .codex/plugins/wwp-film-workflow/scripts/critic-rating-inspect.mjs --title "<title>" --year <year> --search-only`
  - Emits Rotten Tomatoes and Metacritic official search URLs for candidate discovery when Wikidata has no critic-site external IDs. Search output is never score evidence; use it only to find a same-title/same-year official page, then parse that confirmed page or saved HTML before writing a score.

## Existing Repository Tools

- `node tools/film-ledger.mjs migrate-local-data --queue-state <state.json> [--queue-state <state.json> ...] --organizer-report <report.json> [--corrections <manifest.json>]`
  - One-time, explicit baseline import. Queue states create input roots and source discoveries only; they never auto-select work. Organizer reports register only explicit work/spec/episode page IDs and media block IDs. Human corrections require an exact output path and append a review event. This command is not a watcher and must not be run automatically.
- `node tools/film-ledger.mjs next --stage production --limit 5 --json`
  - Reads the bounded local production queue. `qc_passed` variants are excluded here to prevent duplicate encoding.
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
  - Explicit one-shot diagnostic for a user-specified page set. Inspect root-level manual video/file uploads, report incomplete structure, and prepare/verify target spec pages before manual upload. The report includes `suggestedTarget` page IDs for manual move/reupload destinations; series root uploads should point to episode child page IDs when episode numbers can be parsed. Do not launch this tool in a background loop and do not use its recent-page mode as an automatic watcher. Unknown manual uploads must first be identified by a human and registered with exact work/spec/episode page IDs in the ledger.
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
- `tools/manual-douban-subject-update.mjs`
  - Manually apply explicit Douban Subject IDs and posters.
- `tools/omdb-inspect.mjs`
  - Inspect OMDb payloads.
- `node tools/notion-critic-rating-enrichment.mjs --page-id <page> --imdb-id <ttid>`
  - Dry-run/apply Notion critic-score fallback writes after OMDb. It fills only empty `烂番茄新鲜度` and `Metascore` from `critic-rating-inspect.mjs` results, appends source labels such as `rotten-tomatoes-page`, `metacritic-page`, `imdb-page-metascore`, `licensed-source:<name>`, or `manual-evidence:<name>`, and writes an evidence memo when the memo field is empty. Use `--rotten-url`, `--metacritic-url`, `--imdb-url`, or `--ratings-json` when official URLs, saved official HTML, trusted exports, or manually verified evidence are already confirmed. `--search-only` reports official search URLs but does not write scores.
- `npx tsx apps/api/src/notion-metadata-maintenance.ts --page-id <page> --pages --limit 1 --report <json>`
  - Initialize/repair identity fields such as `WW Work ID`, parsed external IDs, schema, match/status/source/confidence, and title-derived fields. Use `--apply` only after dry-run.
- `npx tsx apps/api/src/notion-omdb-enrichment.ts --page-id <page> --limit 1 --max-updates 1 --report <json>`
  - OMDb enrichment path for Notion metadata: ratings, `分级`, Metascore, Rotten Tomatoes, box office fields, and English structured metadata. Respect quota and environment requirements. Use direct `npx tsx` form when passing flags; root npm forwarding may treat flags as npm config.
- `npx tsx apps/api/src/notion-family-age-enrichment.ts --page-id <page> --limit 1 --max-updates 1 --report <json>`
  - AI advisory enrichment for `AI建议最低年龄`, `AI年龄建议置信度`, `内容风险标签`, and `AI年龄建议理由`. Run after sourced metadata exists. Use `--apply` only after preview.
- `apps/api/src/notion-metadata-audit.ts`
  - Audit metadata completeness and source expectations.
- `apps/api/src/notion-metadata-maintenance.ts`
  - Maintenance path for normalized Notion metadata fields.

Run each tool with `--help` or inspect its usage block before applying. Many tools default to dry-run and require `--apply` for mutation.

## Upload Notes

- Preserve `.local-data/notion-*-upload-*.json` manifests and command logs. If a Notion multipart upload is interrupted, rerun the same command before the upload object expires so it resumes from `sentParts + 1`.
- Large playable uploads can be route-limited. A 0.44GB test upload took about 25 minutes in one run, so set command timeouts from observed throughput rather than file size alone.
