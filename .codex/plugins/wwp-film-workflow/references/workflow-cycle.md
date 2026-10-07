# Workflow Cycle Contract

`开始制作影视库` starts a bounded workflow cycle. It is not a Notion media-block watcher and it must not stop when publication has no immediately visible upload.

## Visibility Priority

**Required action order in every cycle:** (1) inspect already-uploaded playable
paths first; (2) when one is mapped to the correct work/spec/episode and there
is no concrete viewing failure, clear the work-level hide and start website
sync immediately; (3) continue metadata, Media Assets, QC, remaining specs, and
other follow-up without making those tasks prerequisites. Do not stop the cycle
because any of those parallel lanes is blocked. If impact is unknown, publish
the usable path and record what to verify later.

At the beginning and end of every cycle, independently classify **playback
visibility**, **production/follow-up**, and **final completion**. A blocker in
one lane pauses only that lane. If a media block is correctly mapped and there
is no current evidence it prevents normal viewing, keep/release the work page
visible now; do not wait for complete metadata, QC perfection, Media Assets,
`sync_ready`, website readback, all episodes/specs, or `Workflow Status=已完成`.
Record repairable defects and continue them separately. `Hide from Website`
may remain checked only for an explicit current human hold or evidence that
every available playable path prevents normal viewing; isolate a single bad
child path instead of hiding its playable siblings. Unknown impact defaults to
visible. Never treat `AI 处理中`, `待人工确认`, `暂缓`, or the word “blocked”
as a visibility decision.

## Stable Contract (0.1.121)

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

Identity reuse is guarded by the verified ledger identity, not by an external
ID alone. Before linking an existing Notion page, the tool must compare the
requested release year (from the ledger or canonical title) with the page's
release year/title evidence. A contradictory year rejects the match and sends
the item back to identity review; it must never bind the work or rewrite the
matched page. This protects against stale or wrongly supplied IMDb/Douban IDs
being resolved to a different work.

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

Provider credentials are lane-scoped blockers. A missing TMDB/OMDb credential,
provider timeout, or provider rate limit must produce a resumable recovery plan
with the exact next action and trigger; it must not promote the whole Goal to
blocked and must not erase independent film, metadata, cleanup, or People work.
When stable Wikidata work/person IDs or cached evidence exist, route the item to
the bounded Wikidata pilot first. Resume the provider lane only after credentials
recover or its retry time is due. A person item is genuinely blocked only when
identity, work-credit scope, publication authorization, or readback evidence is
missing after the available fallback lanes have been attempted.

An enrichment report that contains fallback evidence but does not satisfy the
publication quality gate is an intermediate checkpoint, never a completion
signal. Keep the item in `deferred` or `blocked`, preserve the exact evidence
gap in `AI Issue`, and write a concrete `nextAction` plus `trigger` in the
recovery plan. A clean fallback batch may continue to the next item, but it
must not be promoted to `completed` merely because profiles were materialized
or a Notion upsert returned success.

Worker-exit rule: `in_progress` means an observable owner process with a
checkpoint, not merely an old Notion status. Each enrichment run must retain
its report, preflight, write checkpoint, and owner evidence under its batch
directory. If the owner exits without a verified result, the next cycle must
classify the exact failure as `deferred` (temporary provider/transport issue)
or `blocked` (identity, permission, evidence, or integrity issue), preserve
the artifacts, and record a concrete next trigger. It must not keep the work
in `AI处理中` indefinitely or call it complete. For Azure People catalog
writes, retry the unchanged reviewed report only after readback/rollback
verification and reduce the apply to one independently verified sub-batch at
a time, preferably 10-16 profiles once the catalog is large.

For exact pages already handed off for a manual tree move, a changed Notion
`last_edited_time` is a **recheck trigger**, not completion proof. The next
bounded cycle must retrieve that recorded page and inspect the expected
spec -> Episode -> media topology even if the user did not change Workflow
Status or append a Workflow Note. Continue only when the structural audit and
media evidence pass; do not infer a completed upload from the timestamp alone.

