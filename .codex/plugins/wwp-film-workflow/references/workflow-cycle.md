# Workflow Cycle Contract

`开始制作影视库` starts a bounded workflow cycle. It is not a Notion media-block watcher and it must not stop when publication has no immediately visible upload.

## Stable Contract (0.1.34)

This revision records the currently accepted operating model. The workflow is
metadata-first and ledger-driven, with production and catalog maintenance as
independent lanes. The input root is supplied by the request or enabled in the
ledger; `E:\\video_made` is only the default output root when no output path is
given. A series is delivered as one playable file per episode by default, and
collection pages/files require an explicit exception. Before any upload, create
the complete Notion destination tree because uploaded media blocks cannot be
moved by the API. Automatic upload is the normal route after a direct-route
probe; manual upload is an explicit, bounded fallback coordinated through
`Workflow Status` and `Workflow Note`, never through page timestamps.

For exact pages already handed off for a manual tree move, a changed Notion
`last_edited_time` is a **recheck trigger**, not completion proof. The next
bounded cycle must retrieve that recorded page and inspect the expected
spec -> Episode -> media topology even if the user did not change Workflow
Status or append a Workflow Note. Continue only when the structural audit and
media evidence pass; do not infer a completed upload from the timestamp alone.

No item exits the workflow merely because encoding, upload, or a Media Assets
write succeeded. A playable variant reaches playable completion only after
structure, media block, ffprobe-backed Media Assets, ledger `sync_ready`, and
playable readback pass. Release completion is stricter: the exact work page must
additionally read back as `Metadata Status=verified`, have empty issue fields and
a usable maintained poster, then pass parent release, targeted website sync, and
live readback of both the playable assets and core work metadata. Only then may
`Workflow Status=已完成` be set for the current release. Source-value completion is
separate: concrete selected/deferred supplemental variants remain actionable and
retain the source even after the first release. The local output may move to
`E:\\待人工删除` after its exact playable evidence is safe, but the source cannot
move while any linked expansion variant remains open.

The 0.1.29 production policy is release-first coverage. For a newly arrived
batch, start one releaseable spec for every eligible work before using the
constrained encoder for additional specs on an already covered work. Compact is
the normal fast first release. A definitely planned high tier may be encoded
first and used as the compact parent only when doing so does not materially delay
site availability; upload high while compact is derived. Use encode/upload wait
time for metadata, destination preparation, QC, publication, and Media Assets
work rather than idling or launching competing GPU encodes.

The 0.1.23 production decision is explicit: automatic Notion upload is the
default after a direct-route probe; a series is published as one file per
Episode page; multi-episode collections are allowed only after a special user
instruction. Worthwhile subtitle-dependent sources without verified Chinese
subtitles enter a bounded provider-acquisition handoff instead of being silently
discarded. These are workflow defaults, not page-layout requirements.

A verified Mandarin-dubbed (`国配`) playable is not subtitle-dependent. Missing
Chinese subtitles on that Mandarin branch are a non-blocking future enhancement:
the branch may be encoded, published, released, and marked complete after the
normal media/QC/readback gates. Record one concise limitation note and keep any
later subtitle search separate. A foreign-original-audio branch without usable
Chinese subtitles remains subtitle-dependent and continues through the bounded
subtitle-acquisition/deferred route.

## Work Areas and Queues

The workflow has seven work areas. Five have explicit ledger queues; source/archive
handling and cleanup are recorded as intake follow-up rather than as a separate
high-frequency queue. Every cycle checks these areas in order, using a small batch
and the local SQLite ledger:

