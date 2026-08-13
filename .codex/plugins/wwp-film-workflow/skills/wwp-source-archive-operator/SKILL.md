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
- For local disk cleanup, run `node tools/film-cleanup-candidates.mjs --output-root <directory> --json`. It reports eligible finished playable outputs and source inputs whose linked variants are all closed. Do not use a Notion status alone as cleanup proof.
- A finished playable output has an independent cleanup gate. Either (a) the exact ledger path exists, its recorded byte size matches, and `publication_state=sync_ready`, or (b) a successful upload release manifest identifies the exact local basename and accepted Notion media block. In both cases it may be quarantined without waiting for parent `Workflow Status=已完成`, metadata completion, website sync, or source expansion. These are separate gates and must continue independently.
- Treat source expansion as open whenever any bound supplemental variant is `selected`, `deferred`, encoding, QC-pending, or publication-pending. A first playable release and work-level `已完成` do not make that source cleanup-eligible.
- Require the latest expansion decision to be explicit before source cleanup: `[规格扩展:CLOSED]` with a value-exhausted reason and no open linked variants. `[规格扩展:OPEN]` means retain the source even when all currently published outputs are safe to quarantine independently.
- After cleanup authorization, run `node tools/film-cleanup-candidates.mjs --output-root <directory> --apply --json`. It moves only eligible items to the same-volume `待人工删除` directory by default; use `--quarantine-dir` only when an explicit destination is required. It never deletes files, preserves the original basename with a ledger-ID suffix, and reports every moved path. Never use `E:\video_made\待人工删除`.
- When reconciling the local output ledger, run `node tools/film-output-ledger-audit.mjs --root <directory> --json`. A `sync_ready` variant that is absent from its original output path but present in the same-volume `待人工删除` path with its `.variant-<id>` suffix is an archived finished output, not a missing output. Only the audit's `registeredOutputsMissing` list needs historical follow-up.
- Treat a local media file with no exact ledger record as a legacy exception, not a cleanup candidate. Keep it in place until a published replacement is proven to cover its intended audio, subtitle, and browser-compatibility role, or the user explicitly authorizes that file class. Record the reason before moving it to `待人工删除`.
- Do not let source/archive reconciliation count as work metadata completion. Use the metadata workflow for the work page, then use source Media Assets only for file/archive evidence.

## Reference

Read `../../references/source-archive-rules.md` and `../../references/script-map.md`.
