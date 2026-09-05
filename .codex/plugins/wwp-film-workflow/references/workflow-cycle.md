# Workflow Cycle Contract

`开始制作影视库` starts a bounded workflow cycle. It is not a Notion media-block watcher and it must not stop when publication has no immediately visible upload.

## Stable Contract (0.1.48)

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
An optional mounted `G:` external disk may be used as a probed temporary
staging or quarantine volume when another volume lacks space; it is not a fixed
input/output root and its actual path must be recorded in the ledger.

Film production and all catalog enrichment have one scheduler rather than
autonomous tasks. The scheduler accepts `film-only`, `people-only`,
`enrichment-only`, the compatibility mode `film-and-current-people`, and the
default `film-and-current-enrichment`. The default completes the bounded film stage first
and then offers the People stage only the exact work IDs touched by that film
round. People research, Notion publication, and convergence never run beside a
film network stage. Both lanes use `.local-data/wwp-production-network.lock`;
an active owner makes the later lane wait and report the owner, while a stale
lock whose process has exited is recoverable. This sequencing rule changes
ownership and request pressure only; it does not weaken the People identity,
editorial, readback, or replay gates.

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
2. **Intake**: scan every enabled input root, import new or changed sources, identify the work, check duplicate aliases, and bind or defer the source. A repeated scan of the same physical path under the same input root and work is one source only: retain the preferred record with the strongest probe evidence, classify later records as `duplicate_source`, and exclude them from production selection so they cannot create false "needs selection" work. If later frame, stream, subtitle, or authoritative title evidence proves an existing binding wrong, use the auditable `correct-source-work` operation and re-evaluate the destination work; do not create a second work. A copied collection/container with no independent production value must be marked with `mark-duplicate-source` even when its filesystem path differs, otherwise it remains an unbound identity candidate on every cycle.
3. **Catalog maintenance**: create or reuse the work page, then backfill missing or stale work-level metadata for newly identified works and selected older works. This includes canonical title/identity, poster and external IDs, ratings fallbacks, AI advisory fields, `Needs Review`, `AI Issue`, `Human Issue`, and `Last AI Check Time`. This lane is independently executable and may reach `verified` before any spec exists, but its verified result is still a mandatory gate for later release completion. After duplicate preflight or a verified Douban heading establishes the canonical title, run metadata backfill with `--preserve-existing-identity`; OMDb may supplement fields but must not rewrite that title to its English display name.
4. **Production**: evaluate source quality, Chinese subtitle evidence, audio/language choices, value, and risk; prepare destination pages before encoding. Rank uncovered eligible new works ahead of supplemental variants until the batch has first-release coverage. The production queue has two explicit kinds: `source_selection` for a bound, usable source that has no selected variant yet, and `variant` for an already selected spec. A released work's concrete selected/deferred supplemental variants remain valid queue records even when its work-level status is `已完成`; do not suppress those variant rows merely because the parent released. Only enabled input roots participate; synthetic `@flat/...` output indexes do not re-enter automatically. A zero production queue means both kinds were checked and are empty; it must never mean only that no variant exists. Directory-scan subtitle counts cover external files only, so zero sidecars means internal streams are still unprobed rather than proving Chinese subtitles are absent. After probing and hard-sub inspection, route a worthwhile subtitle-dependent source with no verified Chinese subtitle through the bounded `wwp-subtitle-acquirer` handoff; keep it waiting/deferred without blocking metadata or other production candidates. A verified `国配` branch is not subtitle-dependent and proceeds without that handoff; record missing subtitles only as optional enrichment.
   Every local cycle also audits series specification coverage without calling Notion. When one published per-episode specification establishes a broader episode universe and another published per-episode specification covers only a strict subset, every missing episode needs an explicit selected, deferred, or terminally cancelled ledger variant. A partial specification with no such rows is production work even when the season is already `已完成`; do not report the cycle as idle. Ignore explicit smoke/sample files and special/OVA/SP specifications rather than turning them into a season-wide commitment.
Legacy flat-source guard: when a synthetic or root-flat ledger row no longer has a real backing file or folder, mark that source `missing` and remove it from the production queue. Do not keep selecting a stale row merely because the old ledger record remains.

