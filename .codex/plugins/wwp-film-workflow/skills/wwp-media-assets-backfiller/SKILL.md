---
name: wwp-media-assets-backfiller
description: Use when WWP videos, episodes, source files, or original-disc archives were manually or remotely uploaded to Notion and Media Assets rows are missing, incomplete, stale, or need ffprobe-backed repair.
---

# WWP Media Assets Backfiller

Use this when the external Notion files already exist and the task is to reconcile structured Media Assets. If playable media was manually uploaded into the wrong page level, route through the manual-upload organization rules before writing final rows.

## Triggers

- The user says they recently uploaded several films manually.
- The user says uploads happened from another location or device.
- The user says upload is complete but Media Assets were not written.
- Existing video/file blocks lack Media Assets rows.
- Rows exist but are missing structured fields or rely on old title parsing.

## Workflow

1. Register the exact work/spec/episode page IDs for an unknown manual upload. Use `tools/notion-manual-upload-organizer.mjs` only as an explicit one-shot diagnostic for a user-specified page set; never run a full/recent-page background watcher.
2. Record the target in the local ledger. An explicit registration remains `not_ready`; it does not prove media or Media Assets evidence.
3. Run `node tools/film-ledger.mjs reconcile-notion --limit 3 --json`. The reconciler checks at most three due targets and accesses only page IDs already stored in the ledger.
4. Identify video/file blocks and classify them as playable, episode playable, source archive, original disc, root landing media, or unknown.
5. Treat root-level playable uploads as incomplete structure: movie media belongs under a spec child page; series media belongs under episode pages inside the spec page.
6. Compare only structurally valid media blocks against existing Media Assets rows.
7. Prefer local produced files, samples, manifests, or prior ffprobe JSON for metadata.
8. Use guarded batch manifests with page IDs when a title query can match sequels, remakes, or similarly named pages.
9. When a matching Media Assets row already exists, patch only empty structured fields from stronger local ffprobe/manifest evidence; never overwrite human values or visibility/review gates silently.
10. If no local probe source exists, ask before downloading Notion-hosted files just to probe them.
11. Produce a dry-run list of rows to create/update and a separate structure-fix list for root landing media.
12. Apply only after the dry-run is coherent, then read back the result and reconcile the recorded target again. `qc_passed` prevents duplicate encoding; only `sync_ready` exits ordinary observation queues.

## Guardrails

- Do not leave manually uploaded playable media naked on a work/season root page. Root media blocks are temporary landing blocks and must be organized into spec/episode child pages before final playable Media Assets rows are written.
- Metadata-only backfill should not move page structure or reupload files. When structure is wrong, produce a structure-fix report or route to an organizer/reupload step.
- Notion API cannot move an existing Notion-hosted media block between pages in this workflow. Do not copy its temporary signed URL into a new durable block. Report the exact source block and required destination; if the matching local final MP4 exists, use an explicit upload/reupload path only when accepted.
- Do not overwrite human fields when page title, spec page, and schema disagree; report the conflict and recommend a fix.
- Treat `Hide from Website` and `Playback Verified` as review gates, not metadata blanks. Do not clear/set them merely because Media Assets were created or backfilled.
- For source/archive rows, fill lineage, size, container/archive, and availability first. Only claim stream-level metadata when a real media file can be probed.
- For Notion-hosted media, treat source page IDs and media block IDs as the durable link. Do not require a copied Asset URL when the underlying URL is temporary.
- Do not infer upload completion from an API failure or an absent recent-page result. A Notion 429 opens the ledger's global 60-minute circuit breaker; retry only after the recorded due time unless a human explicitly forces the check.

## Reference

Read `../../references/notion-media-assets.md` and `../../references/source-archive-rules.md`.