1. **Collaboration handoff**: query only actionable `Workflow Status` values, mirror them into SQLite, and claim at most three. Separately, recheck up to three exact ledger-recorded pages that have an unresolved AI move/upload handoff when their Notion edit time or child topology changed. The recheck is evidence gathering, not an implicit claim or release.
2. **Intake**: scan every enabled input root, import new or changed sources, identify the work, check duplicate aliases, and bind or defer the source.
3. **Catalog maintenance**: create or reuse the work page, then backfill missing or stale work-level metadata for newly identified works and selected older works. This includes canonical title/identity, poster and external IDs, ratings fallbacks, AI advisory fields, `Needs Review`, `AI Issue`, `Human Issue`, and `Last AI Check Time`. This lane is independently executable and may reach `verified` before any spec exists, but its verified result is still a mandatory gate for later release completion.
4. **Production**: evaluate source quality, Chinese subtitle evidence, audio/language choices, value, and risk; prepare destination pages before encoding. Rank uncovered eligible new works ahead of supplemental variants until the batch has first-release coverage. The production queue has two explicit kinds: `source_selection` for a bound, usable source that has no selected variant yet, and `variant` for an already selected spec. A released work's concrete selected/deferred supplemental variants remain valid queue records even when its work-level status is `已完成`; do not suppress those variant rows merely because the parent released. Only enabled input roots participate; synthetic `@flat/...` output indexes do not re-enter automatically. A zero production queue means both kinds were checked and are empty; it must never mean only that no variant exists. Directory-scan subtitle counts cover external files only, so zero sidecars means internal streams are still unprobed rather than proving Chinese subtitles are absent. After probing and hard-sub inspection, route a worthwhile subtitle-dependent source with no verified Chinese subtitle through the bounded `wwp-subtitle-acquirer` handoff; keep it waiting/deferred without blocking metadata or other production candidates. A verified `国配` branch is not subtitle-dependent and proceeds without that handoff; record missing subtitles only as optional enrichment.
Legacy flat-source guard: when a synthetic or root-flat ledger row no longer has a real backing file or folder, mark that source `missing` and remove it from the production queue. Do not keep selecting a stale row merely because the old ledger record remains.

5. **Publication**: reconcile only bounded exact targets for upload, page structure, Media Assets, and website-sync readiness. Before creating a destination spec page, scan the work's existing child spec pages and Media Assets rows and compare a normalized variant signature (cut/edition, resolution, codec/container, audio and subtitle treatment, and actual or rounded per-file size); a materially equivalent playable asset occupies the target even if its title or filename wording differs. Adopt/backfill it or stop the duplicate route. Prepare exact destination pages first. Probe final files and enforce browser-compatible stream tags before Notion access, prefer resumable automatic upload after a route probe, retry only the same failed part with bounded backoff, and use manual upload only as a recorded fallback. A root-level or unverified media block remains a publication issue, not an intake or metadata issue. Each variant has one encode/remux owner at a time: before starting or resuming either phase, check the exact output/work path and process command line, terminate duplicate owners, and preserve the completed work file for one controlled retry. Never let two remux processes write the same `.part.mp4`.
6. **Source/archive maintenance**: keep source-only/original-disc records, manual-upload handoffs, retention decisions, and safe deletion candidates aligned with the ledger and verified Notion state. Do not delete merely because a file is old.
7. **Local cleanup**: inspect both completed playable outputs and their bound source inputs every cycle. Notion status alone never makes the workflow idle: enabled input roots with unselected/unfinished sources remain a continuation condition. A playable output is cleanup-eligible either after its exact ledger path, recorded byte size, and `sync_ready` state agree, or after a successful upload release manifest identifies the exact local file and accepted Notion media block; it does not wait for the parent work's metadata or `Workflow Status=已完成` gate. A source is cleanup-eligible only when its expansion decision is closed, every linked variant is `sync_ready` or terminally cancelled, no variant is selected/deferred/encoding/QC/publication-pending, and the source still exists. Report candidates first, then move approved files or directories to the same-volume `待人工删除` directory; never final-delete as part of a normal cycle.

## Cycle start

### Input arrival and cadence

The scanner reports filesystem state transitions, not a copy/upload event log.
An entry that was already imported with the same path and fingerprint is
reported as unchanged even if the user moved or restored that same content
again. This is intentional: it prevents completed sources from re-entering the
intake lane as false new work. A genuinely replaced or extended entry must
change its content fingerprint, media count, total bytes, or fingerprint and will reopen intake.

One complete cycle is one bounded round. After an unchanged scan, do not start
another immediate full cycle merely because the continuation mechanism is still
active. Continue monitoring an encode or upload, or wait for a user-reported
new batch, an explicit Workflow Note change, or the current long-running step to
close. The cycle dashboard must still report metadata, production, publication,
and cleanup lanes even when the discovery lane is unchanged.

