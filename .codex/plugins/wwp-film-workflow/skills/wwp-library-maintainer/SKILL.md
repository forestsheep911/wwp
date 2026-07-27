---
name: wwp-library-maintainer
description: Use when existing WWP work pages need metadata backfill, identity repair, field completion, AI advisory refresh, or follow-up maintenance independent of playable media upload.
---

# WWP Library Maintainer

This skill owns the work-level maintenance queue. It is separate from Media Assets and must continue even when no media block was uploaded.

## Work Queue

```powershell
node tools/film-ledger.mjs queue --stage metadata --limit 3 --json
node tools/film-ledger.mjs complete-task --task <id> --failure-detail "backfill completed" --json
node tools/film-ledger.mjs schedule-metadata --work-id <id> --failure-detail "refresh stale fields" --json
```

Process only a small batch per run. The local task record is the memory of what was inspected; do not rebuild a full Notion candidate list on every cycle. When a completed work needs a later refresh, requeue it explicitly with `schedule-metadata`; a due work `next_review_at` is also requeued on the next identity pass.

## Order

1. Confirm work identity and duplicate status using title aliases, year, source filenames, and external IDs.
2. Repair the canonical title and identity fields if needed, preserving Human Issue and setting Needs Review for unresolved conflicts.
3. Parse legacy Douban text before making external calls.
4. Fill sourced fields from Douban, OMDb, IMDb fallbacks, TMDb when authorized, and confirmed critic pages.
5. Generate AI advisory fields only after sourced metadata is coherent: minimum age, confidence, risk tags, and reasoning.
6. Write `Last AI Check Time` for a completed AI inspection, even when no value changed.
7. Put unresolved automation findings in `AI Issue`; never overwrite `Human Issue`.
8. Read back the page, record the task result, and leave `Needs Review` true when a concrete issue remains.

## Independence From Media

- A new work may finish its metadata task while having no playable spec.
- An existing work with excellent media may still have an incomplete metadata task.
- Media Assets, playback, Hide from Website, and metadata completeness are separate gates. Completing one must not imply the others.
