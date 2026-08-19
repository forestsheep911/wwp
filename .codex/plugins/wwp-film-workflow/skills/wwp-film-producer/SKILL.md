---
name: wwp-film-producer
description: Use when coordinating WWP film or series production, choosing the next workflow step, or routing between source scanning, encoding, Notion publishing, Media Assets, source archives, and metadata backfill. The Chinese command "开始制作影视库" is an explicit request to start the complete autonomous workflow.
---

# WWP Film Producer

## Stable Production Defaults

The following are the current production defaults. Treat them as the normal
route unless the user gives a more specific instruction:

- Work-level metadata is worth doing even when the source is unsuitable for
  playback or encoding is still running. Metadata and playable production are
  related but independent lanes.
- Automatic Notion upload is the default after a route probe. Manual upload is
  a bounded fallback for a slow or failed route, or an explicit user choice.
- Series delivery is one playable file per Episode page. Do not build a
  multi-episode collection merely to reduce upload count; collections require
  explicit opt-in.
- `Workflow Status` and `Workflow Note` are the collaboration channel for
  upload handoff. Human text is the unmarked tail; AI acknowledges it with an
  `【AI(^_^) ...】` line. Do not infer completion from `last_edited_time`.
- A playable item is not complete until the exact destination structure, media
  block, ffprobe-backed Media Assets row, ledger `sync_ready`, parent release,
  website sync, and live readback all pass. Only then may the local output move
  to `E:\待人工删除`.
- `sync_ready` is final playable completion, not release completion. A work or
  season may enter `Workflow Status=已完成` for the current release only when its exact work page also
  has `Metadata Status=verified`, no unresolved `Human Issue` or `AI Issue`, a
  usable poster, and targeted website readback proves the poster and core
  metadata are present in the running site.
- Release completion and source-value completion are separate lifecycles. One
  verified useful playable may release the work while concrete supplemental
  variants remain selected or deferred. Those variants, not `Workflow Status`,
  keep expansion queryable and keep the source out of cleanup.

These defaults were validated by the recent automatic-upload trial and are the
baseline for future `开始制作影视库` runs:

- Use the Notion hostname and a direct-route preflight for large uploads. Keep
  the resumable multipart manifest and retry only the failed part; manual upload
  is the fallback when the measured route cannot finish within the upload window.
- A user-uploaded file is acknowledged through `Workflow Status` and
  `Workflow Note`, then verified by exact destination-page readback. A parent
  page timestamp is never an upload signal.
- For a series, prepare the season, spec, and every Episode page before any
  upload. Produce and publish one file per episode unless the user explicitly
  requests a collection.
- Metadata backfill, source intake, and playable encoding continue as separate
  bounded lanes while an encode or upload is waiting.

Coordinate WWP film work end to end. Load this first when the user asks to make, continue, publish, repair, or summarize a film/series production task. The complete cycle contract is in `../../references/workflow-cycle.md`.

## Start Command

Treat the exact phrase `开始制作影视库` as the end-to-end start command. Do not ask the user to restate the workflow.

