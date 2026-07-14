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
   Derive the displayed size from the exact final file byte count using the workflow's decimal-GB convention. Do not inherit a stale size from a filename or an existing placeholder page; a materially different size requires a corrected or separate spec page.
4. Create or reuse the target spec page before encode starts whenever manual upload may be needed. Notion API cannot move an already uploaded media block into a different child page in this workflow; report the target page ID before the user uploads and do not rely on later root-level cleanup.
5. If the work page/spec page exists but upload is slow, deferred, or not yet suitable, route to `wwp-metadata-backfiller` immediately and continue upload work afterward or in parallel.
6. Upload playable MP4 files using the mapped repository tool, or tell the user to place manual uploads under the prepared target spec/episode page.
7. For large Notion file uploads, keep the upload manifest and command log; if the process is interrupted, resume from the manifest before starting over.
8. Probe the exact local final file and write Media Assets from `ffprobe` plus production manifest data. Use a guarded batch manifest when broad title search can match sibling works.
9. Run readback or stats to prove the uploaded block and Media Assets row exist.
10. If film-level metadata is still missing, route to `wwp-metadata-backfiller`.

## Page Shape

New API-created content should prioritize stable structure, machine parsing, and Media Assets completeness. Historical visual structures such as base/toggle/callout layouts are compatibility targets when reading old pages, not requirements for new API output.

## Guardrails

- Default upload is playable only; source/original-disc upload belongs to `wwp-source-archive-operator`.
- Early-created work/spec pages do not justify playable Media Assets rows; media evidence must come from a real video/file block or the exact final local file.
- Do not use work-page-root video/file blocks as final playable placement. If manual upload landed at the root, report the exact target spec/episode page and treat the block as structure-incomplete evidence. Because Notion API cannot move media blocks between pages, use manual move/reupload by the user, or explicit local-file reupload only when accepted. For future work, run the prepare-only page-creation step before encode or handoff so this cleanup is not needed.
- Do not collapse distinct Chinese audio variants into one generic spec. When filenames identify `zh-mandarin`, `zh-cantonese`, or `zh-taiwan`, prepare separate `国配`, `粤配`, and `台配` spec pages unless the user explicitly asks to merge them.
- Do not trust `Chinese`/`zh` source labels or an unverified filename marker as proof of Mandarin. If multiple Chinese streams exist and the mapping is unknown, keep the target language unconfirmed. A user listening report is valid evidence: rename/reuse the target as `粤配` when the user identifies Cantonese, and do not create a `国配` page until a Mandarin stream is independently verified.
- Keep `Hide from Website` true until playable media, Media Assets, required subtitles, and QC are all verified. Never clear a user-set hide flag without asking, even when the new spec looks good.
- Set or keep `Needs Review` when upload/readback evidence is incomplete, Media Assets disagree with the page, subtitle/audio/QC is uncertain, or a human decision is pending. Do not treat clearing review as permission to unhide the work.
- Do not infer codec, duration, frame rate, audio, subtitles, or resolution from filenames when final media can be probed.
- Do not mark complete from local logs alone; require Notion or Media Assets readback.
- Do not require a persistent Asset URL for Notion-hosted uploads when the URL is a temporary signed file URL; durable page/block IDs are the stable proof.

## Bounded Naming Checks

- Spec-title consistency checks are targeted follow-up work, not a reason to enumerate the full library.
- Inspect only the exact specs touched in the current run or the latest small set of production/upload targets, normally no more than 3. For series, verify that the title uses a per-episode size or range such as `0.8-1.0GB/集`, never the season total.
- Do not use a recent-page watcher or broad title search to discover more naming problems. If an older spec was not touched, leave it alone unless the user names it or a later workflow step reaches it.

## Reference

Read `../../references/notion-media-assets.md` and `../../references/script-map.md` before running upload/write commands.
