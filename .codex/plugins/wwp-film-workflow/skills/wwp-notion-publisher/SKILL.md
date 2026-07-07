---
name: wwp-notion-publisher
description: Use when uploading WWP playable movie or series files to Notion, creating or updating work/spec pages, writing Media Assets, verifying readback, or retrying Notion file uploads.
---

# WWP Notion Publisher

Publish playable outputs and prove the library state. Prefer existing WWP repository tools over rewriting Notion API logic.

## Workflow

1. Confirm the work page or create one only when the work is genuinely new.
2. Reuse existing work pages for supplemental specs.
3. Title spec pages with a positive human-readable label: work title, subtitle/language label, and file size.
4. If the work page/spec page exists but upload is slow, deferred, or not yet suitable, route to `wwp-metadata-backfiller` immediately and continue upload work afterward or in parallel.
5. Upload playable MP4 files using the mapped repository tool.
6. For large Notion file uploads, keep the upload manifest and command log; if the process is interrupted, resume from the manifest before starting over.
7. Probe the exact local final file and write Media Assets from `ffprobe` plus production manifest data. Use a guarded batch manifest when broad title search can match sibling works.
8. Run readback or stats to prove the uploaded block and Media Assets row exist.
9. If film-level metadata is still missing, route to `wwp-metadata-backfiller`.

## Page Shape

New API-created content should prioritize stable structure, machine parsing, and Media Assets completeness. Historical visual structures such as base/toggle/callout layouts are compatibility targets when reading old pages, not requirements for new API output.

## Guardrails

- Default upload is playable only; source/original-disc upload belongs to `wwp-source-archive-operator`.
- Early-created work/spec pages do not justify playable Media Assets rows; media evidence must come from a real video/file block or the exact final local file.
- Keep `Hide from Website` true until playable media, Media Assets, required subtitles, and QC are all verified. Never clear a user-set hide flag without asking, even when the new spec looks good.
- Set or keep `Needs Review` when upload/readback evidence is incomplete, Media Assets disagree with the page, subtitle/audio/QC is uncertain, or a human decision is pending. Do not treat clearing review as permission to unhide the work.
- Do not infer codec, duration, frame rate, audio, subtitles, or resolution from filenames when final media can be probed.
- Do not mark complete from local logs alone; require Notion or Media Assets readback.
- Do not require a persistent Asset URL for Notion-hosted uploads when the URL is a temporary signed file URL; durable page/block IDs are the stable proof.

## Reference

Read `../../references/notion-media-assets.md` and `../../references/script-map.md` before running upload/write commands.