5. **Publication**: reconcile only bounded exact targets for upload, page structure, Media Assets, and website-sync readiness. Before creating a destination spec page, scan the work's existing child spec pages and Media Assets rows and compare a normalized variant signature (cut/edition, resolution, codec/container, audio and subtitle treatment, and actual or rounded per-file size); a materially equivalent playable asset occupies the target even if its title or filename wording differs. Adopt/backfill it or stop the duplicate route. Prepare exact destination pages first. If later source validation cancels production, archive that prepared page only when exact parent/title readback proves it still contains zero child blocks; preserve any uploaded or human-edited page for review. Probe final files and enforce browser-compatible stream tags before Notion access, prefer resumable automatic upload after a route probe, retry only the same failed part with bounded backoff, and use manual upload only as a recorded fallback. A root-level or unverified media block remains a publication issue, not an intake or metadata issue. Each variant has one encode/remux owner at a time: before starting or resuming either phase, check the exact output/work path and process command line, terminate duplicate owners, and preserve the completed work file for one controlled retry. Never let two remux processes write the same `.part.mp4`. When checking website coverage, compare the full detail-page/index variant count and exact asset keys; the library card may intentionally preview only three variants and must not be treated as a sync-loss signal.
 6. **Source/archive maintenance**: keep source-only/original-disc records, manual-upload handoffs, retention decisions, and safe deletion candidates aligned with the ledger and verified Notion state. Do not delete merely because a file is old.
    Website coverage incident rule: when a user reports that Notion has more specifications than the website, refresh and audit that exact work page first. Compare the full detail/index result by exact asset keys; the library card intentionally previews at most three variants. Do not recreate or hide variants based on the card alone. If the full result is short, classify it as a real publication/index defect and repair the exact missing target; if it is complete, record the report as a preview misunderstanding and leave Notion unchanged.
7. **Local cleanup**: inspect both completed playable outputs and their bound source inputs every cycle. Notion status alone never makes the workflow idle: enabled input roots with unselected/unfinished sources remain a continuation condition. A playable output is cleanup-eligible either after its exact ledger path, recorded byte size, and `sync_ready` state agree, or after a successful upload release manifest identifies the exact local file and accepted Notion media block; it does not wait for the parent work's metadata or `Workflow Status=已完成` gate. A source is cleanup-eligible only when its expansion decision is closed, every linked variant is `sync_ready` or terminally cancelled, no variant is selected/deferred/encoding/QC/publication-pending, and the source still exists. Report candidates first, then move approved files or directories to the same-volume `待人工删除` directory; never final-delete as part of a normal cycle.
   The cycle must return a complete disposition audit for every still-present,
   ledger-tracked source under enabled input roots. `sourceFollowup` distinguishes
   cleanup-ready, move-failed, active AI work, publication pending, waiting for
   human, scheduled review, open expansion, and missing identity/coverage/closure
   evidence. Therefore an empty due-action queue may be reported only together
   with residual counts, exact reasons, and the next trigger for every residue.
   Explicit sample artifacts are never cleanup candidates, even when a smoke-test variant happens to be marked `sync_ready`; filenames containing the standalone token `sample` require separate human handling and remain in place.
   When a completed output is temporarily on a non-default staging volume and the configured default output volume has sufficient free space, prefer a verified cross-volume relocation back to the default output root before quarantine. Copy, verify byte count, remove the old copy, and update the exact ledger path plus a relocation event atomically; never relocate an active work file or a source that still has open expansion value.
8. **Work enrichment campaign**: the default film mode adds only the exact
   bounded film work IDs to `.local-data/work-enrichment-campaign.json`. Resume
   each saved work serially through base metadata, People, honors, and
   highlights. Every attempted stage must be recorded as completed, blocked,
   waiting for human input, or deferred with a next review time. A routing plan
   is not execution, and an active campaign is not an idle workflow. Use an
   explicit historical input file to add older works; never turn this into an
   unbounded Notion-library scan.

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

An automatic goal continuation is not itself a workflow-state change. When the
previous bounded round already recorded no due action, no encode/upload is
running, and no user or filesystem/Notion handoff signal changed, suppress a
duplicate user-visible status report. Resume and report only on a meaningful
trigger: new user input, changed source fingerprint, due ledger review, process
progress or termination, actionable Workflow Note, completed stage, error, or a
decision that requires the user. A blocker is reported once with its exact next
trigger or review time; identical continuation turns must not repeat the same
"no change" sentence.

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
  do not treat a previously completed source as permanently immutable. A source
  that was only temporarily absent is reopened only when its previous intake
  completion reason was the missing-source close; completed collection/duplicate
  decisions must remain complete when the directory reappears. Scanner
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
  reclassifies its exact work page with fresh evidence. Later historical passes
  must use the script's persistent state cursor so a bounded limit advances to
  previously unverified task IDs instead of repeatedly auditing the newest rows.
- When a long encode or upload is waiting, continue the metadata lane with other queued works.

The absence of a metadata queue item is not proof that the catalog is complete:
the next bounded identity pass may reopen due or explicitly requested maintenance
work. A work may be complete for catalog purposes while still having no spec, no
playable file, and no Media Assets.

## Source/archive and cleanup follow-up