1. Read enabled input roots and pending work from `.local-data/wwp-film-workflow.sqlite`. If the ledger has no enabled input root, use a directory explicitly supplied in the same request; ask for one only when neither source exists.
2. Run `node tools/film-workflow-cycle.mjs --limit 3 --json` before reading any lanes. This single entry point performs a fresh bounded scan of every enabled input root, mirrors only explicit AI-actionable handoffs, and then reads the ledger cycle. It is not a persistent watcher; never report “no new resources” without a fresh scan result from this command. The local scan always runs, while the Notion handoff/full round is throttled for one hour after an unchanged scan; a changed input bypasses that cooldown. When the user reports a new batch, run the same command with `--force`, because an automatic continuation may already have registered the batch before the user-facing turn. Report these as separate facts: `newlyDiscoveredSources`, `registeredSourcesNeedingProductionReview`, metadata candidates, publication-pending variants, and cleanup candidates. `newlyDiscoveredSources=0` only means that this scan found no file-system delta; it does not retract a batch already registered in the ledger. The human-facing summary must say “本轮文件扫描未发现新增或变化” only for the discovery lane and then report the other work lanes; never abbreviate the whole cycle as “无新片”. Do not use Notion parent timestamps or a broad watcher.
3. Claim a bounded actionable handoff before changing it, following `../../references/workflow-handoff.md`. Continue the other workflow lanes after the handoff batch.
4. For each bounded batch, identify new resources and existing works needing metadata/spec repair before selecting playable production. Start work-page creation and metadata backfill as soon as a scanned work is identified. Apply release-first coverage: after the minimum production gates pass, prioritize one releaseable playable for each eligible newly arrived work before supplemental depth on an already covered work. Run independent metadata, destination-page preparation, upload, QC, and encoding work concurrently when practical; use long encode/upload wait time for the non-conflicting lanes. While a long encode or upload is active, monitor that process instead of starting rapid repeated full cycles. After an unchanged scan, wait for that process to close, a user-reported new input batch, or an urgent Workflow Note change before starting another full cycle.
5. Continue through destination structure, playable production, upload handoff, Media Assets, and targeted readback. Reconcile at most three registered Notion targets per run. Media-block reconciliation is only the publication lane, not the workflow trigger or completion test.
6. Record uncertain or deferred decisions and continue with other candidates instead of interrupting the batch. Ask only when a decision blocks every useful next action or requires user-only evidence/action.
7. Treat `qc_passed` as production complete but publication pending. Treat only `sync_ready` as final playable completion. Before setting `Workflow Status=已完成`, run exact metadata maintenance/readback for the work page, require `Metadata Status=verified`, empty `Human Issue` and `AI Issue`, a usable poster, and targeted live-site readback of the poster and core metadata. If playable publication is complete but this metadata gate is not, keep the work in `AI 处理中`, requeue or defer its metadata task with the exact missing fields, and say explicitly that playback is complete while release completion is pending. Supplemental variants do not block this first-release state.
8. Before completing a released work, create exact ledger variants for every source-supported supplemental spec worth revisiting. Keep later variants `selected` or `deferred` with `next_review_at`, and mirror the latest decision in `Workflow Note` as `[规格扩展:OPEN] ...` or `[规格扩展:CLOSED] ...`. Do not create a new Notion property or a generic placeholder task for this marker.
9. When work-level metadata is complete but no first playable specification can continue, set `Workflow Status=暂缓` with an AI-marked recovery condition. Do not use work-level `暂缓` merely because a released work still has deferred supplemental variants.

## Stable Workflow Contract

These are the current production defaults. A later user instruction may override
an individual default for the current work, but the agent must record the
override in the ledger and `Workflow Note` rather than silently changing the
workflow.

The following defaults are considered settled for the current plugin revision:

- Metadata creation and repair starts as soon as a work is identified; playable
  production may be deferred or rejected without deferring the catalog entry.
- A series is prepared and published as one file per Episode page. Collections
  are exceptional and require an explicit user instruction for that delivery.
- Automatic Notion upload is attempted after a direct-route preflight. Manual
  upload is only a bounded fallback, and must use a page prepared in advance.
- A production item exits only after Notion structure, media block, Media Assets,
  ledger `sync_ready`, parent release, website sync, and live readback all pass.
- A work or season exits the complete workflow only after that playable gate and
  the work-level metadata gate both pass. `Metadata Status=partial`, a generic
  "checked" task reason, or a successful backfill command is never metadata
  completion evidence.
- Finished local outputs are moved to `E:\待人工删除`; normal workflow never
  deletes them directly.

These are workflow defaults, not user-interface requirements. New API-created
Notion pages may use a simple machine-readable page tree and do not need legacy
toggle, callout, or base-like visual containers.

- The complete workflow is metadata-first and media-independent: identify the
  work, prevent duplicates, create or repair the work page, and backfill useful
  metadata even when the source is not playable, the encode is deferred, or no
  Media Asset exists yet.
- Playable production is a separate lane. It requires a bounded source and QC
  decision, while metadata work may continue in parallel during encoding,
  upload, route retries, or manual handoff.
- The input directory is always request- or ledger-configured. Never treat
  `I:\MAKE\queue` as a permanent path. The default output directory is
  `E:\video_made` only when the user has not specified another one.
- An output or quarantine directory must never remain enabled as an input root.
  Disable retired, duplicate nested, and missing roots before the next cycle;
  otherwise produced files can re-enter intake as false new sources.