The executable cycle entry point always performs the cheap local scan, but it
throttles the Notion handoff/full round for one hour after an unchanged scan.
A changed or newly discovered input bypasses that cooldown immediately. When
the user reports that a new batch was added, run the cycle with `--force` even
if the filesystem diff is already zero: an automatic continuation may have
registered the batch before the user-facing turn. This prevents repeated
continuation turns from issuing rapid duplicate Notion scans while preserving
prompt pickup of a genuinely new batch. A report of `newlyDiscoveredSources=0`
is only a discovery result; `registeredSourcesNeedingProductionReview` and the
other work lanes must still be reported separately.

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
- **Publication**: prepare Notion pages, automatically upload playable files when
  the route passes preflight, reconcile manual-upload fallbacks, write Media
  Assets, and verify website-sync readiness.

The first two lanes are not subordinate to publication. A cycle must continue with
new-resource intake and catalog maintenance while an encode, manual upload, or
Notion reconciliation is waiting. A zero count means that lane was checked and
currently has no due item; it does not remove the lane from the next cycle report.

After a targeted Notion repair or Media Assets correction, refresh the affected
work in the local website search index by exact page ID or exact title. Do not
wait for an unrelated page edit or use a full-library sync as the default repair.
For legacy media with no final stream probe, an attached Notion block is
structure evidence only, not playback proof; a user-reported iOS/system decoder
failure makes replacement and a visibility review due immediately.
When every asset in an exact affected delivery is confirmed incompatible, hide
only that delivery through `notion-media-assets-set-visibility.mjs`: pass the
work page plus every recorded spec/episode source-page ID, inspect its dry-run,
then apply only if the source-set guard matches exactly. Hide the work and mark
it `Needs Review` while no playable replacement remains. A repaired file is not
released merely because it uploads: require final `hvc1`/AAC QC, Media Assets
readback, and a targeted website-index refresh before un-hiding it.

At the beginning of each cycle, the agent may use the ledger's bounded cycle
dashboard. It refreshes only due local intake reviews and catalog reviews; it does
not query Notion:

```powershell
node tools/notion-workflow-handoff.mjs scan --limit 3 --json
node tools/film-ledger.mjs cycle --limit 3 --json
```