No item exits the workflow merely because encoding, upload, or a Media Assets
write succeeded. A playable variant reaches playable completion only after
structure, media block, ffprobe-backed Media Assets, ledger `sync_ready`, and
playable readback pass. Visibility release is deliberately earlier in that
sequence: once the uploaded media block is verified on the exact intended
spec/episode page, its work mapping is unambiguous, and there is no concrete
current playback failure, clear the automation-owned work hide and trigger
website sync in the same publication run. Do not make ffprobe completion,
Media Assets completeness, `sync_ready`, or live-site readback prerequisites
for clearing the hide; collect and reconcile those as parallel/follow-up
publication evidence. If the site cannot expose/open the video without a
specific Media Assets field or row, record that exact observed dependency and
complete only the minimum needed to expose it. A sync/readback failure remains
an explicit publication follow-up; it does not turn metadata or minor repair
work into a playback blocker. Complete the remaining playable ledger/readback
checks even if metadata, poster, `Needs Review`, or issue follow-up remains open.
Release completion is stricter: the exact work page must additionally read back as
`Metadata Status=verified`, have empty issue fields and a usable maintained
poster, then pass parent release, targeted website sync, and live readback of
both the playable assets and core work metadata. Only then may
`Workflow Status=已完成` be set for the current release. Source-value completion is
separate: concrete selected/deferred supplemental variants remain actionable and
retain the source even after the first release. The local output may move to
`E:\\待人工删除` after its exact playable evidence is safe, but the source cannot
move while any linked expansion variant remains open.

This is the default visibility posture, not an exception to the release checks:
the first question is whether at least one exact published spec/episode can be
played by a normal user. If the answer is yes, publish it unless the playback
path itself is unsafe or a human explicitly holds it back. Do not convert a
repair queue into a website hide decision. The default is therefore
visible-after-usable-publication: if the known defect does not change whether
the verified delivery can be watched, release it and keep the defect in its
repair queue. When the impact is uncertain, do not hide the whole work on
suspicion; keep the usable delivery visible and record the uncertainty for
review, hiding only the affected delivery when evidence points to a viewing
problem.
**总裁决：可观看就先放出，不因可修复缺陷或流程未收尾而阻拦。** 只要没有
具体证据证明当前可用播放路径影响普通用户观看，就保持/恢复作品可见；怀疑但未证实的
风险记录为后续复核。资料缺失、规格未补、抽检未完、`Needs Review`、问题字段或
`Workflow Status` 未到 `已完成`，均不得成为工作级隐藏或发布阻塞理由。局部播放故障只
隔离对应规格/集；只有所有可用路径均被证实不可正常观看，或用户明确要求整条暂缓公开，
才隐藏作品。发布和缺陷修复、严格完成收尾是相互独立的工作，不要互相等待。

metadata incompleteness, a missing poster or rating, missing People/AI
enrichment, `Needs Review`, an AI/human follow-up issue, or open optional spec
expansion must not re-check `Hide from Website` after a verified playable path
is live. Those defects stay in their own queues while the work remains visible.
Only a verified page/media mapping error that makes the site open the wrong
video or fail to open the intended video, a reproduced failure that prevents
normal playback on every available path, or an explicit human visibility hold
may keep the whole work hidden. A warning, suspicion, incomplete Media Assets
row, failed API/index readback, or other bookkeeping defect is not enough unless
it is verified to prevent normal users from opening or watching the intended
video. A missing playable path alone does **not** hide the catalog entry: keep
the work visible and hide only empty child specs/episodes until they have media.
Unfinished supplemental specs remain hidden individually and do not hide a work
whose first useful spec is already playable.

This rule is deliberately permissive: defects that do not affect watching are
released first and repaired later. Do not turn a production/review blocker into
a release blocker; classify it as follow-up, isolate it to the affected child
path when applicable, and continue unrelated work. If viewing impact is unknown,
default to visible rather than checking `Hide from Website`.

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

Chinese-subtitle evidence has three states: `verified`, `confirmed_missing`, and
`unknown`. A legacy `verifiedChinese:false` value by itself is `unknown`, because
older probes used it both for "not checked" and "checked and absent". Unknown
sources remain in production/source review. Only explicit absence evidence such
as `hasChineseSubtitle:false`, `no_chinese_subtitles`, or
`quality_state=subtitle_missing` creates a durable `subtitle_acquisition` task.
That task remains visible and resumable until subtitles are verified, Mandarin
audio makes the branch non-blocking, the source disappears, or the task records
a concrete deferred/human state. Bounded synchronization prioritizes sources
without an open task (and completed tasks that must reopen) ahead of sources
whose acquisition task is already open, so a stable queue head cannot starve
later sources.

A verified Mandarin-dubbed (`国配`) playable is not subtitle-dependent. Missing
Chinese subtitles on that Mandarin branch are a non-blocking future enhancement:
the branch may be encoded, published, released, and marked complete after the
normal media/QC/readback gates. Record one concise limitation note and keep any
later subtitle search separate. A foreign-original-audio branch without usable
Chinese subtitles remains subtitle-dependent and continues through the bounded
subtitle-acquisition/deferred route.