- For new work, prepare the complete destination tree before upload because
  Notion cannot move an uploaded media block through the API: movie work page ->
  spec page; series/season page -> spec page -> one Episode page per episode.
- Automatic Notion upload is the default after route preflight. Manual upload is
  a bounded fallback, and must use the exact prepared destination page plus the
  collaboration status channel.
- Series are published one episode per file by default. A multi-episode
  collection is an explicit exception, not an upload optimization.
- A work is not finally complete at encode, upload, Media Assets write, or
  `sync_ready` alone. The required gates are: destination structure, uploaded
  block, ffprobe-backed Media Assets, exact ledger reconciliation to
  `sync_ready`; then exact work-page metadata maintenance with
  `Metadata Status=verified`, no unresolved issue fields, and a usable poster;
  then parent release, incremental website sync, and live API readback of both
  playable assets and work metadata. Only then may the work be marked `已完成`.
- Preserve existing compact or lower-bitrate specs when a higher-bitrate version
  is added. Correct an inaccurate old ledger title/size from measured output
  bytes, but retain its local output, Notion page, and Media Assets history. A
  high-bitrate version must be a new ledger variant with a new spec child page,
  upload filename, and Media Assets row; never overwrite the old variant.
- Verified finished outputs are moved to `E:\待人工删除` for later human
  deletion. Never place the quarantine directory under `E:\video_made`, and do
  not delete source files or quarantine files as part of normal completion.
- Each cycle must report all lanes: handoff, intake, metadata maintenance,
  playable production, publication/Media Assets, and source/archive follow-up.
  An empty publication queue or a rate-limited Notion request never ends the
  complete workflow cycle.

## Targeted Recent-Item Checks

- Do not run a global Notion scan just to audit historical spec titles or page structure. Notion API rate limits make that an invalid default workflow.
- After a production, rename, structure preparation, or manual-upload handoff, inspect only the recent items touched by that run, with a default maximum of 3 exact work/spec targets.
- Check those targets for per-episode size naming, language/audio labels, duplicate specs, episode mapping, and root-level media placement. Check per-collection naming and overlapping ranges only when collection delivery was explicitly enabled. Leave older untouched items for later user-directed repair; an incomplete historical audit is acceptable.
- Prefer exact page IDs recorded in the local ledger. Do not substitute a broad title search or watcher scan when the target IDs are already known.

## Route

- New input directory, queue discovery, or "which one should we do": use `wwp-film-intake` and then `wwp-film-candidate-selector`.
- Existing work pages needing fields, identity repair, or AI advisory refresh: use `wwp-library-maintainer` and `wwp-metadata-backfiller`.
- Playable transcode, subtitles, audio variants, QC, or output files: use `wwp-playable-encoder`.
- A subtitle-dependent source with no verified Chinese subtitle: use `wwp-subtitle-acquirer` before deferring playable production. Provider capture is evidence collection; the local workflow still owns compatibility, quality, timing, and final selection.
- A verified Mandarin-dubbed (`国配`) branch without Chinese subtitles: continue through normal production and publication. Treat subtitles as optional future enrichment, record one concise note, and do not set `暂缓`, `Needs Review`, or `Hide from Website` for that reason alone. A separate foreign-original-audio branch remains subtitle-dependent.
- Series, seasons, episodes, SxxEyy mapping, or episode pages: use `wwp-series-producer`.
- Upload playable files or create/update Notion work/spec pages: use `wwp-notion-publisher`.
- "I uploaded some videos/source myself", recent uploads, or missing Media Assets: use `wwp-media-assets-backfiller`.
- Source/original-disc packaging, source-only pages, 7z volumes, or manual/API source upload: use `wwp-source-archive-operator`.
- Missing film-level metadata, Douban/OMDb/poster/basic info, or AI advisory fields: use `wwp-metadata-backfiller`.

## Default Flow

