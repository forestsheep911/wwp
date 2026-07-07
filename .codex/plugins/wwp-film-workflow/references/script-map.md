# WWP Script Map

Use plugin helper scripts for generic media mechanics and existing repository tools for WWP Notion schema operations.

## Plugin Helpers

- `node .codex/plugins/wwp-film-workflow/scripts/scan-input-directory.mjs --root <input-dir> --output <scan.json>`
  - Summarizes top-level candidate folders, largest media files, subtitle sidecars, NFOs, and filename-derived flags before heavy probing.
- `node .codex/plugins/wwp-film-workflow/scripts/probe-media.mjs --input <media> --output <json>`
  - Runs `ffprobe` and writes structured JSON for source/final media.
- `powershell -NoProfile -ExecutionPolicy Bypass -File .codex/plugins/wwp-film-workflow/scripts/make-qc-contact-sheet.ps1 -InputPath <media> -Output <png>`
  - Runs `ffmpeg` to create a contact sheet from evenly spaced timestamps.
- `node .codex/plugins/wwp-film-workflow/scripts/plan-stream-variants.mjs --matrix <json>`
  - Explains which planned variants need video encode, audio encode, remux, or cannot reuse streams.

## Existing Repository Tools

- `tools/notion-upload-movie-video.mjs`
  - Upload a playable movie MP4 to an existing or target movie/spec page.
- `tools/notion-upload-movie-package.mjs`
  - Create/update movie package structures and upload playable/source pieces when explicitly configured. For large Notion uploads, preserve the generated upload manifest and command log so an interrupted run can resume parts instead of restarting.
- `tools/notion-upload-series-videos.mjs`
  - Upload episode playable files with series-aware mapping. It can also create a new series/season page, spec page, and missing episode pages when explicitly called with `--create --title <title> --create-episodes`; default existing-page behavior remains unchanged.
- `tools/notion-upload-series-source.mjs`
  - Handle series source package/upload flow when explicitly requested.
- `tools/notion-media-assets-audit.mjs`
  - Audit Notion pages for candidate playable/source Media Assets rows.
- `tools/notion-media-assets-write.mjs`
  - Write movie Media Assets rows from audited candidates. Prefer batch manifests with page IDs, expected-title guards, and ffprobe-backed `metadata` overrides for production apply runs.
- `tools/notion-media-assets-write-series.mjs`
  - Write episode-aware series Media Assets rows. Use `--metadata-manifest <json>` when final `ffprobe` data should override filename-derived metadata for episode outputs.
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
  - Backfill work-level metadata, including Douban search/fetch/poster behavior.
- `tools/manual-douban-subject-update.mjs`
  - Manually apply explicit Douban Subject IDs and posters.
- `tools/omdb-inspect.mjs`
  - Inspect OMDb payloads.
- `apps/api/src/notion-omdb-enrichment.ts`
  - OMDb enrichment path for Notion metadata; respect quota and environment requirements.
- `apps/api/src/notion-metadata-audit.ts`
  - Audit metadata completeness and source expectations.
- `apps/api/src/notion-metadata-maintenance.ts`
  - Maintenance path for normalized Notion metadata fields.

Run each tool with `--help` or inspect its usage block before applying. Many tools default to dry-run and require `--apply` for mutation.

## Upload Notes

- Preserve `.local-data/notion-*-upload-*.json` manifests and command logs. If a Notion multipart upload is interrupted, rerun the same command before the upload object expires so it resumes from `sentParts + 1`.
- Large playable uploads can be route-limited. A 0.44GB test upload took about 25 minutes in one run, so set command timeouts from observed throughput rather than file size alone.
