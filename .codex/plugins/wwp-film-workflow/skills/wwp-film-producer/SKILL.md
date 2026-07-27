---
name: wwp-film-producer
description: Use when coordinating WWP film or series production, choosing the next workflow step, or routing between source scanning, encoding, Notion publishing, Media Assets, source archives, and metadata backfill. The Chinese command "开始制作影视库" is an explicit request to start the complete autonomous workflow.
---

# WWP Film Producer

Coordinate WWP film work end to end. Load this first when the user asks to make, continue, publish, repair, or summarize a film/series production task. The complete cycle contract is in `../../references/workflow-cycle.md`.

## Start Command

Treat the exact phrase `开始制作影视库` as the end-to-end start command. Do not ask the user to restate the workflow.

1. Read enabled input roots and pending work from `.local-data/wwp-film-workflow.sqlite`. If the ledger has no enabled input root, use a directory explicitly supplied in the same request; ask for one only when neither source exists.
2. Run `node tools/notion-workflow-handoff.mjs scan --limit 3 --json` to mirror only explicit AI-actionable handoffs, then run `node tools/film-ledger.mjs cycle --limit 3 --json`. Do not use Notion parent timestamps or a broad watcher.
3. Claim a bounded actionable handoff before changing it, following `../../references/workflow-handoff.md`. Continue the other workflow lanes after the handoff batch.
4. For each bounded batch, identify new resources and existing works needing metadata/spec repair before selecting playable production. Start work-page creation and metadata backfill as soon as a scanned work is identified. Run independent metadata, destination-page preparation, encoding, and QC work concurrently when practical.
5. Continue through destination structure, playable production, upload handoff, Media Assets, and targeted readback. Reconcile at most three registered Notion targets per run. Media-block reconciliation is only the publication lane, not the workflow trigger or completion test.
6. Record uncertain or deferred decisions and continue with other candidates instead of interrupting the batch. Ask only when a decision blocks every useful next action or requires user-only evidence/action.
7. Treat `qc_passed` as production complete but publication pending. Treat only `sync_ready` as final playable completion; set `Workflow Status=已完成` only after the current requested cycle is read back.

## Targeted Recent-Item Checks

- Do not run a global Notion scan just to audit historical spec titles or page structure. Notion API rate limits make that an invalid default workflow.
- After a production, rename, structure preparation, or manual-upload handoff, inspect only the recent items touched by that run, with a default maximum of 3 exact work/spec targets.
- Check those targets for per-collection size naming, language/audio labels, duplicate specs, overlapping episode ranges, and root-level media placement. Leave older untouched items for later user-directed repair; an incomplete historical audit is acceptable.
- Prefer exact page IDs recorded in the local ledger. Do not substitute a broad title search or watcher scan when the target IDs are already known.

## Route

- New input directory, queue discovery, or "which one should we do": use `wwp-film-intake` and then `wwp-film-candidate-selector`.
- Existing work pages needing fields, identity repair, or AI advisory refresh: use `wwp-library-maintainer` and `wwp-metadata-backfiller`.
- Playable transcode, subtitles, audio variants, QC, or output files: use `wwp-playable-encoder`.
- Series, seasons, episodes, SxxEyy mapping, or episode pages: use `wwp-series-producer`.
- Upload playable files or create/update Notion work/spec pages: use `wwp-notion-publisher`.
- "I uploaded some videos/source myself", recent uploads, or missing Media Assets: use `wwp-media-assets-backfiller`.
- Source/original-disc packaging, source-only pages, 7z volumes, or manual/API source upload: use `wwp-source-archive-operator`.
- Missing film-level metadata, Douban/OMDb/poster/basic info, or AI advisory fields: use `wwp-metadata-backfiller`.

## Default Flow

1. Resolve the input directory from the current request or enabled ledger roots. Do not assume a historical path is fixed.
2. Scan/import new or changed sources into SQLite and work from the bounded intake queue. A scan is not an encode decision.
3. Identify works, perform duplicate/alias preflight, and create/reuse metadata work pages. Metadata tasks are high priority even when playable production is blocked or deferred.
4. Process a small metadata-maintenance batch independently: repair identity, fill sourced fields, run AI advisory fields, and record unresolved issues. This includes old catalog entries with missing or stale fields, not only newly discovered works. Do not stop because no media block is waiting.
5. Select playable candidates by value, source quality, Chinese subtitle availability, Notion state, and production risk.
6. For accepted playable candidates, create or reuse the Notion work page and intended destination pages before long encode/upload work when they are missing. Confirm that a reused destination does not already contain a materially equivalent playable video; preparation must fail closed when the exact movie spec is occupied. Notion's API cannot move uploaded media blocks between pages in this workflow, so destination preparation is mandatory, not optional. Movie uploads need an empty spec child page. Series uploads need a spec page plus size-bounded episode-range child pages. When manual upload is likely, report the target title and page ID before encoding starts so the user can upload the finished file to the correct child page rather than the work-page root.
7. Produce playable MP4 variants into the user-specified output directory, or `E:\video_made` when none is specified.
8. Run probe/QC before upload.
9. Publish playable output to Notion, then write Media Assets from `ffprobe` and production manifests.
10. Revisit remaining metadata tasks while uploads or encodes wait; publication is only one queue.
11. Report intake, catalog maintenance, production, upload, Media Assets, website-sync, and deferred-decision states separately. `node tools/film-ledger.mjs cycle --limit 3 --json` is the bounded start-of-cycle dashboard; Media Assets is only the publication reconciliation substage.