Smoke validation is a production gate, not an advisory preview. Every new
video/color/subtitle path must pass a bounded strict decode before a full
encode is claimed. The smoke artifact must be checked at a known dialogue
timestamp (and at more than one timestamp when HDR, Dolby Vision, or stream
selection is uncertain). FFmpeg exit code 0 is insufficient: decoder stderr,
green/flat/magenta output, frozen or missing picture, and absent expected
burned subtitles all keep the source in an AI-blocked/deferred state. Record
the exact stream, timestamp, failure evidence, and next retry condition in the
ledger; do not create a Media Assets row or upload a failed smoke result.
PGS extraction is separately bounded: `render-pgs-samples.mjs` uses a 180-second
per-command timeout by default. A timeout is recorded as a technical evidence
failure, not retried in a tight loop. When random seeking into a UHD stream
fails but a片头连续样片 passes, the workflow may continue from the片头 path
while retaining the seek failure and scheduling a later multi-point check.
After inspecting the rendered images, record the result immediately with
`node tools/film-ledger.mjs review-subtitles --source-id <id> --subtitle-state verified|confirmed_missing|unknown`.
For `confirmed_missing`, include the rendered sample paths with
`--subtitle-samples '["<path1>","<path2>"]'`; do not leave the result as the
legacy `verifiedChinese:false` shape. This command writes the canonical
`state`, `hardGate`, and `quality_state` values that drive the durable subtitle
acquisition task.

## Work Areas and Queues

The workflow has seven work areas. Six have explicit ledger queues; source/archive
handling and cleanup are recorded as intake follow-up rather than as a separate
high-frequency queue. Every cycle checks these areas in order, using a small batch
and the local SQLite ledger:

1. **Collaboration handoff**: query only actionable `Workflow Status` values, mirror them into SQLite, and claim at most three. Separately, recheck up to three exact ledger-recorded pages that have an unresolved AI move/upload handoff when their Notion edit time or child topology changed. The recheck is evidence gathering, not an implicit claim or release. An enrichment stage left `in_progress` without a new record for six hours is an abandoned claim: recover it to `deferred`, preserve the old reason, set a one-hour review time, and record the exact resume trigger. Never leave a stale `AI处理中` claim indefinitely and never recover it as `已完成`.
2. **Intake**: scan every enabled input root, import new or changed sources, identify the work, check duplicate aliases, and bind or defer the source. Immediately after a source is bound, persist the representative probe path plus quality, subtitle, audio, color, and episode-coverage evidence with `film-ledger.mjs update-source`; do not leave verified stream facts only in terminal output or chat. A repeated scan of the same physical path under the same input root and work is one source only: retain the preferred record with the strongest probe evidence, classify later records as `duplicate_source`, and exclude them from production selection so they cannot create false "needs selection" work. If later frame, stream, subtitle, or authoritative title evidence proves an existing binding wrong, use the auditable `correct-source-work` operation and re-evaluate the destination work; do not create a second work. A copied collection/container with no independent production value must be marked with `mark-duplicate-source` even when its filesystem path differs, otherwise it remains an unbound identity candidate on every cycle. A directory containing only subtitles, artwork, NFO, or other non-media evidence is recorded as `companion_evidence`, its intake task closes, and it never enters identity or production selection; the evidence remains available to attach to the real video source. For a multi-season series, the split manifest is a mandatory checkpoint: do not create specs or bind all leaves to one season until every leaf has a verified season/episode identity or an explicit terminal decision. Parent-series IMDb/Douban hints must not be treated as season verification. After a collection is split, every bounded scan must reconcile the parent task against both relative and absolute descendant paths; once all leaf members are bound, the parent intake task closes automatically, regardless of whether it was still pending, deferred, or waiting for review. The parent must never remain as a false unbound candidate after its members have identities.
3. **Catalog maintenance**: create or reuse the work page, then backfill missing or stale work-level metadata for newly identified works and selected older works. This includes canonical title/identity, poster and external IDs, ratings fallbacks, AI advisory fields, `Needs Review`, `AI Issue`, `Human Issue`, and `Last AI Check Time`. This lane is independently executable and may reach `verified` before any spec exists, but its verified result is still a mandatory gate for later release completion. After duplicate preflight or a verified Douban heading establishes the canonical title, run metadata backfill with `--preserve-existing-identity`; OMDb may supplement fields but must not rewrite that title to its English display name. If a metadata task has no linked Notion work page, it is not a normal backfill attempt: route it first through the exact identity preflight and `notion-create-work-page.mjs --work-id <id> --apply`, then read back the page type, title, hidden state, and page ID before continuing metadata. Keep that task actionable and never close it as `nothing_to_update` while page creation is still pending.
  Metadata, People, honors, and highlights retain separate checkpoints. An
  earlier stage in a concrete stable `blocked`, `waiting_user`, or not-yet-due
  `deferred` state does not freeze an independently executable later stage.
  The continuation router must honor this independence: when a saved People
  item is due, it is selected before ordinary catalog-maintenance work (after
  publication, cleanup, and new-source intake). A partial metadata queue must
  not hide a due People batch; the People campaign still enforces its own
  identity, authorization, and readback gates.
  When a later stage is actually running, campaign reporting must surface that
  `in_progress` stage while preserving the earlier issue for later recovery.
  An `in_progress` stage is an active claim, not a due item: do not re-run or
  re-claim it on the next cycle. Keep it visible as active work and wait for a
  recorded stage result or process termination; recover it to `deferred` only
  after the six-hour stale-claim rule, preserving the reason and next trigger.
