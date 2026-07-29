---
name: wwp-source-archive-operator
description: Use when WWP work involves source or original-disc archives, remux/BDMV/ISO packaging, 7z volumes, source-only Notion pages, manual source upload alignment, or explicit Notion API source upload.
---

# WWP Source Archive Operator

Source/original-disc work is optional and guarded. It is different from playable production.

## Default Position

- New film production does not automatically upload original discs or source archives.
- If the user manually uploaded source files, align manifests and Media Assets rather than uploading again.
- Source-only availability must not be presented as playable availability.

## Workflow

1. Classify the source: remux, BDMV, ISO, original disc dump, encoded source, archive volumes, subtitle pack, or extras.
2. Decide whether the user asked for source archive handling or whether playable production should continue without source upload.
3. Create/reuse the work page before long packaging or upload work, then route to `wwp-metadata-backfiller` for work-level metadata. Source-only state is not a reason to leave title, Douban/IMDb, poster, ratings, credits, or AI advisory fields blank.
4. For manual upload alignment, read Notion blocks, source manifests, and file sizes, then reconcile Media Assets/source memo.
5. For explicit API upload, prepare volume manifests and retry-safe upload state before applying.
6. During long packaging or upload waits, run metadata preview/apply/readback for the work page instead of idling.
7. Report availability as source-only, needs-processing, blocked, playable, or unknown based on actual state, and report work-level metadata state separately from source Media Assets state.

## Guardrails

- Large source uploads must not silently switch to a bandwidth-expensive or proxy-heavy path.
- Do not remove operational prefixes such as download-only labels merely because source files exist.
- Keep source/archive manifests under `.local-data/source-archives/` unless the user specifies another local state path.
- For local disk cleanup, run `node tools/film-cleanup-candidates.mjs --output-root <directory> --json`. Treat only `eligible: true` rows as deletion candidates; the report is read-only and never substitutes for explicit deletion authorization.
- After explicit cleanup authorization, move eligible finished outputs to the quarantine directory `E:\待人工删除` by default. This directory is intentionally outside `E:\video_made`; never create or use `E:\video_made\待人工删除`. Preserve filenames, report moved bytes, and leave final deletion to the user unless the user separately authorizes deletion.
- Do not let source/archive reconciliation count as work metadata completion. Use the metadata workflow for the work page, then use source Media Assets only for file/archive evidence.

## Reference

Read `../../references/source-archive-rules.md` and `../../references/script-map.md`.
