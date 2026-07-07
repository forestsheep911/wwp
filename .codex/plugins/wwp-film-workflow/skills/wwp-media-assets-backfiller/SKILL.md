---
name: wwp-media-assets-backfiller
description: Use when WWP videos, episodes, source files, or original-disc archives were manually or remotely uploaded to Notion and Media Assets rows are missing, incomplete, stale, or need ffprobe-backed repair.
---

# WWP Media Assets Backfiller

Use this when the external Notion files already exist and the task is to reconcile structured Media Assets without reuploading or reorganizing pages.

## Triggers

- The user says they recently uploaded several films manually.
- The user says uploads happened from another location or device.
- The user says upload is complete but Media Assets were not written.
- Existing video/file blocks lack Media Assets rows.
- Rows exist but are missing structured fields or rely on old title parsing.

## Workflow

1. Scan recently updated Notion pages or the user-specified page set.
2. Identify video/file blocks and classify them as playable, episode playable, source archive, original disc, or unknown.
3. Compare against existing Media Assets rows.
4. Prefer local produced files, samples, manifests, or prior ffprobe JSON for metadata.
5. Use guarded batch manifests with page IDs when a title query can match sequels, remakes, or similarly named pages.
6. If no local probe source exists, ask before downloading Notion-hosted files just to probe them.
7. Produce a dry-run list of rows to create/update.
8. Apply only after the dry-run is coherent, then read back the result.

## Guardrails

- Do not move page structure or reupload files during a backfill.
- Do not overwrite human fields when page title, spec page, and schema disagree; report the conflict and recommend a fix.
- For source/archive rows, fill lineage, size, container/archive, and availability first. Only claim stream-level metadata when a real media file can be probed.
- For Notion-hosted media, treat source page IDs and media block IDs as the durable link. Do not require a copied Asset URL when the underlying URL is temporary.

## Reference

Read `../../references/notion-media-assets.md` and `../../references/source-archive-rules.md`.