4. **Production**: evaluate source quality, Chinese subtitle evidence, audio/language choices, value, and risk; prepare destination pages before encoding. Once identity and duplicate preflight pass, create the **visible catalog work page** and its complete destination tree immediately, then start metadata backfill and encoding as independent lanes. Hide only an empty or unsafe child spec/episode while it has no usable media; do not hide the work merely because production is unfinished. A provisional prepared spec title may omit its size; it must never invent a target size, and must be renamed from measured final episode bytes before upload. Rank uncovered eligible new works ahead of supplemental variants until the batch has first-release coverage. The production queue has two explicit kinds: `source_selection` for a bound, usable source that has no selected variant yet, and `variant` for an already selected spec. A released work's concrete selected/deferred supplemental variants remain valid queue records even when its work-level status is `已完成`; do not suppress those variant rows merely because the parent released. Only enabled input roots participate; synthetic `@flat/...` output indexes do not re-enter automatically. A zero production queue means both kinds were checked and are empty; it must never mean only that no variant exists. Directory-scan subtitle counts cover external files only, so zero sidecars means internal streams are still unprobed rather than proving Chinese subtitles are absent. After probing and hard-sub inspection, route a worthwhile subtitle-dependent source with no verified Chinese subtitle through the bounded `wwp-subtitle-acquirer` handoff; keep it waiting/deferred without blocking metadata or other production candidates. A verified `国配` branch is not subtitle-dependent and proceeds without that handoff; record missing subtitles only as optional enrichment. Before `start-production`, the selected stream/tone-map/subtitle path must pass the strict bounded smoke gate above; a failed smoke is a source/variant blocker, not a successful production attempt. Before trusting `encoding` as active, require an observed owner process whose command line targets the exact variant output; an `encoding` row with no owner is stale work, so record the stale-claim evidence, move it to `qc_failed` when a failed/incomplete output exists or back to `selected` when no output exists, and expose the retry trigger. Never count a stale encoding row as a live process or let it suppress other production lanes.
   Every local cycle also audits series specification coverage without calling Notion. When one published per-episode specification establishes a broader episode universe and another published per-episode specification covers only a strict subset, every missing episode needs an explicit selected, deferred, or terminally cancelled ledger variant. A partial specification with no such rows is production work even when the season is already `已完成`; do not report the cycle as idle. Ignore explicit smoke/sample files and special/OVA/SP specifications rather than turning them into a season-wide commitment.
Legacy flat-source guard: when a synthetic or root-flat ledger row no longer has a real backing file or folder, mark that source `missing` and remove it from the production queue. Do not keep selecting a stale row merely because the old ledger record remains.

Upload registration guard: before any automatic or manual upload, register the exact ledger target with work/spec/episode page IDs and expected filename. An upload tool is not ledger-aware merely because it appended a Notion block. If an upload happened before registration, register it immediately, reconcile the exact page, and keep the variant in `assets_pending` until Media Assets creation and readback succeed.