The first command queries only `待 AI 处理`, `已上传待 AI 收尾`, and `已确认待 AI 发布`. It does not perform a broad recent-edit scan. For an existing exact manual-move handoff, the cycle additionally retrieves the recorded target page in a bounded recheck and runs `notion-series-structure-audit.mjs`; a timestamp change merely selects that exact page for inspection.

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
node tools/film-ledger.mjs queue --stage cleanup --limit 20 --json
```

The production queue is also the durable expansion query. Exact supplemental
variants remain `selected` or `deferred`; a deferred row returns only when its
`next_review_at` is due. Mirror the latest human-readable summary into
`Workflow Note` as `[规格扩展:OPEN]` or `[规格扩展:CLOSED]`, but do not add a generic
placeholder variant and do not treat the note as more authoritative than SQLite.

`metadata` and `catalog` are aliases for the catalog-maintenance lane. This lane
covers both newly discovered works and older entries whose identity, source
fields, poster, ratings, AI advisory fields, or issue state still need work. It
is not inferred from the presence of a playable media block.

Then scan/import each enabled input root, not only the historically used path. A source scan is an intake event even when it produces no playable candidate.

## Catalog maintenance

- A newly identified work always gets a metadata task, even when its source is rejected, deferred, source-only, missing Chinese subtitles, or has a color/quality problem.
- Existing works with incomplete fields, unresolved `AI Issue`, `Needs Review`, stale identity/title data, or a due `Last AI Check Time` review are maintenance candidates. Process only a bounded batch and record the next review time; do not repeatedly rescan the whole Notion library.
- After a work-level check, use the ledger's `schedule-metadata` command when a later refresh is required. A completed task is not permanent; it is reopened by an explicit maintenance request or by a due work review on the next identity pass.
- Metadata completion means exact page readback yields `Metadata Status=verified`:
  core identity/descriptive/poster/AI advisory fields are present, at least one
  external identity is verified, and `Human Issue` plus `AI Issue` are empty.
  Optional unavailable values do not block it. Merely attempting sources,
  obtaining `partial`, or recording a generic task reason is not completion.
- A `partial` metadata task remains pending when another deterministic pass is
  available. Otherwise defer it with exact `missingCoreFields`, attempted
  sources, poster usability, blocker, and `next_review_at`; do not mark it
  `done` to empty the queue.
- After adopting a stricter metadata-completion contract, run the exact-ledger
  migration audit `scripts/audit-completed-metadata.mjs --apply` once. It may
  reopen historical `done` tasks but must not scan unrelated Notion pages or
  bulk-edit their handoff state; each later bounded metadata pass repairs and
  reclassifies its exact work page with fresh evidence.
- When a long encode or upload is waiting, continue the metadata lane with other queued works.

The absence of a metadata queue item is not proof that the catalog is complete:
the next bounded identity pass may reopen due or explicitly requested maintenance
work. A work may be complete for catalog purposes while still having no spec, no
playable file, and no Media Assets.

## Source/archive and cleanup follow-up

- After intake, preserve the source record even when production is deferred or rejected.
- When an existing QC or `sync_ready` variant clearly came from a bound source but its legacy `source_id` is empty, repair the same-work link with `attach-variant-source` after verifying the exact work, source, output, and target evidence. Do not treat a missing link as proof that the source still needs production.
- Treat the JSON object returned by `select-variant` as the sole authority for the new variant ID. Capture its `id` and pass that exact value to `start-production`, `record-qc`, `register-target`, and `reconcile-notion`; never infer an ID from the prior record because concurrent work can allocate intervening IDs.
- A `deferred` production item is retained for reporting but is not a current
  production candidate. It re-enters selection only when its recorded
  `next_review_at` is due or an explicit human retry reopens it.
- A first release may be `已完成` while selected/deferred supplemental variants
  remain open. This is intentional. Keep the source bound and in place until
  those variants complete, are terminally cancelled, or expansion is explicitly
  closed with a recorded value decision.
- When a user uploads manually, record the exact destination page and treat the upload, Media Assets readback, and website-sync state as publication work.
- Prepare the page structure, set `Workflow Status=待人工上传`, and name the destinations in `Workflow Note`. The user sets `人工上传中` while uploading and `已上传待 AI 收尾` only when the upload batch is complete.
- Automatic upload is the default for playable outputs. Run a bounded route probe first, preserve the multipart manifest, and resume accepted parts after interruption. Switch to manual handoff only when throughput is below the safe-start threshold, bounded retries still fail, or the user explicitly requests it.
- For series, normal publication is one playable file per Episode page. Multi-episode collections are opt-in exceptions and must not be produced merely to reduce upload count.
- A local output/source file is deletable only after the ledger and Notion evidence show that the required asset is already accounted for, or the user explicitly authorizes deletion of that specific class of file.
- For verified finished outputs approved for cleanup, use `E:\待人工删除` as the default quarantine directory. Keep it outside the production output root: do not place it under `E:\video_made`. Moving to quarantine is not final deletion and does not itself authorize deletion.
- A source moved to a same-volume `待人工删除` directory exits normal input-root scanning, but it does not lose expansion value. Before final human deletion or when repairing a known spec gap, resolve the exact quarantined source from the ledger and recheck useful original audio, dubbed audio, commentary, subtitle, compact, and higher-bitrate branches. Directory placement alone must never close or cancel a supplemental variant.

## Stop condition

A cycle may stop only after all work areas were checked and any pending item has a recorded state: `done`, `deferred`, `waiting_user`, or a publication handoff with an exact target page. If no item is currently due, record that the intake and catalog-maintenance checks were performed and leave the next review time in the ledger. The following are never sufficient stop conditions by themselves:

- no new media block was found;
- all current media blocks were organized;
- the production queue is empty; or
- the publication queue is temporarily rate-limited.

Final playable completion still requires the exact Notion structure, completed file upload and destination media block, ffprobe-backed Media Assets, and local-ledger `sync_ready`. Release completion additionally requires exact work-page `Metadata Status=verified`, empty issue fields, a usable poster, parent work-page release, incremental website sync, and live API readback of both playable assets and core metadata. An accepted multipart part, a completed local encode, `sync_ready` alone, or an on-disk search index is not final release proof. Release completion does not close concrete supplemental variants or authorize source cleanup.
