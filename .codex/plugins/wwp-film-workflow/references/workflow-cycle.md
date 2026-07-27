# Workflow Cycle Contract

`开始制作影视库` starts a bounded workflow cycle. It is not a Notion media-block watcher and it must not stop when publication has no immediately visible upload.

## Work Areas and Queues

The workflow has six work areas. Five have explicit ledger queues; source/archive
handling and cleanup are recorded as intake follow-up rather than as a separate
high-frequency queue. Every cycle checks these areas in order, using a small batch
and the local SQLite ledger:

1. **Collaboration handoff**: query only actionable `Workflow Status` values, mirror them into SQLite, and claim at most three. This is the explicit replacement for inferring manual-upload completion from timestamps.
2. **Intake**: scan every enabled input root, import new or changed sources, identify the work, check duplicate aliases, and bind or defer the source.
3. **Catalog maintenance**: create or reuse the work page, then backfill missing or stale work-level metadata for newly identified works and selected older works. This includes canonical title/identity, poster and external IDs, ratings fallbacks, AI advisory fields, `Needs Review`, `AI Issue`, `Human Issue`, and `Last AI Check Time`. This lane is independent of playable media and may finish before any spec exists.
4. **Production**: evaluate source quality, Chinese subtitle evidence, audio/language choices, value, and risk; prepare destination pages before encoding. Directory-scan subtitle counts cover external files only, so zero sidecars means internal streams are still unprobed rather than proving Chinese subtitles are absent.
5. **Publication**: reconcile only bounded exact targets for upload, page structure, Media Assets, and website-sync readiness. A root-level or unverified media block remains a publication issue, not an intake or metadata issue.
6. **Source/archive maintenance**: keep source-only/original-disc records, manual-upload handoffs, retention decisions, and safe deletion candidates aligned with the ledger and verified Notion state. Do not delete merely because a file is old.

## Cycle start

The cycle is a round-robin work cycle, not a media-upload check. Every invocation
must inspect and report these lanes, even when one currently has zero pending rows:

- **New resources**: scan enabled input roots and bind newly discovered or changed
  sources to works, including source-only or metadata-only candidates.
  A changed fingerprint on an existing bound source must reopen its intake task;
  do not treat a previously completed source as permanently immutable. Scanner
  display-sample settings must not change fingerprints by themselves.
- **Catalog maintenance**: process newly identified works and a bounded batch of
  older works with missing, stale, conflicting, or unresolved metadata.
- **Playable production**: evaluate and encode only candidates that pass the source,
  subtitle, language, quality, and value rules.
- **Publication**: prepare Notion pages, reconcile manual uploads, write Media
  Assets, and verify website-sync readiness.

The first two lanes are not subordinate to publication. A cycle must continue with
new-resource intake and catalog maintenance while an encode, manual upload, or
Notion reconciliation is waiting. A zero count means that lane was checked and
currently has no due item; it does not remove the lane from the next cycle report.

At the beginning of each cycle, the agent may use the ledger's bounded cycle
dashboard. It refreshes only due local intake reviews and catalog reviews; it does
not query Notion:

```powershell
node tools/notion-workflow-handoff.mjs scan --limit 3 --json
node tools/film-ledger.mjs cycle --limit 3 --json
```

The first command queries only `待 AI 处理`, `已上传待 AI 收尾`, and `已确认待 AI 发布`. It does not scan recently edited pages or inspect media trees until a work is claimed.

The cycle reopens deferred intake tasks whose `next_run_at` has arrived, just as
it reopens due metadata reviews. A deferred source therefore remains in the
ledger and can return to identity/duplicate analysis without being rescanned as
a new source.

The equivalent individual queues are:

```powershell
node tools/film-ledger.mjs status --json
node tools/film-ledger.mjs queue --stage handoff --limit 3 --json
node tools/film-ledger.mjs queue --stage intake --limit 3 --json
node tools/film-ledger.mjs queue --stage metadata --limit 3 --json
node tools/film-ledger.mjs queue --stage production --limit 5 --json
node tools/film-ledger.mjs queue --stage publication --limit 3 --json
```

`metadata` and `catalog` are aliases for the catalog-maintenance lane. This lane
covers both newly discovered works and older entries whose identity, source
fields, poster, ratings, AI advisory fields, or issue state still need work. It
is not inferred from the presence of a playable media block.

Then scan/import each enabled input root, not only the historically used path. A source scan is an intake event even when it produces no playable candidate.

## Catalog maintenance

- A newly identified work always gets a metadata task, even when its source is rejected, deferred, source-only, missing Chinese subtitles, or has a color/quality problem.
- Existing works with incomplete fields, unresolved `AI Issue`, `Needs Review`, stale identity/title data, or a due `Last AI Check Time` review are maintenance candidates. Process only a bounded batch and record the next review time; do not repeatedly rescan the whole Notion library.
- After a work-level check, use the ledger's `schedule-metadata` command when a later refresh is required. A completed task is not permanent; it is reopened by an explicit maintenance request or by a due work review on the next identity pass.
- Metadata completion means source fields, poster/IDs, ratings fallbacks, AI advisory fields, readback, and issue-state handling were attempted. It does not mean the work has playable media or Media Assets.
- When a long encode or upload is waiting, continue the metadata lane with other queued works.

The absence of a metadata queue item is not proof that the catalog is complete:
the next bounded identity pass may reopen due or explicitly requested maintenance
work. A work may be complete for catalog purposes while still having no spec, no
playable file, and no Media Assets.

## Source/archive and cleanup follow-up

- After intake, preserve the source record even when production is deferred or rejected.
- When an existing QC or `sync_ready` variant clearly came from a bound source but its legacy `source_id` is empty, repair the same-work link with `attach-variant-source` after verifying the exact work, source, output, and target evidence. Do not treat a missing link as proof that the source still needs production.
- A `deferred` production item is retained for reporting but is not a current
  production candidate. It re-enters selection only when its recorded
  `next_review_at` is due or an explicit human retry reopens it.
- When a user uploads manually, record the exact destination page and treat the upload, Media Assets readback, and website-sync state as publication work.
- Prepare the page structure, set `Workflow Status=待人工上传`, and name the destinations in `Workflow Note`. The user sets `人工上传中` while uploading and `已上传待 AI 收尾` only when the upload batch is complete.
- A local output/source file is deletable only after the ledger and Notion evidence show that the required asset is already accounted for, or the user explicitly authorizes deletion of that specific class of file.

## Stop condition

A cycle may stop only after all work areas were checked and any pending item has a recorded state: `done`, `deferred`, `waiting_user`, or a publication handoff with an exact target page. If no item is currently due, record that the intake and catalog-maintenance checks were performed and leave the next review time in the ledger. The following are never sufficient stop conditions by themselves:

- no new media block was found;
- all current media blocks were organized;
- the production queue is empty; or
- the publication queue is temporarily rate-limited.

Final completion for a playable variant still requires Notion structure, uploaded media, Media Assets, and website-sync readback. Work-level metadata completion is reported separately.