5. **Publication**: reconcile only bounded exact targets for upload, page structure, Media Assets, and website-sync readiness. Before creating a destination spec page, scan the work's existing child spec pages and Media Assets rows and compare a normalized variant signature (cut/edition, resolution, codec/container, audio and subtitle treatment, and actual or rounded per-file size); a materially equivalent playable asset occupies the target even if its title or filename wording differs. Adopt/backfill it or stop the duplicate route. Prepare exact destination pages first. If later source validation cancels production, archive that prepared page only when exact parent/title readback proves it still contains zero child blocks; preserve any uploaded or human-edited page for review. For bounded metadata or structure API calls, an inherited proxy `ECONNRESET`/TLS failure is transport evidence, not a page-permission verdict: retry the exact target once through explicit proxy bypass, then use the configured Notion hostname DNS override bound to the physical LAN address when available. This API-only recovery does not waive the separate upload route proof and must not trigger a broad rescan. Probe final files and enforce browser-compatible stream tags before Notion access, prefer resumable automatic upload after a route probe, retry only the same failed part with bounded backoff, and use manual upload only as a recorded fallback. A root-level or unverified media block remains a publication issue, not an intake or metadata issue. Each variant has one encode/remux owner at a time: before starting or resuming either phase, check the exact output/work path and process command line, terminate duplicate owners, and preserve the completed work file for one controlled retry. On Windows, prefer a tracked foreground `exec_command` session for long encodes; before recording `encoding`, resolve and test the exact source path, launch one correctly quoted command line, then verify the live owner command line and output growth. If launch fails, immediately return the variant to `selected` and record the concrete path or argument error. Never let two remux processes write the same `.part.mp4`. When checking website coverage, compare the full detail-page/index variant count and exact asset keys; the library card may intentionally preview only three variants and must not be treated as a sync-loss signal.
   **Minimal-blocker publication rule:** the work page is a catalog entry and is visible by default, even before its first playable asset exists. Once one exact media path has a correctly mapped destination page and an uploaded video block, with no concrete playback failure, clear the automation-owned work hide before website sync. This is standing authorization to release watchable entries; do not ask the user for routine approval because a repairable defect remains. Capture ffprobe/Media Assets metadata in parallel; missing or incomplete fields block visibility only when the website actually needs them to expose/open that video. `sync_ready` and live readback close the publication loop; neither is a prerequisite for clearing the hide. A failed sync/readback must be reported and retried as publication work, not converted into a viewing-risk hide. Do not keep the whole work hidden because metadata, poster, ratings, People, AI advice, `Needs Review`, `Human Issue`, `AI Issue`, naming cleanup, optional variants, missing subtitles for a not-yet-built branch, or a sibling episode/specification is unfinished. Keep only the affected empty or unsafe sibling hidden. If the impact is uncertain, keep the catalog entry visible, publish the verified usable path when present, and record a follow-up instead of converting uncertainty into a work-level block; re-hide requires fresh viewing-affecting evidence or an explicit human hold. A blocker in encoding, metadata, review, or final completion pauses only that task and must not block other usable paths or unrelated production work.
 6. **Source/archive maintenance**: keep source-only/original-disc records, manual-upload handoffs, retention decisions, and safe deletion candidates aligned with the ledger and verified Notion state. Do not delete merely because a file is old.
    Website coverage incident rule: when a user reports that Notion has more specifications than the website, refresh and audit that exact work page first. Compare the full detail/index result by exact asset keys; the library card intentionally previews at most three variants. Do not recreate or hide variants based on the card alone. If the full result is short, classify it as a real publication/index defect and repair the exact missing target; if it is complete, record the report as a preview misunderstanding and leave Notion unchanged.
7. **Local cleanup**: inspect both completed playable outputs and their bound source inputs every cycle. Notion status alone never makes the workflow idle: enabled input roots with unselected/unfinished sources remain a continuation condition. A playable output is cleanup-eligible either after its exact ledger path, recorded byte size, and `sync_ready` state agree, or after a successful upload release manifest identifies the exact local file and accepted Notion media block; it does not wait for the parent work's metadata or `Workflow Status=已完成` gate. A source is cleanup-eligible only when its expansion decision is closed, every linked variant is `sync_ready` or terminally cancelled, no variant is selected/deferred/encoding/QC/publication-pending, and the source still exists. Report candidates first, then move approved files or directories to the same-volume `待人工删除` directory; never final-delete as part of a normal cycle.
   Collection parents close after every leaf is either bound or explicitly
   terminal (`duplicate_source` or `companion_evidence`); an unbound leaf with
   neither decision remains actionable. The cycle must return a complete disposition audit for every still-present,
   ledger-tracked source under enabled input roots. `sourceFollowup` distinguishes
   cleanup-ready, move-failed, active AI work, publication pending, waiting for
   human, scheduled review, open expansion, and missing identity/coverage/closure
   evidence. Therefore an empty due-action queue may be reported only together
   with residual counts, exact reasons, and the next trigger for every residue.
   The continuation object also exposes non-zero disposition categories and a
   completeness flag. If the residual count exceeds the categorized total, it
   adds `source_followup_classification_missing`; the cycle must not be called
   idle until that audit is repaired.
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