## Round-Robin Continuation Rule

Every execution cycle must treat these as parallel work lanes, in this order:

1. **Collaboration handoff**: mirror and claim at most three explicit actionable `Workflow Status` rows. Ignore `人工上传中`; `已上传待 AI 收尾` is the manual-upload completion signal.
2. **Intake**: inspect a small batch of newly discovered or changed source directories, resolve identity and duplicate risk, bind each source, and create its work-level metadata task.
3. **Metadata maintenance**: process a small batch of new and old work pages independently of playback. Fill sourced fields, repair canonical identity, generate AI advisory values after sourced data is coherent, and record unresolved `AI Issue` items.
4. **Production**: select only candidates that pass source, Chinese-subtitle, language, quality, value, and risk rules; prepare the destination structure before encoding.
5. **Publication and Media Assets**: reconcile only bounded exact targets. A missing upload is a pending handoff, not a reason to stop the other lanes.
6. **Source/archive and deferred maintenance**: retain blocked, user-decision, source-only, cleanup, and later-backfill tasks with reasons and next-review times; do not silently discard them.

The cycle may end only after these work areas have been checked and the next bounded batch is recorded. `publication` being empty, or all current media blocks being accounted for, never means the overall film-library workflow is complete while intake, catalog maintenance, source/archive follow-up, or `metadata_backfill` review is still due. For the full stop criteria, read `../../references/workflow-cycle.md`.

## Guardrails

- Existing Notion works should be reused; do not create duplicate work pages for supplemental specs.
- Before creating any work page, run the multi-alias identity preflight in `../../references/work-title-identity-rules.md`. Search Chinese, English, original, regional, filename/source, season, yearless, and temporary-title forms plus all known external IDs. A weak or noncanonical old title is still an existing work and must be repaired instead of duplicated.
- Canonicalize work titles from the verified Douban display title when available; otherwise use a verified authoritative fallback and include the foreign/original title and release year. Title cleanup is independent from playable readiness.
- Spec backfill can be as important as new-film creation when the existing specs are weak.
- Metadata collection is not gated by playable readiness. If a scanned work is worth cataloging, create or repair its work-level metadata even when no video is ready to upload.
- Do not block work-page creation and sourced metadata backfill on video upload readiness. Playable Media Assets rows still require real uploaded/probed media evidence.
- Avoid root-level manual upload cleanup by preparing the page structure early. Because uploaded media blocks cannot be moved by Notion API, a planned movie encode must have a target spec child page, and a planned series encode must have a target spec page plus episode-range child pages, before the user is expected to upload files manually. If the target pages cannot be prepared, do not invite manual upload yet.
- Source/original-disc upload is not the default playable production path.
- A deferred production decision must not be reconsidered every cycle. Keep it
  visible in status, but only select it again after its `next_review_at` is due
  or after an explicit human retry.
- An empty production queue does not mean the workflow is idle. Check `queue --stage intake` and `queue --stage metadata` before stopping.
- Do not claim completion until Notion or Media Assets readback proves the external state.
- Treat `Workflow Status` as collaboration state only. It does not replace `Media Availability`, `Hide from Website`, `Needs Review`, production state, or publication state.
- Preserve human text in `Workflow Note`; append a timestamped AI entry. Use `Human Issue`, `AI Issue`, and `Developer Memo` only for their existing specialized purposes.

## References

- Selection and value rules: `../../references/decision-rules.md`
- Encoding and stream reuse rules: `../../references/encoding-rules.md`
- Notion and Media Assets rules: `../../references/notion-media-assets.md`
- Metadata sources: `../../references/metadata-sources.md`
- Script inventory: `../../references/script-map.md`
- Work title and duplicate prevention: `../../references/work-title-identity-rules.md`
- Human/AI collaboration handoff: `../../references/workflow-handoff.md`