1. Resolve the input directory from the current request or enabled ledger roots. Do not assume a historical path is fixed.
2. Run `node tools/film-workflow-cycle.mjs --limit 3 --json` to scan/import every enabled root and load the bounded queues in one invocation. A scan is not an encode decision, and a previous cycle's empty result is never reusable for a later cycle.
3. Identify works, perform duplicate/alias preflight, and create/reuse metadata work pages. Metadata tasks are high priority even when playable production is blocked or deferred.
4. Process a small metadata-maintenance batch independently: repair identity, fill sourced fields, run AI advisory fields, and record unresolved issues. This includes old catalog entries with missing or stale fields, not only newly discovered works. Do not stop because no media block is waiting.
5. Select playable candidates by value, source quality, Chinese subtitle availability, Notion state, and production risk. Rank uncovered eligible new works ahead of supplemental variants for already released works. When a worthwhile subtitle-dependent source lacks verified Chinese subtitles, create or continue a bounded `wwp-subtitle-acquirer` task before deferring it; do not let an open browser handoff block metadata or other candidates.
6. For accepted playable candidates, create or reuse the Notion work page and intended destination pages before long encode/upload work when they are missing. Before creating a spec page, scan all existing child spec pages and the work's Media Assets rows, then compare a normalized variant signature: work identity, cut/edition, resolution, codec/container, audio language/variant, subtitle language/treatment, and actual or approximate per-file size. Treat a materially equivalent existing playable asset as occupied even when its title uses a different year, language wording, filename, or rounded size; adopt/backfill its evidence or stop the duplicate route. Preparation must fail closed when equivalence cannot be resolved. Notion's API cannot move uploaded media blocks between pages in this workflow, so destination preparation is mandatory, not optional. Movie uploads need an empty spec child page. Series uploads need a spec page plus one Episode child page per episode by default. When manual upload is likely, report the target title and page ID before encoding starts so the user can upload the finished file to the correct child page rather than the work-page root.
7. Produce playable MP4 variants into the user-specified output directory, or `E:\video_made` when none is specified.
8. Run probe/QC before upload.
9. Publish playable output to Notion automatically by default after a successful route probe. Preserve the resumable upload manifest. Fall back to an exact manual-upload handoff only when the route is below the safe-start threshold, bounded retries still fail, or the user explicitly chooses manual upload. Then write Media Assets from `ffprobe` and production manifests.
10. Revisit remaining metadata tasks and prepare/upload completed outputs while encodes wait; publication is only one queue. A metadata task may be completed only after exact readback yields `Metadata Status=verified`. Leave `partial` work pending when another automatic source or AI pass is available; otherwise defer it with `missingCoreFields`, the attempted sources, and `next_review_at`.
11. Before release completion, refresh the exact work in the website index and read the live result. Require a non-empty poster resolved from a maintained poster field and require the live metadata projection to contain the core identity/descriptive fields. A Notion `Poster URL` that cannot be fetched/cached is not a usable poster.
12. Record the source-expansion decision separately from release completion: exact planned variants remain in the production queue or deferred queue, while a closed decision says why the current specs have exhausted useful source value.
13. Report intake, catalog maintenance, first-release coverage, supplemental production, upload, Media Assets, metadata status, website-sync, and deferred-decision states separately. `node tools/film-ledger.mjs cycle --limit 3 --json` is the bounded start-of-cycle dashboard; Media Assets is only the publication reconciliation substage.

## Round-Robin Continuation Rule

Every execution cycle must treat these as parallel work lanes, in this order:

1. **Collaboration handoff**: mirror and claim at most three explicit actionable `Workflow Status` rows. Ignore `人工上传中`; `已上传待 AI 收尾` is the manual-upload completion signal.
2. **Intake**: inspect a small batch of newly discovered or changed source directories, resolve identity and duplicate risk, bind each source, and create its work-level metadata task.
3. **Metadata maintenance**: process a small batch of new and old work pages independently of playback. Fill sourced fields, repair canonical identity, generate AI advisory values after sourced data is coherent, and record unresolved `AI Issue` items. Close a metadata task only after the exact page reads back as `Metadata Status=verified`; `partial` must remain pending or be explicitly deferred with missing-core evidence and a review time.
4. **Production**: first cover each eligible new work with one releaseable spec, then select due supplemental variants by fan value. Prepare the destination structure before encoding. A verified `国配` branch passes the subtitle gate without Chinese subtitles; record the missing subtitle as optional enrichment rather than deferring it.
5. **Publication and Media Assets**: reconcile only bounded exact targets. Prefer resumable automatic upload; use manual upload as a recorded fallback, not the normal path. A missing upload is a pending handoff, not a reason to stop the other lanes.
6. **Source/archive and deferred maintenance**: retain blocked, user-decision, source-only, cleanup, and later-backfill tasks with reasons and next-review times; do not silently discard them.

