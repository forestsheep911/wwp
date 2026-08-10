---
name: wwp-library-maintainer
description: Use when existing WWP work pages need metadata backfill, identity repair, field completion, AI advisory refresh, or follow-up maintenance independent of playable media upload.
---

# WWP Library Maintainer

This skill owns the work-level maintenance queue. It is separate from Media Assets and must continue even when no media block was uploaded.

## Work Queue

```powershell
node tools/film-ledger.mjs queue --stage metadata --limit 3 --json
node tools/film-ledger.mjs schedule-metadata --work-id <id> --failure-detail "refresh stale fields" --json
```

Use `complete-task` only after exact Notion readback proves
`Metadata Status=verified`, the issue fields are empty, and the maintained poster
is usable. Include that evidence in the completion reason. A `partial` page is
not complete: keep it pending for another deterministic pass or defer it with
the exact missing core fields, attempted sources, blocker, and review time.

Process only a small batch per run. The local task record is the memory of what was inspected; do not rebuild a full Notion candidate list on every cycle. When a completed work needs a later refresh, requeue it explicitly with `schedule-metadata`; a due work `next_review_at` is also requeued on the next identity pass.

## Order

1. Confirm work identity and duplicate status using title aliases, year, source filenames, and external IDs.
1a. Confirm the ledger `work_type` before writing metadata, then compare the exact Notion `影别`: `movie` maps only to `Movie`, and `series` maps only to `TV Series`. Reconcile the page through `tools/notion-create-work-page.mjs --work-id <id> --page-id <id>`; do not let later metadata fields, playable episodes, or website sync mask a type mismatch.
2. Repair the canonical title and identity fields if needed, preserving Human Issue and setting Needs Review for unresolved conflicts.
3. Parse legacy Douban text before making external calls.
4. Fill sourced fields from Douban, OMDb, IMDb fallbacks, TMDb when authorized, and confirmed critic pages.
5. Generate AI advisory fields only after sourced metadata is coherent: minimum age, confidence, risk tags, and reasoning.
6. Write `Last AI Check Time` for a completed AI inspection, even when no value changed.
7. Put unresolved automation findings in `AI Issue`; never overwrite `Human Issue`.
8. Read back the exact page and calculate core completeness. Complete the task
   only for `verified`; otherwise record `missingCoreFields`, source attempts,
   issue state, poster usability, and the next action without dropping the task.
9. For a work whose playable variants are already `sync_ready`, refresh its
   targeted website index entry and verify that the live result contains a
   usable poster and core metadata before allowing `Workflow Status=已完成`.

## Independence From Media

- A new work may finish its metadata task while having no playable spec.
- An existing work with excellent media may still have an incomplete metadata task.
- Media Assets, playback, Hide from Website, and metadata completeness remain
  independently produced gates, but current-release completion is their conjunction.
  Completing one must not imply the others, and `sync_ready` alone must not set
  `Workflow Status=已完成`.