People provider recovery rule: Azure catalog range enumeration is an optional
optimization, not a prerequisite for the People lane. It has a finite timeout
and falls back automatically to known generation chunks. A stalled range read
therefore remains a retryable provider condition and must not stop the film
lane, intake lane, or unrelated People items. Only after both read paths fail
should the exact item be recorded as `deferred` with a future retry time;
identity ambiguity, conflicting stable IDs, and malformed coverage remain
item-local blockers with their evidence and recovery trigger.

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
  Archive-only directories with no recognized media file are classified as
  `archive_bundle`: they remain visible in the residual audit but do not create
  an executable film intake task. The next trigger is to inspect/extract the
  archive and rescan it; if it is manga, documents, or other non-film material,
  record that disposition rather than inventing a work.
  A changed fingerprint on an existing bound source must reopen its intake task;
  do not treat a previously completed source as permanently immutable. A source
  that was only temporarily absent is reopened only when its previous intake
  completion reason was the missing-source close; completed collection/duplicate
  decisions must remain complete when the directory reappears. Scanner
  display-sample settings must not change fingerprints by themselves.
  When a scan marks an unbound source `quality_state=incomplete`, defer its intake
  task without a conversational handoff. Preserve that machine reason across
  repeated scans and reopen the task only after a later scan explicitly reports
  a complete source; a partially downloaded directory is residual evidence, not
  an executable identity task. A bound source whose quality remains `incomplete`
  is likewise excluded from production selection until a later scan records a
  complete quality state.
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
node tools/film-ledger.mjs queue --stage subtitle --limit 3 --json
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
- When a finished output already exists before its ledger variant is created, do not jump directly from `selected` to `record-qc`. Register the exact work/spec/episode target first, then use `adopt-existing-variant` with the measured output, probe, and QC evidence so the legal `selected -> encoding -> qc_passed` transition is recorded atomically. Reserve `start-production` followed by `record-qc` for production that the ledger observed from its start.
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
- People campaign status is reconciled from the newest bounded local preflight and post-publish coverage artifacts before reporting blockers. A clean authorized preflight may recover a stale `waiting_user`, `blocked`, or `deferred` label under an explicit People objective; identity ambiguity remains a human gate, while a recovered canonical-index/provider failure may be retried without manual JSON edits.
- A saved authoritative People coverage audit is an intake source, not merely a report. For every `missing_credits`, `unlinked_only`, or `partially_linked` candidate, reconcile the exact `ww_work_id` and canonical page ID, then enqueue absent candidates into the campaign with source `historical_people_coverage` before calculating the People lane. Candidates that cannot be uniquely reconciled remain explicit identity blockers; they must never disappear because they were found outside the current film batch, and the workflow must never synthesize a work ID from a title alone.
- If exact People coverage returns zero canonical credits, persist it as a bounded `deferred` readback gap with `canonical people credits` and a review time; do not treat the empty result as completion or leave it as an always-due `pending` loop. The retry must reread the authoritative source before creating another supplement.
- Every normal cycle also repairs legacy enrichment rows whose blocker is a narrowly classified transient provider/readback failure (API/network outage, missing exact Notion gate readback, or temporary canonical-index loss) into a six-hour `deferred` retry. This repair is persisted before routing. Identity conflicts, permission failures, missing source evidence, and unresolved human decisions remain `blocked`/`waiting_user` and are never auto-reclassified.
- A closed work scope suppresses downstream subtitle-acquisition and intake reopens. The source remains retained history, but missing-subtitle evidence cannot recreate an actionable task until the user explicitly reopens the work expansion.
- Website metadata sync must bound each external poster request, serve only Azure-owned copies of the Notion poster and preserve an existing owned copy when a transient cache request fails, and continue processing the batch. A single slow poster host must not hold unrelated completed media outside the website index; the affected work still requires a later successful poster readback before its poster gate is considered verified. Never expose a temporary Notion URL or use Douban/other poster URL fallbacks. If Notion has no poster, leave it missing and continue synchronization; this is a source-metadata issue.
- DIRECT remains the default and ordinary proxy routes remain forbidden for large Notion transfers. When a DIRECT multipart connection degrades after accepted parts, preserve its upload session and accepted-part boundary, recycle only that uploader's connection, and try a bounded number of fresh DIRECT connections first. One controlled exception exists for JMS Freedom `s801` when those resumable same-route retries still cannot complete a necessary high-volume batch inside the upload expiry, or proactively when unavoidable large traffic makes protection of the normal allowance the recorded reason for the batch. This is never an automatic proxy fallback: use `tools/with-notion-upload-route.mjs` to inspect the current selector topology, save the existing choices, temporarily select and read back `Notion -> JMS London 节点 -> JMS London s801 - Reality`, run the probe with `--expected-route jms-s801`, prove that exact chain, verify completion-speed feasibility, monitor the actual counted-byte ratio, and restore plus read back both saved choices on success, failure, or interruption. An already configured selectable s801 node is enough; do not require or create a permanent dedicated routing rule or group for it. If the names differ, accept only a uniquely discovered `s801` member whose final chain is observed exactly. The provider's dynamic multiplier means counted usage may be approximately transferred bytes divided by the current multiplier, but its multiplier-10 20GB-download example is not proof of Notion-upload accounting; estimate from accepted upload bytes and counter deltas, and report an unmeasurable zero delta as unknown. Any s1-s5, automatic, generic `Match`, ambiguous node, or unexpected proxy chain remains a hard stop. s801 is a courtesy service with no quality, uptime, or continued-availability guarantee and may be taken offline at any time.
- Every s801 wrapper invocation must include a concrete `--reason` naming the estimated batch size or DIRECT failure evidence. The wrapper passes that reason to the uploader for audit. Run the probe and uploader with their explicit-proxy bypass option (`--no-proxy`) so Clash TUN and the temporary selectors, rather than `HTTPS_PROXY` or `NOTION_PROXY_URL`, own the exact route. A generic desire to use a proxy is insufficient, and unavailable s801 must not obstruct the default DIRECT path. All formal uploaders fail closed to `Notion -> 国内直连` even when invoked without the wrapper; only an explicit wrapper declaration can enable s801.
- For series, normal publication is one playable file per Episode page. Multi-episode collections are opt-in exceptions and must not be produced merely to reduce upload count.
- A local output/source file is deletable only after the ledger and Notion evidence show that the required asset is already accounted for, or the user explicitly authorizes deletion of that specific class of file.
- `G:` is an optional external holding volume. Before using it, check that it is
  mounted, writable, sufficiently empty, and responsive to a small write/read
  probe. If it is unavailable or slow, record the reason and continue other
  lanes without tight retries. Never infer that G is an input root, final output
  root, or proof that a cleanup gate has passed.