The cycle may end only after these work areas have been checked and the next bounded batch is recorded. `publication` being empty, or all current media blocks being accounted for, never means the overall film-library workflow is complete while intake, catalog maintenance, source/archive follow-up, or `metadata_backfill` review is still due. For the full stop criteria, read `../../references/workflow-cycle.md`.

## Guardrails

- Existing Notion works should be reused; do not create duplicate work pages for supplemental specs.
- Mandarin-dub production is automatic for children's/animation/family works and for valuable missing Mandarin/Cantonese coverage on an existing library work when normal gates pass. For ordinary foreign films and supplemental Mandarin versions of Hong Kong films, ask the user first and disclose the complete output count, especially when compact and higher-bitrate tiers would make the matrix double. This question blocks only the optional Mandarin branch; continue other deterministic lanes.
- Before creating any work page, run the multi-alias identity preflight in `../../references/work-title-identity-rules.md`. Search Chinese, English, original, regional, filename/source, season, yearless, and temporary-title forms plus all known external IDs. A weak or noncanonical old title is still an existing work and must be repaired instead of duplicated.
- Canonicalize work titles from the verified Douban display title when available; otherwise use a verified authoritative fallback and include the foreign/original title and release year. Title cleanup is independent from playable readiness.
- Spec backfill can be as important as new-film creation when the existing specs are weak.
- Metadata collection is not gated by playable readiness. If a scanned work is worth cataloging, create or repair its work-level metadata even when no video is ready to upload.
- Do not block work-page creation and sourced metadata backfill on video upload readiness. Playable Media Assets rows still require real uploaded/probed media evidence.
- Avoid root-level manual upload cleanup by preparing the page structure early. Because uploaded media blocks cannot be moved by Notion API, a planned movie encode must have a target spec child page, and a planned series encode must have a target spec page plus Episode child pages, before upload. If the target pages cannot be prepared, do not start automatic upload or invite manual upload yet.
- For normal series delivery, create and upload one playable file per Episode page. Do not build collection files merely to reduce upload work; collection delivery requires an explicit user instruction and the uploader's explicit opt-in flag.
- Source/original-disc upload is not the default playable production path.
- A deferred production decision must not be reconsidered every cycle. Keep it
  visible in status, but only select it again after its `next_review_at` is due
  or after an explicit human retry.
- Never clear or archive a bound source while a concrete supplemental variant is
  selected, deferred, encoding, QC-pending, or publication-pending. A released
  work may be `已完成` while its source remains active for expansion.
- If the user explicitly cancels an optional variant after QC but before upload, or an existing canonical media asset makes a prepared duplicate unnecessary, confirm that no upload is in flight, archive only its exact empty placeholder page when applicable, and retire the ledger variant with `retire-variant`. It records terminal publication state `cancelled`; do not mark a retired variant `sync_ready`, and do not leave it in `upload_pending` or `assets_pending` where a later cycle can select it again.
- An empty production queue does not mean the workflow is idle. Check `queue --stage intake` and `queue --stage metadata` before stopping.
- Do not claim completion until Notion or Media Assets readback proves the external state.
- Do not claim release completion from `sync_ready` alone. Exact work-page
  metadata verification and live poster/core-metadata readback are additional
  hard gates for `Workflow Status=已完成`.
- Treat `Workflow Status` as collaboration state only. It does not replace `Media Availability`, `Hide from Website`, `Needs Review`, production state, or publication state.
- Read the unacknowledged plain-text tail of `Workflow Note` as the human instruction, then append an AI acknowledgement marker without changing it. `Human Issue` and `AI Issue` contain unresolved issues only; use neither as a coordination log.

## References

- Selection and value rules: `../../references/decision-rules.md`
- Encoding and stream reuse rules: `../../references/encoding-rules.md`
- Notion and Media Assets rules: `../../references/notion-media-assets.md`
- Metadata sources: `../../references/metadata-sources.md`
- Script inventory: `../../references/script-map.md`
- Work title and duplicate prevention: `../../references/work-title-identity-rules.md`
- Human/AI collaboration handoff: `../../references/workflow-handoff.md`
