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
4. Upload playable MP4 files using the mapped repository tool.
5. For large Notion file uploads, keep the upload manifest and command log; if the process is interrupted, resume from the manifest before starting over.
6. Probe the exact local final file and write Media Assets from `ffprobe` plus production manifest data. Use a guarded batch manifest when broad title search can match sibling works.
7. Run readback or stats to prove the uploaded block and Media Assets row exist.
8. If film-level metadata is missing, route to `wwp-metadata-backfiller`.

## Page Shape

New API-created content should prioritize stable structure, machine parsing, and Media Assets completeness. Historical visual structures such as base/toggle/callout layouts are compatibility targets when reading old pages, not requirements for new API output.

## Guardrails

- Default upload is playable only; source/original-disc upload belongs to `wwp-source-archive-operator`.
- Do not infer codec, duration, frame rate, audio, subtitles, or resolution from filenames when final media can be probed.
- Do not mark complete from local logs alone; require Notion or Media Assets readback.
- Do not require a persistent Asset URL for Notion-hosted uploads when the URL is a temporary signed file URL; durable page/block IDs are the stable proof.

## Reference

Read `../../references/notion-media-assets.md` and `../../references/script-map.md` before running upload/write commands.