- For verified finished outputs approved for cleanup, use `E:\待人工删除` as the default quarantine directory. Keep it outside the production output root: do not place it under `E:\video_made`. Moving to quarantine is not final deletion and does not itself authorize deletion.
- A source moved to a same-volume `待人工删除` directory exits normal input-root scanning, but it does not lose expansion value. Before final human deletion or when repairing a known spec gap, resolve the exact quarantined source from the ledger and recheck useful original audio, dubbed audio, commentary, subtitle, compact, and higher-bitrate branches. Directory placement alone must never close or cancel a supplemental variant.
- When the disposition audit confirms `source_missing` for a source that has left an enabled input root, the cycle closes only its stale intake task with an explicit missing/quarantine reason. It must not requeue that task as a new intake candidate; reappearance in an enabled root remains the only condition that reopens it.
- At the start of a ledger cycle, reconcile already-registered `missing=1` sources whose registered root is a disabled `待人工删除` quarantine. This guard runs before due-task refresh, so legacy pending/deferred intake rows cannot resurrect quarantined files as new work. It does not scan quarantine contents, and a later reappearance under an enabled root still reopens the source through normal discovery.
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

When the active user objective explicitly includes filling or continuing People
work, a clean `ready_for_authorized_apply` report is due work, not a human
blocker. Only concrete identity ambiguity, conflicting IDs, canonical-scope
uncertainty, or an explicit editorial choice belongs in `waiting_user`. Do not
mark a Goal blocked merely because multiple clean People reports share the same
redundant blanket-review gate.

After People publication and convergence, regenerate exact work coverage and
settle the campaign stage from the report's authoritative `works` collection.
The incomplete-only `candidates` collection may be empty because the work is
now `fully_linked`; that is completion evidence, not a blocker. Before settling,
resolve translated credit spellings through verified aliases and stable IDs and
collapse only semantically identical person-role relations. Record a real
identity conflict or unresolved canonical credit on that item, then continue
other lanes; neither condition alone blocks the complete Goal.

People convergence is an active loop: after each apply, read back the same
work by its exact asset key and use `unlinkedCredits` to create the next
bounded supplement. A pilot budget, a successful Notion checkpoint, or a
catalog backup is only an intermediate checkpoint. The People stage may enter
`completed` only after the final exact readback reports zero unlinked credits,
or every remaining credit has an explicit evidence-based deferral and trigger.
The settlement ledger must preserve those exact residual credit objects in
`coverageResiduals`, together with `nextTrigger`; storing only a remaining
count loses the handoff needed for the next targeted supplement.

The cycle's top-level `continuation` object is the machine-readable Goal gate.
When `goalDisposition=continue`, its `nextAction` is the required routing
handoff: it names the first bounded lane, exact task/source/work/variant target
when available, and the reason. Execute that lane before reporting the round as
stopped; do not reconstruct a different priority from aggregate counts. If the
explicit ledger lanes are empty while `sourceDisposition.actionableNow` is
non-zero, route through the matching actionable `cycle.lanes.sourceFollowup`
entry and preserve its `nextTrigger`; an aggregate count without a routable
target is an invalid continuation result.
If any lane reports `actionableNow > 0` but no `nextAction` can be constructed,
the cycle must return `state=routing_incomplete` and
`actionable_work_without_route`. This is a scheduler/ledger contract failure:
repair the route or rerun the bounded cycle; never call it idle, stable wait, or
workflow-wide blocked.
`actionable_now` means the round must continue even when another item is locally
blocked. `waiting_for_human`, `locally_blocked`, and `scheduled_review` are stable
non-idle states and must retain their exact recovery condition; they do not make
unrelated lanes stop. Only `canDeclareWorkflowIdle=true` permits an idle claim.
Before saying that no action is currently due, report every entry named by
`remainingConditions` together with the exact item-level trigger from
`cycle.lanes.sourceFollowup` or `enrichmentCampaign`.
The continuation builder must also carry each source disposition's `reasons`
array into the item-level `conditionRows.reason` field, and must fall back to
`next_review_at` when an enrichment row has no custom trigger. A category count
without the preserved reason and recovery trigger is not a sufficient handoff.

