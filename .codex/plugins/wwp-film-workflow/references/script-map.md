# WWP Script Map

Use plugin helper scripts for generic media mechanics and existing repository tools for WWP Notion schema operations.

## Plugin Helpers

- `node .codex/plugins/wwp-film-workflow/scripts/scan-input-directory.mjs --root <input-dir> --output <scan.json>`
  - Summarizes top-level candidate folders, largest media files, subtitle sidecars, NFOs, and filename-derived flags before heavy probing.
- `node .codex/plugins/wwp-film-workflow/scripts/watch-input-directory.mjs --root <input-dir> --state <state.json> --once`
  - Compares the latest scan with a saved state file and reports new, removed, or changed queue entries. It also accepts positional `root state output` arguments for npm-forwarding edge cases. Use `--interval-sec <seconds>` only when an active monitoring loop is desired.
- `node .codex/plugins/wwp-film-workflow/scripts/probe-media.mjs --input <media> --output <json>`
  - Runs `ffprobe` and writes structured JSON for source/final media.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .codex/plugins/wwp-film-workflow/scripts/make-qc-contact-sheet.ps1 -InputPath <media> -Output <png>`
  - Runs `ffmpeg` to create a contact sheet from evenly spaced timestamps.
- `node .codex/plugins/wwp-film-workflow/scripts/plan-stream-variants.mjs --matrix <json>`
  - Explains which planned variants need video encode, audio encode, remux, or cannot reuse streams.

## Existing Repository Tools

- `tools/notion-upload-movie-video.mjs`
  - Upload a playable movie MP4 to an existing or target movie/spec page. Use `--page-id <movie-page-id> --target-title "<spec title>" --prepare-only --apply` before long encode or manual upload handoff to create or reuse the destination spec child page without requiring a finished file.
- `tools/notion-upload-movie-package.mjs`
  - Create/update movie package structures and upload playable/source pieces when explicitly configured. Newly created work pages default to `Hide from Website=true`, `Needs Review=true`, and `Media Availability=needs_processing`; use the explicit gate flags only when a workflow has a better evidenced state. For large Notion uploads, preserve the generated upload manifest and command log so an interrupted run can resume parts instead of restarting.
- `tools/notion-upload-series-videos.mjs`
  - Upload episode playable files with series-aware mapping. It can also create a new series/season page, spec page, and missing episode pages when explicitly called with `--create --title <title> --create-episodes`; default existing-page behavior remains unchanged. Use `--prepare-only --apply` to create/reuse only the spec and episode page structure before long encode or manual upload handoff, with no file upload.
- `tools/notion-upload-series-source.mjs`
  - Handle series source package/upload flow when explicitly requested.
- `tools/notion-media-assets-audit.mjs`
  - Audit Notion pages for candidate playable/source Media Assets rows.
- `tools/notion-media-assets-write.mjs`
  - Write movie Media Assets rows from audited candidates. Prefer batch manifests with page IDs, expected-title guards, and ffprobe-backed `metadata` overrides for production apply runs. The writer must not treat a playable row as permission to un-hide website visibility; playback/QC review remains separate.
- `tools/notion-manual-upload-organizer.mjs`
  - Inspect recently edited pages for root-level manual video/file uploads, report incomplete structure, and prepare/verify target spec pages before manual upload. The report includes `suggestedTarget` page IDs for moving root media; series root uploads should point to episode child page IDs when episode numbers can be parsed. Use this before Media Assets writes when manual uploads may have landed on the work page root.
- `tools/notion-media-assets-write-series.mjs`
  - Write episode-aware series Media Assets rows. Use `--metadata-manifest <json>` when final `ffprobe` data should override filename-derived metadata for episode outputs. The writer must not treat a playable episode row as permission to un-hide website visibility.
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