- After intake, preserve the source record even when production is deferred or rejected.
- A rejected variant is terminal only while its rejection evidence remains valid. If later distributed probes or stronger source-to-output evidence disproves the rejection, use the explicit `reopen-variant` ledger action with the evidence reason; never edit the state directly or silently select a duplicate variant.
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
- When either VPN traffic-counter URL is configured, automatic route probes and uploads record a baseline, a bounded five-minute cadence, and a completion sample in an adjacent redacted `.vpn-traffic.json` report. The first counter currently represents LA/JMS and resets monthly on day 2; the optional `_2` counter represents the temporary London allowance and may disappear after that subscription ends. Never expose the URLs. Treat counter growth as advisory shared-account evidence, not proof of this process's route. Clash `DIRECT`/non-`DIRECT` connection evidence remains authoritative; notify the user when sustained growth projects allowance exhaustion before reset.
- Website metadata sync must bound each external poster request, preserve the original poster URL when caching times out, and continue processing the batch. A single slow poster host must not hold unrelated completed media outside the website index; the affected work still requires a later successful poster readback before its poster gate is considered verified.
- DIRECT remains the default and ordinary proxy routes remain forbidden for large Notion transfers. When a DIRECT multipart connection degrades after accepted parts, preserve its upload session and accepted-part boundary, recycle only that uploader's connection, and try a bounded number of fresh DIRECT connections first. One controlled exception exists for JMS Freedom `s801` when those resumable same-route retries still cannot complete a necessary high-volume batch inside the upload expiry, or proactively when unavoidable large traffic makes protection of the normal allowance the recorded reason for the batch. This is never an automatic proxy fallback: use `tools/with-notion-upload-route.mjs` to inspect the current selector topology, save the existing choices, temporarily select and read back `Notion -> JMS London 节点 -> JMS London s801 - Reality`, run the probe with `--expected-route jms-s801`, prove that exact chain, verify completion-speed feasibility, monitor the actual counted-byte ratio, and restore plus read back both saved choices on success, failure, or interruption. An already configured selectable s801 node is enough; do not require or create a permanent dedicated routing rule or group for it. If the names differ, accept only a uniquely discovered `s801` member whose final chain is observed exactly. The provider's dynamic multiplier means counted usage may be approximately transferred bytes divided by the current multiplier, but its multiplier-10 20GB-download example is not proof of Notion-upload accounting; estimate from accepted upload bytes and counter deltas, and report an unmeasurable zero delta as unknown. Any s1-s5, automatic, generic `Match`, ambiguous node, or unexpected proxy chain remains a hard stop. s801 is a courtesy service with no quality, uptime, or continued-availability guarantee and may be taken offline at any time.
- Every s801 wrapper invocation must include a concrete `--reason` naming the estimated batch size or DIRECT failure evidence. The wrapper passes that reason to the uploader for audit. Run the probe and uploader with their explicit-proxy bypass option (`--no-proxy`) so Clash TUN and the temporary selectors, rather than `HTTPS_PROXY` or `NOTION_PROXY_URL`, own the exact route. A generic desire to use a proxy is insufficient, and unavailable s801 must not obstruct the default DIRECT path.
- For series, normal publication is one playable file per Episode page. Multi-episode collections are opt-in exceptions and must not be produced merely to reduce upload count.
- A local output/source file is deletable only after the ledger and Notion evidence show that the required asset is already accounted for, or the user explicitly authorizes deletion of that specific class of file.
- `G:` is an optional external holding volume. Before using it, check that it is
  mounted, writable, sufficiently empty, and responsive to a small write/read
  probe. If it is unavailable or slow, record the reason and continue other
  lanes without tight retries. Never infer that G is an input root, final output
  root, or proof that a cleanup gate has passed.
- For verified finished outputs approved for cleanup, use `E:\待人工删除` as the default quarantine directory. Keep it outside the production output root: do not place it under `E:\video_made`. Moving to quarantine is not final deletion and does not itself authorize deletion.
- A source moved to a same-volume `待人工删除` directory exits normal input-root scanning, but it does not lose expansion value. Before final human deletion or when repairing a known spec gap, resolve the exact quarantined source from the ledger and recheck useful original audio, dubbed audio, commentary, subtitle, compact, and higher-bitrate branches. Directory placement alone must never close or cancel a supplemental variant.
- Keep every `待人工删除` root disabled in the input-root registry. A deliberate quarantine audit may update existence for exact previously registered sources, but unknown children are skipped and never create a new source or intake task.

## Stop condition

A cycle may stop only after all work areas were checked and any pending item has a recorded state: `done`, `deferred`, `waiting_user`, or a publication handoff with an exact target page. If no item is currently due, record that the intake and catalog-maintenance checks were performed and leave the next review time in the ledger. The following are never sufficient stop conditions by themselves:

- no new media block was found;
- all current media blocks were organized;
- the production queue is empty; or
- the publication queue is temporarily rate-limited.

The same stop rule applies to the saved work-enrichment campaign. Before a Goal
round becomes idle, consume every due campaign item within the bounded limit or
record its exact blocker, human-confirmation reason, or next review time. Do not
describe `enrichmentCampaign.due` as merely advisory output.

Final playable completion still requires the exact Notion structure, completed file upload and destination media block, ffprobe-backed Media Assets, and local-ledger `sync_ready`. Release completion additionally requires exact work-page `Metadata Status=verified`, empty issue fields, a usable poster, parent work-page release, incremental website sync, and live API readback of both playable assets and core metadata. An accepted multipart part, a completed local encode, `sync_ready` alone, or an on-disk search index is not final release proof. Release completion does not close concrete supplemental variants or authorize source cleanup.