`continuation.goalDisposition` separates scheduler behavior from item status:
`continue` selects another bounded item, `stable_wait` records named triggers
without repeatedly polling, and `idle` is available only after the full idle
gate. The normal cycle sets `canMarkGoalBlocked=false` because its blocker count
contains isolated work-item failures, not proof of a workflow-wide impasse. If a
People identity, Notion page, upload, or cleanup move fails, record the exact
failure and recovery condition on that item, then continue with the next clean
candidate. Goal-level `blocked` requires separate evidence that the same global
condition has stopped every meaningful lane for the required repeated turns.
Use `continuation.blockerScope` and `continuation.decisionMessage` in every Goal
decision report. `blockerScope=item` explicitly forbids promoting an aggregate
item count to a Goal blocker. When `goalDisposition=continue`, the next action
must be selected before reporting the round as stopped, even if one exact item
has a network, identity, review, upload, or file-lock failure.
The machine-readable `continuation.blockerReport.items` is the authoritative
item-level handoff for local blockers, human waits, and scheduled reviews. Each
row must retain its exact identifier, reason, and `nextTrigger`; a count without
these details is insufficient. `goalBlocker` remains null for ordinary cycles,
and `goalMayStop=false` means the Goal layer must not convert those rows into a
workflow-wide blocked state.
For enrichment settlement, an authoritative stage result of `blocked`,
`waiting_user`, or `deferred` is a stable item disposition, not a fresh `pending`
claim. Preserve its reason and next trigger, and only make it due again after
the recorded recovery evidence or review time. This keeps a failed People
identity lookup from repeatedly reclaiming the same item while other lanes run.

`continuation.recheckPolicy` is the scheduler handoff. When its `mode` is
`continue_now`, perform one bounded action and read the state again. When its
`mode` is `event_or_due_time`, do not run a fixed-interval empty scan: wait for
one of the listed `triggers`, such as a Workflow Note change, human decision,
recovery evidence, scheduled review, or an input-root change. This policy does
not suppress independent work in another lane; it only prevents repeated
polling of a stable wait item. `pollingAllowed=false` must not be summarized as
"没有可做的事" unless the full idle gate is also true.

Scoped runs such as `people-only` and `enrichment-only` deliberately skip the
film intake, production, publication, and cleanup lanes. They must emit an
explicit `film_lanes_not_scanned` external-lane condition and may never be
used as evidence that the whole workflow is idle or globally blocked. After a
scoped run, the next whole-workflow trigger is a normal bounded film cycle.

Final playable completion still requires the exact Notion structure, completed file upload and destination media block, ffprobe-backed Media Assets, and local-ledger `sync_ready`. Once one useful playable path passes those playback gates, release its work-level visibility and perform incremental website sync even if metadata, poster, `Needs Review`, or issue follow-up remains open; those defects are recorded for later repair and do not by themselves justify `Hide from Website=true`. Final workflow completion is a separate, stricter gate: it additionally requires exact work-page `Metadata Status=verified`, empty issue fields, a usable poster, and live API readback of both playable assets and core metadata. An accepted multipart part, a completed local encode, `sync_ready` alone, or an on-disk search index is not final release proof. Release visibility does not close concrete supplemental variants or authorize source cleanup.

The cycle must never turn a non-playback blocker into a website blocker. **Default to publishing a watchable title; do not wait for routine user approval.** `blocked`, `deferred`, `待人工确认`, `暂缓`, incomplete metadata, missing People, missing poster/rating, optional subtitle or bitrate expansion, and unresolved but currently watchable defects remain workflow follow-up states. They must be reported with an exact next action while the work page stays visible whenever the exposed path is watchable. Only a concrete, current failure of the exposed playback/structure/Media Assets path, or an explicit human visibility hold, may keep the work-level checkbox enabled. A defect that can be repaired after release is not a reason to delay release. If impact is uncertain, fail open for the usable delivery and isolate the uncertainty on the affected child path.
