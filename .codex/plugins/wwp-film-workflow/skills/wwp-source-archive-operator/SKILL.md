---
name: wwp-source-archive-operator
description: Use when WWP work involves source or original-disc archives, remux/BDMV/ISO packaging, 7z volumes, source-only Notion pages, manual source upload alignment, or explicit Notion API source upload.
---

# WWP Source Archive Operator

Source/original-disc work is optional and guarded. It is different from playable production.

## Default Position

- Current WWP production does not retain or automatically upload original discs or source archives after their useful specification expansion is exhausted.
- Do not create or retain 7z source packages in the ordinary or complete production workflow. Enter source packaging/upload only when the user explicitly requests it in the current task.
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

- Large source uploads inherit the exact route gate from `wwp-notion-publisher`: use DIRECT by default. The only non-DIRECT exception is a deliberately wrapped, probed, and traffic-monitored JMS Freedom `s801` batch with a concrete reason. A configured s801 node is sufficient even without a dedicated routing rule; select it temporarily through the existing nested selectors, verify it before every part, and restore the prior choices afterward. Never fall through to s1-s5, an automatic group, `Match`, or another proxy.
- Do not remove operational prefixes such as download-only labels merely because source files exist.
- Keep source/archive manifests and lightweight operational logs under `.local-data/source-archives/` unless the user specifies another local state path. Never use this directory as long-term storage for generated 7z volumes.
- For local disk cleanup, run `node tools/film-cleanup-candidates.mjs --output-root <directory> --json`. It reports eligible finished playable outputs and source inputs whose linked variants are all closed. Do not use a Notion status alone as cleanup proof.
- A finished playable output has an independent cleanup gate. Either (a) the exact ledger path exists, its recorded byte size matches, and `publication_state=sync_ready`, or (b) a successful upload release manifest identifies the exact local basename and accepted Notion media block. In both cases it may be quarantined without waiting for parent `Workflow Status=已完成`, metadata completion, website sync, or source expansion. These are separate gates and must continue independently.
- Treat source expansion as open whenever any bound supplemental variant is `selected`, `deferred`, encoding, QC-pending, or publication-pending. A first playable release and work-level `已完成` do not make that source cleanup-eligible.
- Before closing expansion for a multi-audio source, account for every verified materially useful track. Completing original-audio high/compact variants does not exhaust a source that still contains an unproduced Mandarin, Taiwan Mandarin, Cantonese, or commentary branch with plausible library value. Keep the source and record the remaining branch or a concrete reason to reject it; do not move it merely because the current outputs are already publishable.
- A multi-file source directory may contain extras that are intentionally excluded by a hard production gate. Probe every otherwise-uncovered media file first and record the exact exclusion evidence. Only when every linked variant is closed, the latest marker is `[规格扩展:CLOSED]`, and `source_media_not_fully_covered` is the sole remaining blocker may an exact source be quarantined with `--source-id <id> --allow-reviewed-uncovered-media --coverage-reason <reason> --apply`. This flag must never waive an open variant, an open expansion marker, a missing file, or any other blocker.
- Require the latest expansion decision to be explicit before source cleanup: `[规格扩展:CLOSED]` with a value-exhausted reason and no open linked variants. `[规格扩展:OPEN]` means retain the source even when all currently published outputs are safe to quarantine independently.
- Once source expansion is explicitly closed and no linked variant remains open, move the original source to the same-volume `待人工删除` quarantine instead of retaining it as an archive. Existing generated 7z volumes are disposable staging artifacts and may be quarantined when the user authorizes that file class; they are not retained-source evidence.
- After cleanup authorization, run `node tools/film-cleanup-candidates.mjs --output-root <directory> --apply --json`. It moves only eligible items to the same-volume `待人工删除` directory by default; use `--quarantine-dir` only when an explicit destination is required. It never deletes files, preserves the original basename with a ledger-ID suffix, and reports every moved path. Never use `E:\video_made\待人工删除`.
- Every full workflow or goal-idle decision must also inspect
  `cycle.lanes.sourceFollowup`. A source that still physically remains in an
  enabled input root needs one explicit disposition and reason. A failed move
  is recorded as `source_quarantine_failed` so later rounds continue reporting
  the exact path and OS error until the source is successfully quarantined.
- Before quarantining a completed output that is on a non-default volume, run `node tools/film-relocate-finished-outputs.mjs --from-root <staging-output-root> --to-root <configured-output-root> --json`; use the default `E:\\video_made` only when no output root was specified. Add `--apply` only after the preview shows exact `sync_ready` and byte-matched outputs. The tool copies and verifies each file, updates its exact ledger path and relocation event, then removes the old copy. It excludes sources, active work files, samples, and size-mismatched records.
- `G:` is an optional external holding volume. Use it only after checking that
  the drive is mounted, writable, has enough space, and passes a small
  write/read probe. It may hold temporary outputs or cleanup items when the
  normal volume is short on space, but it is not an enabled input root and its
  actual path must remain in the ledger. Read `../../references/storage-rules.md`
  for the quarantine and failure rules.
- When reconciling the local output ledger, run `node tools/film-output-ledger-audit.mjs --root <directory> --json`. A `sync_ready` variant that is absent from its original output path but present in the same-volume `待人工删除` path with its `.variant-<id>` suffix is an archived finished output, not a missing output. Only the audit's `registeredOutputsMissing` list needs historical follow-up.
- When a deliberately cleaned local output is still represented by a visible, playback-verified Notion Media Asset with a mapped spec or Episode page and media block, use the explicit backfill tool flag `--allow-uploaded-only` to restore the ledger record. This is evidence recovery only: do not invent a local path or byte size, and do not use it for an unverified, hidden, misplaced, or unreleased asset.
- Treat a local media file with no exact ledger record as a legacy exception, not a cleanup candidate. Keep it in place until a published replacement is proven to cover its intended audio, subtitle, and browser-compatibility role, or the user explicitly authorizes that file class. Record the reason before moving it to `待人工删除`.
- Treat explicitly named smoke-test/sample artifacts as a permanent cleanup exclusion. A `sync_ready` ledger row does not override the sample marker; keep the file for human review unless the user explicitly authorizes handling that sample class.
- Do not let source/archive reconciliation count as work metadata completion. Use the metadata workflow for the work page, then use source Media Assets only for file/archive evidence.

## Reference

Read `../../references/source-archive-rules.md`, `../../references/storage-rules.md`, and `../../references/script-map.md`.
