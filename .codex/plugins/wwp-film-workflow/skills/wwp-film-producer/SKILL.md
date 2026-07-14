---
name: wwp-film-producer
description: Use when coordinating WWP film or series production, choosing the next workflow step, or routing between source scanning, encoding, Notion publishing, Media Assets, source archives, and metadata backfill. The Chinese command "开始制作影视库" is an explicit request to start the complete autonomous workflow.
---

# WWP Film Producer

Coordinate WWP film work end to end. Load this first when the user asks to make, continue, publish, repair, or summarize a film/series production task.

## Start Command

Treat the exact phrase `开始制作影视库` as the end-to-end start command. Do not ask the user to restate the workflow.

1. Read enabled input roots and pending work from `.local-data/wwp-film-workflow.sqlite`. If the ledger has no enabled input root, use a directory explicitly supplied in the same request; ask for one only when neither source exists.
2. Scan/import the roots, then select a bounded production batch with `node tools/film-ledger.mjs next --stage production --limit 5 --json`.
3. Start work-page creation and metadata backfill as soon as a scanned work is identified. Run independent metadata, destination-page preparation, encoding, and QC work concurrently when practical.
4. Continue through destination structure, playable production, upload handoff, Media Assets, and targeted readback. Reconcile at most three registered Notion targets per run.
5. Record uncertain or deferred decisions and continue with other candidates instead of interrupting the batch. Ask only when a decision blocks every useful next action or requires user-only evidence/action.
6. Treat `qc_passed` as production complete but publication pending. Treat only `sync_ready` as final completion.

## Targeted Recent-Item Checks

- Do not run a global Notion scan just to audit historical spec titles or page structure. Notion API rate limits make that an invalid default workflow.
- After a production, rename, structure preparation, or manual-upload handoff, inspect only the recent items touched by that run, with a default maximum of 3 exact work/spec targets.
- Check those targets for per-episode size naming, language/audio labels, duplicate specs, and root-level media placement. Leave older untouched items for later user-directed repair; an incomplete historical audit is acceptable.
- Prefer exact page IDs recorded in the local ledger. Do not substitute a broad title search or watcher scan when the target IDs are already known.

## Route

- New input directory or "which one should we do": use `wwp-film-candidate-selector`.
- Playable transcode, subtitles, audio variants, QC, or output files: use `wwp-playable-encoder`.
- Series, seasons, episodes, SxxEyy mapping, or episode pages: use `wwp-series-producer`.
- Upload playable files or create/update Notion work/spec pages: use `wwp-notion-publisher`.
- "I uploaded some videos/source myself", recent uploads, or missing Media Assets: use `wwp-media-assets-backfiller`.
- Source/original-disc packaging, source-only pages, 7z volumes, or manual/API source upload: use `wwp-source-archive-operator`.
- Missing film-level metadata, Douban/OMDb/poster/basic info, or AI advisory fields: use `wwp-metadata-backfiller`.

## Default Flow

1. Resolve the input directory from the current request or enabled ledger roots. Do not assume a historical path is fixed.
2. Select candidates by value, source quality, Chinese subtitle availability, Notion state, and production risk.
3. For scanned works missing from Notion, create/reuse the work page and start work-level metadata even when playable production is blocked, deferred, or not yet valuable. A library metadata entry is useful on its own; video asset quality and playback readiness are separate Media Assets concerns.
4. For accepted playable candidates, create or reuse the Notion work page and intended destination pages before long encode/upload work when they are missing. Notion's API cannot move uploaded media blocks between pages in this workflow, so destination preparation is mandatory, not optional. Movie uploads need a spec child page. Series uploads need a spec page plus episode child pages. When manual upload is likely, report the target title and page ID before encoding starts so the user can upload the finished file to the correct child page rather than the work-page root.
5. Start work-level metadata backfill immediately after the work page exists: identity maintenance, Douban, OMDb when IMDb exists, AI family-age after sourced fields, and TMDb only when credentials or trusted hints exist. Let metadata backfill run while encoding, QC, or upload continues when the tasks do not depend on each other.
6. Produce playable MP4 variants into the user-specified output directory, or `E:\video_made` when none is specified.
7. Run probe/QC before upload.
8. Publish playable output to Notion, then write Media Assets from `ffprobe` and production manifests.
9. Run any remaining metadata enrichment, including AI advisory fields, when the work page is still incomplete after sourced metadata.
10. Report IDs, output paths, Media Assets state, metadata state, skipped items, and any deferred user decisions.

## Guardrails

- Existing Notion works should be reused; do not create duplicate work pages for supplemental specs.
- Before creating any work page, run the multi-alias identity preflight in `../../references/work-title-identity-rules.md`. Search Chinese, English, original, regional, filename/source, season, yearless, and temporary-title forms plus all known external IDs. A weak or noncanonical old title is still an existing work and must be repaired instead of duplicated.
- Canonicalize work titles from the verified Douban display title when available; otherwise use a verified authoritative fallback and include the foreign/original title and release year. Title cleanup is independent from playable readiness.
- Spec backfill can be as important as new-film creation when the existing specs are weak.
- Metadata collection is not gated by playable readiness. If a scanned work is worth cataloging, create or repair its work-level metadata even when no video is ready to upload.
- Do not block work-page creation and sourced metadata backfill on video upload readiness. Playable Media Assets rows still require real uploaded/probed media evidence.
- Avoid root-level manual upload cleanup by preparing the page structure early. Because uploaded media blocks cannot be moved by Notion API, a planned movie encode must have a target spec child page, and a planned series encode must have a target spec page plus episode child pages, before the user is expected to upload files manually. If the target pages cannot be prepared, do not invite manual upload yet.
- Source/original-disc upload is not the default playable production path.
- Do not claim completion until Notion or Media Assets readback proves the external state.

## References

- Selection and value rules: `../../references/decision-rules.md`
- Encoding and stream reuse rules: `../../references/encoding-rules.md`
- Notion and Media Assets rules: `../../references/notion-media-assets.md`
- Metadata sources: `../../references/metadata-sources.md`
- Script inventory: `../../references/script-map.md`
- Work title and duplicate prevention: `../../references/work-title-identity-rules.md`
