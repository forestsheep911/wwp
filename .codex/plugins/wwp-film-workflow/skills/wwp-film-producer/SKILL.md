---
name: wwp-film-producer
description: Use when coordinating WWP film or series production, choosing the next workflow step, or routing between source scanning, encoding, Notion publishing, Media Assets, source archives, and metadata backfill. The Chinese command "开始制作影视库" is an explicit request to start the complete autonomous workflow.
---

# WWP Film Producer

## Temporary ISO mounts

Follow the encoder skill's **ISO mount lifecycle** for every disc-image source on Windows and macOS. Track the exact image path, platform, device/mount points, and mount ownership before production. Release workflow-owned mounts after the last source reader finishes, including failure/interruption cleanup; pending uploads or metadata alone do not justify keeping a disc mounted. At each cycle close, check retained mounts from prior production, verify successful release using Windows `Get-DiskImage` or macOS `hdiutil info -plist`, and report any still mounted with their active reader or cleanup failure and next action. Do not eject unrelated drives or delete source images.

## Visibility Is Not a Workflow Blocker

**Default: publish and keep visible; repair afterward.** `Hide from Website`
answers only whether normal users should be prevented from seeing the title. It
must not be used to express that production, QC, metadata, Media Assets, review,
or human confirmation is unfinished. If one correctly mapped playable path is
not known to prevent normal viewing, release/keep the work visible without
asking for routine approval. Missing metadata, uncertain or minor defects,
`Needs Review`, open issues, pending specs/episodes, `AI 处理中`, `待人工确认`,
`暂缓`, or a failed bookkeeping/site-readback step remain separate follow-up
work. A catalog entry also stays visible while waiting for its first playable
asset; keep only its empty destination child hidden. An empty or defective child
path may be isolated without hiding the work.

For this rule, “watchable” means the video opens and its main picture, sound,
and content are identifiable; it does not mean ideal bitrate, color, volume,
subtitle completeness, or metadata. Minor defects, unverified compatibility
concerns, and pending sync/readback are publish-first follow-ups, not hide
reasons. Hide only the exact path with a reproduced failure that actually
prevents ordinary viewing; hide the work only when every usable path fails or
the user explicitly requests a work-level hold.

Set or retain work-level `Hide from Website=true` only for an explicit current
human hold or current evidence that **every** available playable path prevents
normal viewing. A defect affecting only one path may hide only that path. When
impact is uncertain, default to visible and record the exact follow-up. On every
pass, re-evaluate an existing hide; clear it when neither an active human hold
nor current viewing-failure evidence remains. This rule takes precedence over
workflow status, completion gates, and conservative review habits.

**Scope proof is mandatory for a work-level hide:** a note such as “实测无声” or
“无法解码” proves a problem only on the tested path. Unless the note explicitly
identifies that path as the only playable one or confirms all currently usable
paths fail, do not hide the work; isolate the tested spec/episode and keep other
paths and the catalog visible. When the scope is missing, default to visible.

## Stable Production Defaults

The following are the current production defaults. Treat them as the normal
route unless the user gives a more specific instruction:

- Work-level metadata is worth doing even when the source is unsuitable for
  playback or encoding is still running. Metadata and playable production are
  related but independent lanes.
- Apply the subtitle gate only to subtitle-dependent variants. For a Mainland
  Chinese-language film with verified Mandarin original audio, missing Chinese
  subtitles is not a blocker; proceed without added subtitles unless the source
  already has unavoidable burned-in subtitles. Keep the normal Chinese-subtitle
  gate for a separate foreign-original-audio variant.
- Automatic Notion upload is the default after a route probe. Manual upload is
  a bounded fallback for a slow or failed route, or an explicit user choice.
- A missing Clash controller pipe is a local endpoint-discovery failure. One
  failed lookup is not grounds to mark the overall production goal blocked.
  Follow the publisher skill's generated-config and running-pipe diagnostic;
  production cores can expose a dynamic pipe different from both the historical
  fixed name and generated sidecar name. Read back the active controller and
  Notion selector, then clear the blocker immediately when a fresh inspection
  succeeds. Distinguish controller discovery/access, Notion API reachability,
  route-chain verification, and file-transfer failures as separate evidence
  classes. Continue independent local work while a specific network step is
  being repaired; never infer a Notion outage or workflow-wide blocker from a
  controller error alone.
- Series delivery is one playable file per Episode page. Do not build a
  multi-episode collection merely to reduce upload count; collections require
  explicit opt-in.
- `Workflow Status` and `Workflow Note` are the collaboration channel for
  upload handoff. Human text is the unmarked tail; AI acknowledges it with an
  `【AI(^_^) ...】` line. Do not infer completion from `last_edited_time`.
- The active upload/asset lane is complete when the exact destination structure,
  accepted media block, ffprobe-backed Media Assets row, and ledger
  `sync_ready` are verified. Once the exact local path and byte size still match
  that record, the output may move to same-volume `待人工删除`; this is a
  reversible local cleanup, not deletion. Parent release, website index sync,
  and live readback remain separate publication follow-ups and must not keep an
  already-uploaded output on the production disk.
- `sync_ready` is final playable completion, not release completion. A work or
  season may enter `Workflow Status=已完成` for the current release only when its exact work page also
  has `Metadata Status=verified`, no unresolved `Human Issue` or `AI Issue`, a
  usable poster, and targeted website readback proves the poster and core
  metadata are present in the running site.
- Release completion and source-value completion are separate lifecycles. One
  verified useful playable may release the work while concrete supplemental
  variants remain selected or deferred. Those variants, not `Workflow Status`,
  keep expansion queryable and keep the source out of cleanup.
- **Visibility is release-first, not perfection-first.** At the start and end
  of every production/publication pass, check the exact work-level
  `Hide from Website` value. If at least one published path is usable, clear a
  stale automation-owned hide in this pass and continue repairs with the work
  visible. Do not wait for metadata, poster, ratings, People, optional specs,
  `Needs Review`, or final `已完成`; record those as follow-up. If only one
  spec/episode is suspect, isolate that child. Keep the whole work hidden only
  for a current, observed viewing/structure failure affecting every usable
  path, or an explicit human hold. Uncertainty defaults to visible.

These defaults were validated by the recent automatic-upload trial and are the
baseline for future `开始制作影视库` runs:

- Use the Notion hostname and a direct-route preflight for large uploads. Keep
  the resumable multipart manifest and retry only the failed part; manual upload
  is the fallback when the measured route cannot finish within the upload window.
- A user-uploaded file is acknowledged through `Workflow Status` and
  `Workflow Note`, then verified by exact destination-page readback. A parent
  page timestamp is never an upload signal.
- For a series, prepare the season, spec, and every Episode page before any
  upload. Produce and publish one file per episode unless the user explicitly
  requests a collection.
- Metadata backfill, source intake, and playable encoding continue as separate
  bounded lanes while an encode or upload is waiting.

Coordinate WWP film work end to end. Load this first when the user asks to make, continue, publish, repair, or summarize a film/series production task. The complete cycle contract is in `../../references/workflow-cycle.md`.

## Start Command

Treat the exact phrase `开始制作影视库` as the end-to-end start command. Do not ask the user to restate the workflow.

**Pause override:** When the active user instruction or goal pauses People/person enrichment, use `--mode film-only` for every production-cycle invocation and do not enqueue or run People work. Film-only still scans enabled inputs and processes film, publication, cleanup, and bounded base-metadata lanes. Resume enrichment only after the user lifts the pause.

1. Read enabled input roots and pending work from `.local-data/wwp-film-workflow.sqlite`. If the ledger has no enabled input root, use a directory explicitly supplied in the same request; ask for one only when neither source exists.
2. Run `node tools/film-workflow-cycle.mjs --limit 3 --force --mode film-and-current-enrichment --apply-cleanup --json` before reading any lanes when the user explicitly says `开始制作影视库`, reports manual upload completion, changes a Workflow Status/Note, or asks to continue. This explicit handoff read is mandatory even when the filesystem is unchanged. The default single-line production mode finishes the bounded film round first, reaches a stable checkpoint, moves only guarded cleanup-eligible items to their same-volume `待人工删除`, and registers exact current film work IDs in the saved base-metadata → People → honors → highlights campaign. Use `--mode film-only` for a film-only round, `--mode people-only` to resume the narrower saved People campaign, and `--mode enrichment-only` to resume all saved enrichment stages without scanning film inputs. Never launch film and enrichment network stages as separate concurrent tasks. This single entry point performs a fresh bounded scan of every enabled input root in film modes, mirrors only explicit AI-actionable handoffs, and then reads the ledger cycle. It is not a persistent watcher; never report “no new resources” without a fresh scan result from this command. Automatic continuation rounds may omit `--force` and use the one-hour unchanged-scan cooldown. Report these as separate facts: `newlyDiscoveredSources`, `registeredSourcesNeedingProductionReview`, metadata candidates, publication-pending variants, cleanup moves/failures, and enrichment due/blocked/human/deferred counts. `newlyDiscoveredSources=0` only means that this scan found no file-system delta; it does not retract a batch already registered in the ledger. The human-facing summary must say “本轮文件扫描未发现新增或变化” only for the discovery lane and then report the other work lanes; never abbreviate the whole cycle as “无新片”. Do not use Notion parent timestamps or a broad watcher.
3. Claim a bounded actionable handoff before changing it, following `../../references/workflow-handoff.md`. Continue the other workflow lanes after the handoff batch.
4. For each bounded batch, identify new resources and existing works needing metadata/spec repair before selecting playable production. Start work-page creation and metadata backfill as soon as a scanned work is identified. Apply release-first coverage: after the minimum production gates pass, prioritize one releaseable playable for each eligible newly arrived work before supplemental depth on an already covered work. Run independent metadata, destination-page preparation, upload, QC, and encoding work concurrently when practical; use long encode/upload wait time for the non-conflicting lanes. While a long encode or upload is active, monitor that process instead of starting rapid repeated full cycles. After an unchanged scan, wait for that process to close, a user-reported new input batch, or an urgent Workflow Note change before starting another full cycle.
5. Continue through destination structure, playable production, upload handoff, Media Assets, and targeted readback. Before any upload, register the exact ledger target with work/spec/episode page IDs and expected filename. Appending a Notion block does not register a target automatically; if upload preceded registration, register it immediately and keep publication at `assets_pending` until Media Assets creation and exact readback succeed. Reconcile at most three registered Notion targets per run. Media-block reconciliation is only the publication lane, not the workflow trigger or completion test.
6. Record uncertain or deferred decisions and continue with other candidates instead of interrupting the batch. Ask only when a decision blocks every useful next action or requires user-only evidence/action.
7. Treat `qc_passed` as production complete but publication pending. Treat only `sync_ready` as final playable completion. Before setting `Workflow Status=已完成`, run exact metadata maintenance/readback for the work page, require `Metadata Status=verified`, empty `Human Issue` and `AI Issue`, a usable poster, and targeted live-site readback of the poster and core metadata. If playable publication is complete but this metadata gate is not, keep the work in `AI 处理中`, requeue or defer its metadata task with the exact missing fields, and say explicitly that playback is complete while release completion is pending. **This is not a visibility block:** once the playable release gate passes, release the work-level page even when this stricter completion gate is open. Supplemental variants do not block this first-release state.

   **总裁决：先发布可观看条目，后续修缺陷。** 判断依据是普通用户能否观看，不是条目是否完美或工作流是否全部收尾。只要没有具体证据证明现有可用路径影响观看，就保持/恢复网站可见；尚未确认的疑虑也按可见处理并记为后续复核。元数据、海报、字幕/规格补充、抽检、人物、评分、Needs Review、问题字段或 `Workflow Status` 未完成，都不能阻断发布或成为工作级 `Hide from Website=true` 的理由。若一个子规格/集确实有播放问题，只隔离该子路径；只有所有可用路径都被证实影响观看，或用户明确要求整条暂缓公开，才隐藏整个作品。发布后继续修复与流程收尾，不要求先达到 `已完成`。

   **Visibility-first rule:** `Hide from Website` is not the metadata or review master switch. If a normal user can watch the published title, release it even when it is not perfect; record the imperfection as follow-up work. A work page is a catalog entry and stays visible by default while metadata, subtitles, destination pages, or the first playable asset are still being prepared. Once an uploaded video is clearly mapped to its correct work/spec/episode and there is no evidence that normal users cannot watch it, clear the work-level hide flag first, then sync and read back the website. Missing/incomplete ffprobe or Media Assets fields are parallel backfill work, not a visibility blocker unless they actually prevent the website from exposing/opening that video. Do not make `sync_ready` or live-site readback prerequisites for clearing the hide; they close the publication loop after the release action. A failed sync/readback remains publication follow-up and must not be misreported as a playback defect. This applies even when `Metadata Status=partial`, `Needs Review=true`, a poster is missing, or `AI Issue`/`Human Issue` records follow-up work. Keep only the defective empty or unsafe asset/spec hidden. Keep the whole work hidden only for an observed playback failure, page/media mapping that prevents watching, or explicit user hold. **Never re-hide a technically playable work merely because metadata, poster, people, ratings, AI advice, review, naming, a small repairable defect, or optional spec expansion is unfinished.** Once released, visibility is monotonic by default: a later repair pass may re-hide the work only after recording fresh viewing-affecting evidence or a new explicit human hold in `Workflow Note`. A work may therefore remain `AI 处理中` or `待人工确认` while already visible on the website; that status means follow-up work remains, not that playback must be withheld.
   Use the visible-after-usable-publication default: if a known defect does not affect watching, release the work and queue the defect for later repair. If impact is uncertain, do not hide the whole work on suspicion; keep the verified usable delivery visible and isolate the uncertain sibling or review note.
   Every ordinary AI handoff must also normalize legacy visibility: when a work is hidden but the current Workflow Note has no concrete viewing risk and no explicit human hold, clear the work-level hide in that handoff. Do not let an inherited checkbox override the visible-by-default rule.
   **用户最终可见性决策（高于一般流程阻拦）**：每次遇到阻塞，先区分它阻止的是编码、资料补全、人工确认还是普通用户观看；只暂停对应事项，继续其他可执行工作。只要作品还有一条不影响正常观看的已发布路径，就尽量先放出；轻微缺陷、资料缺失、评分/人物/海报待补、规格扩展未完成，不需要再次征求常规发布批准，也不得因此勾选工作级 `Hide from Website`。以后补修不需要先下架。单个规格/集数有实际播放故障，只隔离该路径；只有全部现有播放路径都实际影响观看，或用户明确要求整条暂不发布，才隐藏整个作品。流程状态仍可为 `AI 处理中`、`待人工确认` 或 `暂缓`，它们不代表网站必须隐藏。
   **缺陷容忍默认值**：用户已明确，影视条目只要不影响观看，就应尽量先发布、以后补缺。对轻微画质/资料瑕疵、尚未确认影响的疑虑，不得因“想等更完美版本”而卡发布或勾选隐藏；直接保持可见，将问题和复查条件记入后续队列。只有本轮可复现的故障证明所有当前可用播放路径都无法正常观看，才可隐藏整个作品；若只有单条路径受影响，只隔离该路径。不得把需要人工确认当成默认发布审批。
8. Before completing a released work, create exact ledger variants for every source-supported supplemental spec worth revisiting. Keep later variants `selected` or `deferred` with `next_review_at`, and mirror the latest decision in `Workflow Note` as `[规格扩展:OPEN] ...` or `[规格扩展:CLOSED] ...`. Do not create a new Notion property or a generic placeholder task for this marker.
9. When work-level metadata is complete but no first playable specification can continue, set `Workflow Status=暂缓` with an AI-marked recovery condition. `暂缓` does not imply `Hide from Website=true`: keep the catalog visible unless there is a concrete, current playback failure or a mapping defect that prevents normal viewing on every usable path, or an explicit human hold. Missing technical fields and website-index/sync errors are follow-up work. Do not use work-level `暂缓` merely because a released work still has deferred supplemental variants.
10. Treat `enrichmentCampaign.due` as executable work, not a recommendation.
    For each bounded item, record its stage `in_progress`, load
    `wwp-work-enricher` and the named stage skill, execute that stage, verify its
    external readback where applicable, then run
    `node tools/work-enrichment-campaign.mjs record ...` with `completed`,
    `blocked`, `waiting_user`, or `deferred`. Continue to the next serial stage
    while the same work remains due. A Goal turn may stop only after the bounded
    items have either advanced or acquired an exact non-actionable disposition.

## Goal Continuation Reporting

- A goal round may say there is no due executable item only after auditing every
  still-present source under every enabled input root. If any source remains,
  report its exact disposition from `cycle.lanes.sourceFollowup`: ready to move,
  move failed (including file-in-use/permission evidence), active AI work,
  waiting for human confirmation/upload, scheduled review with its next time,
  retained for an explicit open expansion, or missing identity/coverage/closure
  evidence. Never collapse these states into “没有新的可进行项”. An
  archive-only input is reported as `archive_bundle` while awaiting
  extraction/triage; it is not a film-intake action.
- `cleanup_ready` is executable work. Move that exact eligible source to its
  same-volume `待人工删除` directory with the guarded cleanup tool. If the move
  fails, persist and report the OS error and source path; do not silently leave
  the item in the input queue or mark the goal idle.
- Treat an automatic goal continuation as a scheduling opportunity, not as a request to repeat the last status message.
- After one bounded cycle reports no filesystem delta and no due actionable item, do not immediately run another full cycle or send another user-visible "no change" message. Wait for a real trigger: new user input, a changed source fingerprint, a due ledger review, an active encode/upload transition, or an urgent Workflow Note handoff.
- During long encoding or upload work, report only meaningful progress checkpoints, completion, failure, or a decision request. Do not emit heartbeat-style prose merely because the goal mechanism resumed the thread.
- Persist `continuation.reportPolicy.unchangedStateKey` after each round. When
  `suppressDuplicate=true`, do not send another user-facing idle/wait message
  while that key and the listed `resumeOn` triggers are unchanged. A new input
  fingerprint, due review, process transition, Workflow Note change, or human
  evidence change invalidates the key and permits a fresh report.
- Read the top-level `continuation` object as the Goal decision gate. A local
  Notion, identity, upload, cleanup, or source failure freezes only that item.
  When `continuation.state=actionable_now`, continue another due lane; only
`continuation.canDeclareWorkflowIdle=true` permits calling the whole workflow
  idle. If `canDeclareNoDueAction=true` but the workflow is not idle, list every
  `remainingConditions` category and its exact next trigger.
- When `continuation.goalDisposition=continue`, execute the returned
  `continuation.nextAction` first. It is the bounded routing handoff and carries
  the exact lane and target identifiers; do not turn aggregate actionable counts
  into a status-only report.
- When that next action is an already-eligible People item, route it before
  ordinary metadata backfill after publication, guarded cleanup, and new-source
  intake. This is a scheduling rule, not a gate bypass: People identity,
  authorization, evidence, and readback checks remain mandatory.
- If `continuation.routingGap.code=actionable_work_without_route`, treat the
  round as a workflow routing defect: repair or rerun the bounded ledger cycle
  before reporting anything as idle or Goal-blocked. An actionable count without
  a concrete `nextAction` is never evidence that there is no work.
- Read `continuation.goalDisposition` before changing Goal state. `continue`
  requires another bounded item, `stable_wait` means every remaining item is
  waiting on a named trigger, and `idle` requires the full idle gate. The
  ordinary cycle intentionally returns `canMarkGoalBlocked=false`: item-level
  `blocked`, identity ambiguity, one inaccessible Notion page, a failed cleanup
  move, or a network-stage failure must be recorded on that item and skipped so
  another due item can run. Mark the Goal itself blocked only after a separately
  established workflow-wide blocker has prevented all meaningful lanes for the
  required repeated turns; never infer that condition from the aggregate
  `localBlockers` count.
- Include `continuation.decisionMessage` in the round decision and obey
  `continuation.blockerScope`. `blockerScope=item` means the failure belongs to
  named rows only and can never justify stopping the Goal while another lane is
due.
- Use `continuation.blockerReport.items` when handing off a blocked, waiting,
  or scheduled item. Preserve its exact identifier, reason, and `nextTrigger`;
  do not report only an aggregate count. `goalBlocker=null` and
  `goalMayStop=false` are the normal item-level result, not evidence that the
  whole Goal is blocked.
- Before saying there is nothing to do, check all workflow lanes and distinguish `waiting until due` from `waiting for user evidence`. Report the concrete blocker once, with the next trigger or review time, and suppress identical follow-ups until that evidence changes.
- Follow `continuation.recheckPolicy`: `continue_now` means perform one bounded action and read back state; `event_or_due_time` means do not poll on a short fixed interval and wait for one of its listed triggers. `pollingAllowed=false` never means the workflow is idle unless `canDeclareWorkflowIdle=true`.

## Single-line Film and People Scheduling

- The workflow has one production owner and five current modes: `film-only`,
  `people-only`, `enrichment-only`, the narrower `film-and-current-people`, and
  the default `film-and-current-enrichment`. Add future modes to
  the central mode registry; do not recreate a second autonomous People task.
- A scoped `people-only` or `enrichment-only` run never proves whole-workflow
  idleness: it must leave `film_lanes_not_scanned` as an external-lane
  condition, and the next full bounded film cycle remains required.
- `film-and-current-enrichment` means film first, then base metadata, People,
  honors, and highlights for the exact work IDs selected in the current film
  batch. `film-and-current-people` remains available as a deliberately narrower
  compatibility mode.
  No current work ID means no opportunistic enrichment batch. It does not
  authorize a broad historical library scan. Explicit historical batches must
  be enqueued from a reviewed input file and then resumed with
  `--mode enrichment-only`.
- All film and People network stages share
  `.local-data/wwp-production-network.lock`. If another live owner holds it,
  stop and report that owner instead of retrying in parallel. A dead process's
  stale lock may be reclaimed by the lock helper.
- A variant labelled `encoding` is active only while an observed process command
  line targets its exact output. Reconcile stale encoding rows before scheduling
  new work: record the evidence, close an existing incomplete file as
  `qc_failed` or return an absent-output row to `selected`, and preserve an
  explicit retry trigger. Never let a stale encoding row masquerade as a live
  process or block unrelated production.
- Preserve the People skill's identity, biography, publication, checkpoint, and
  convergence gates. Integration changes scheduling ownership, not editorial
  standards or resumability.

## Stable Workflow Contract

These are the current production defaults. A later user instruction may override
an individual default for the current work, but the agent must record the
override in the ledger and `Workflow Note` rather than silently changing the
workflow.

The following defaults are considered settled for the current plugin revision:

- Metadata creation and repair starts as soon as a work is identified; playable
  production may be deferred or rejected without deferring the catalog entry.
- A series is prepared and published as one file per Episode page. Collections
  are exceptional and require an explicit user instruction for that delivery.
- Automatic Notion upload is attempted after a direct-route preflight. Manual
  upload is only a bounded fallback, and must use a page prepared in advance.
- A production item exits its upload/asset lane after Notion structure, accepted
  media block, Media Assets, and ledger `sync_ready` pass. Exact byte-matched
  local outputs may then be quarantined. Parent release, website sync, and live
  readback continue as separate publication work; they are not local-output
  retention gates.
- A work or season exits the complete workflow only after that playable gate and
  the work-level metadata gate both pass. `Metadata Status=partial`, a generic
  "checked" task reason, or a successful backfill command is never metadata
  completion evidence.
- Finished local outputs are moved to `E:\待人工删除`; normal workflow never
  deletes them directly.

These are workflow defaults, not user-interface requirements. New API-created
Notion pages may use a simple machine-readable page tree and do not need legacy
toggle, callout, or base-like visual containers.

- The complete workflow is metadata-first and media-independent: identify the
  work, prevent duplicates, create or repair the work page, and backfill useful
  metadata even when the source is not playable, the encode is deferred, or no
  Media Asset exists yet.
- Playable production is a separate lane. It requires a bounded source and QC
  decision, while metadata work may continue in parallel during encoding,
  upload, route retries, or manual handoff.
- The input directory is always request- or ledger-configured. Never treat
  `I:\MAKE\queue` as a permanent path. The default output directory is
  `E:\video_made` only when the user has not specified another one.
- An output or quarantine directory must never remain enabled as an input root.
  Disable retired, duplicate nested, and missing roots before the next cycle;
  otherwise produced files can re-enter intake as false new sources.
- A newly seen but incomplete download remains registered in the source ledger,
  while its intake task is machine-deferred and excluded from the executable
  lane. Repeated scans preserve that reason; a later scan that explicitly marks
  the source complete reopens intake automatically. Bound incomplete sources are
  also excluded from production selection until their complete state is observed.
- For new work, prepare the complete destination tree before upload because
  Notion cannot move an uploaded media block through the API: movie work page ->
  spec page; series/season page -> spec page -> one Episode page per episode.
- Automatic Notion upload is the default after route preflight. Manual upload is
  a bounded fallback, and must use the exact prepared destination page plus the
  collaboration status channel.
- Series are published one episode per file by default. A multi-episode
  collection is an explicit exception, not an upload optimization.
- A work is not finally complete at encode, upload, Media Assets write, or
  `sync_ready` alone. The required gates are: destination structure, uploaded
  block, ffprobe-backed Media Assets, exact ledger reconciliation to
  `sync_ready`; then exact work-page metadata maintenance with
  `Metadata Status=verified`, no unresolved issue fields, and a usable poster;
  then parent release, incremental website sync, and live API readback of both
  playable assets and work metadata. Only then may the work be marked `已完成`.
- Preserve existing compact or lower-bitrate specs when a higher-bitrate version
  is added. Correct an inaccurate old ledger title/size from measured output
  bytes, but retain its local output, Notion page, and Media Assets history. A
  high-bitrate version must be a new ledger variant with a new spec child page,
  upload filename, and Media Assets row; never overwrite the old variant.
  For an already completed variant whose measured size or filename was only
  estimated, use the ledger metadata-correction path; it must preserve
  `qc_passed`/`sync_ready` and re-reconcile the exact Notion target afterward.
- Verified finished outputs are moved to `E:\待人工删除` for later human
  deletion. Never place the quarantine directory under `E:\video_made`, and do
  not delete source files or quarantine files as part of normal completion.
- Same-volume quarantine is reversible organization, not capacity reclamation.
  Before encoding, check free space for the selected output volume against the
  expected batch size plus temporary muxing headroom. If the default
  `E:\video_made` volume is full, use a user-approved alternate output or
  staging root (for example on `I:`), record the actual output path in the
  ledger, and do not create a partial file on the full volume. Never delete
  quarantined files merely to make room without an explicit human decision.
- `G:` is an optional external-disk fallback, not a fixed input or output root.
  If it is present and writable, it may temporarily hold encode intermediates,
  completed outputs, or cleanup items when another volume lacks space. Probe
  its write/read performance and free space before a large transfer, record the
  actual path, and verify bytes before removing the original. If it is absent
  or slow, continue without it and do not retry it in a tight loop. Keep any
  G-drive quarantine outside its output root, for example a top-level
  `G:\待人工删除` when no configured quarantine path exists.
- If a finished, verified output was staged on another volume and
  `E:\video_made` has recovered enough capacity, relocate that output back to
  the default root before quarantine. Verify the copied byte count, remove the
  old copy only after verification, and update the variant's exact ledger path
  with a relocation event; do not move active work files or source inputs.
- Moving a source to a same-volume `待人工删除` directory disables routine
  input-root discovery only. For a known original-audio, dubbed-audio,
  commentary, subtitle, compact, or higher-bitrate gap, resolve and probe the
  exact quarantined source from the ledger before declaring the expansion
  impossible or safe to delete. Quarantine location is not an expansion
  decision.
- Each cycle must report all lanes: handoff, intake, metadata maintenance,
  subtitle acquisition, playable production, publication/Media Assets, and source/archive follow-up.
  An empty publication queue or a rate-limited Notion request never ends the
  complete workflow cycle.

## Targeted Recent-Item Checks

- Do not run a global Notion scan just to audit historical spec titles or page structure. Notion API rate limits make that an invalid default workflow.
- When a completed output is smaller than its planned high-tier target but passes playback and QC, reclassify and publish it at the measured size. If a true high tier is still valuable, create a separate deferred variant for that gap. Never make the valid existing output deferred merely to represent an unmade supplement.
- After a production, rename, structure preparation, or manual-upload handoff, inspect only the recent items touched by that run, with a default maximum of 3 exact work/spec targets.
- Check those targets for per-episode size naming, language/audio labels, duplicate specs, episode mapping, and root-level media placement. Check per-collection naming and overlapping ranges only when collection delivery was explicitly enabled. Leave older untouched items for later user-directed repair; an incomplete historical audit is acceptable.
- Prefer exact page IDs recorded in the local ledger. Do not substitute a broad title search or watcher scan when the target IDs are already known.

## Route

- New input directory, queue discovery, or "which one should we do": use `wwp-film-intake` and then `wwp-film-candidate-selector`.
- Existing work pages needing fields, identity repair, or AI advisory refresh: use `wwp-library-maintainer` and `wwp-metadata-backfiller`.
- Playable transcode, subtitles, audio variants, QC, or output files: use `wwp-playable-encoder`.
- A subtitle-dependent source with explicitly confirmed missing Chinese subtitles: use `wwp-subtitle-acquirer` before deferring playable production. After visual subtitle sampling confirms absence, persist both `quality_state=subtitle_missing` and `subtitle_evidence.hardGate=missing_chinese_subtitle`; `verifiedChinese:false` alone is legacy unknown evidence and must return to source review rather than disappearing or starting acquisition. Provider capture is evidence collection; the local workflow still owns compatibility, quality, timing, and final selection.
- A work-level `CLOSED` expansion decision suppresses downstream subtitle-acquisition and intake reopens for that source. Keep the source visible as retained history, but do not let missing-subtitle evidence recreate an actionable task unless the user explicitly reopens the expansion.
- A verified Mandarin-dubbed (`国配`) branch without Chinese subtitles: continue through normal production and publication. Treat subtitles as optional future enrichment, record one concise note, and do not set `暂缓`, `Needs Review`, or `Hide from Website` for that reason alone. A separate foreign-original-audio branch remains subtitle-dependent.
- Series, seasons, episodes, SxxEyy mapping, or episode pages: use `wwp-series-producer`.
- Upload playable files or create/update Notion work/spec pages: use `wwp-notion-publisher`.
- "I uploaded some videos/source myself", recent uploads, or missing Media Assets: use `wwp-media-assets-backfiller`.
- Source/original-disc packaging, source-only pages, 7z volumes, or manual/API source upload: use `wwp-source-archive-operator`.
- Missing film-level metadata, Douban/OMDb/poster/basic info, or AI advisory fields: use `wwp-metadata-backfiller`.

## Default Flow

1. Resolve the input directory from the current request or enabled ledger roots. Do not assume a historical path is fixed.
2. Run `node tools/film-workflow-cycle.mjs --limit 3 --json` to scan/import every enabled root and load the bounded queues in one invocation. A scan is not an encode decision, and a previous cycle's empty result is never reusable for a later cycle.
3. Identify works, perform duplicate/alias preflight, and create/reuse metadata work pages. Metadata tasks are high priority even when playable production is blocked or deferred.
4. Process a small metadata-maintenance batch independently: repair identity, fill sourced fields, run AI advisory fields, and record unresolved issues. This includes old catalog entries with missing or stale fields, not only newly discovered works. Do not stop because no media block is waiting.
5. Select playable candidates by value, source quality, Chinese subtitle availability, Notion state, and production risk. Rank uncovered eligible new works ahead of supplemental variants for already released works. When a worthwhile subtitle-dependent source lacks verified Chinese subtitles, create or continue a bounded `wwp-subtitle-acquirer` task before deferring it; do not let an open browser handoff block metadata or other candidates.
6. For accepted playable candidates, create or reuse the Notion work page and intended destination pages before long encode/upload work when they are missing. Before creating a spec page, scan all existing child spec pages and the work's Media Assets rows, then compare a normalized variant signature: work identity, cut/edition, resolution, codec/container, audio language/variant, subtitle language/treatment, and actual or approximate per-file size. Treat a materially equivalent existing playable asset as occupied even when its title uses a different year, language wording, filename, or rounded size; adopt/backfill its evidence or stop the duplicate route. Preparation must fail closed when equivalence cannot be resolved. Notion's API cannot move uploaded media blocks between pages in this workflow, so destination preparation is mandatory, not optional. Movie uploads need an empty spec child page. Series uploads need a spec page plus one Episode child page per episode by default. When manual upload is likely, report the target title and page ID before encoding starts so the user can upload the finished file to the correct child page rather than the work-page root.
7. Produce playable MP4 variants into the user-specified output directory, or `E:\video_made` when none is specified.
8. Run probe/QC before upload. For HDR/Dolby Vision or any reported color cast, require matched source-reference/final frames at distributed timestamps and record whether the cast was introduced by conversion or already present in the source. Do not let an output-only contact sheet silently pass a suspicious source grade: defer or isolate that exact encode until evidence is sufficient. This is a production/QC decision, not a work-level visibility decision; keep any other usable path visible, and keep the work visible by default if impact remains uncertain.
9. Publish playable output to Notion automatically by default after a successful route probe. Preserve the resumable upload manifest. Fall back to an exact manual-upload handoff only when the route is below the safe-start threshold, bounded retries still fail, or the user explicitly chooses manual upload. Then write Media Assets from `ffprobe` and production manifests.
10. Revisit remaining metadata tasks and prepare/upload completed outputs while encodes wait; publication is only one queue. A metadata task may be completed only after exact readback yields `Metadata Status=verified`. Leave `partial` work pending when another automatic source or AI pass is available; otherwise defer it with `missingCoreFields`, the attempted sources, and `next_review_at`.
11. Before release completion, refresh the exact work in the website index and read the live result. Require a non-empty poster resolved from a maintained poster field and require the live metadata projection to contain the core identity/descriptive fields. A Notion `Poster URL` that cannot be fetched/cached is not a usable poster.
12. Record the source-expansion decision separately from release completion: exact planned variants remain in the production queue or deferred queue, while a closed decision says why the current specs have exhausted useful source value.
13. Report intake, catalog maintenance, first-release coverage, supplemental production, upload, Media Assets, metadata status, website-sync, and deferred-decision states separately. `node tools/film-ledger.mjs cycle --limit 3 --json` is the bounded start-of-cycle dashboard; Media Assets is only the publication reconciliation substage.

## Round-Robin Continuation Rule

Every execution cycle must treat these as parallel work lanes, in this order:

1. **Collaboration handoff**: mirror and claim at most three explicit actionable `Workflow Status` rows. Ignore `人工上传中`; `已上传待 AI 收尾` is the manual-upload completion signal.
2. **Intake**: inspect a small batch of newly discovered or changed source directories, resolve identity and duplicate risk, bind each source, and create its work-level metadata task.
3. **Metadata maintenance**: process a small batch of new and old work pages independently of playback. Fill sourced fields, repair canonical identity, generate AI advisory values after sourced data is coherent, and record unresolved `AI Issue` items. If a newly identified work has no Notion page yet, the first metadata action is exact identity/duplicate preflight followed by `notion-create-work-page.mjs --work-id <id> --apply`; read back the page ID, `影别`, title, and initial hidden state before running the backfiller. Do not report this as an ordinary metadata no-op or close its task while page creation remains incomplete. Close a metadata task only after the exact page reads back as `Metadata Status=verified`; `partial` must remain pending or be explicitly deferred with missing-core evidence and a review time.
4. **Production**: first cover each eligible new work with one releaseable spec, then select due supplemental variants by fan value. Prepare the destination structure before encoding. A verified `国配` branch passes the subtitle gate without Chinese subtitles; record the missing subtitle as optional enrichment rather than deferring it.
5. **Publication and Media Assets**: reconcile only bounded exact targets. Prefer resumable automatic upload; use manual upload as a recorded fallback, not the normal path. A missing upload is a pending handoff, not a reason to stop the other lanes.
6. **Source/archive and deferred maintenance**: retain blocked, user-decision, source-only, cleanup, and later-backfill tasks with reasons and next-review times; do not silently discard them.

The cycle may end only after these work areas have been checked and the next bounded batch is recorded. `publication` being empty, or all current media blocks being accounted for, never means the overall film-library workflow is complete while intake, catalog maintenance, source/archive follow-up, or `metadata_backfill` review is still due. For the full stop criteria, read `../../references/workflow-cycle.md`.

## Guardrails

- Existing Notion works should be reused; do not create duplicate work pages for supplemental specs.
- Mandarin-dub production is automatic for children's/animation/family works and for valuable missing Mandarin/Cantonese coverage on an existing library work when normal gates pass. For ordinary foreign films and supplemental Mandarin versions of Hong Kong films, ask the user first and disclose the complete output count, especially when compact and higher-bitrate tiers would make the matrix double. This question blocks only the optional Mandarin branch; continue other deterministic lanes.
- Before creating any work page, run the multi-alias identity preflight in `../../references/work-title-identity-rules.md`. Search Chinese, English, original, regional, filename/source, season, yearless, and temporary-title forms plus all known external IDs. A weak or noncanonical old title is still an existing work and must be repaired instead of duplicated.
- Canonicalize work titles from the verified Douban display title when available; otherwise use a verified authoritative fallback and include the foreign/original title and release year. Title cleanup is independent from playable readiness.
- Spec backfill can be as important as new-film creation when the existing specs are weak.
- For foreign-language works, treat original-language playable coverage as the baseline and dubbing as supplemental. A completed dubbed branch does not close source expansion while compact original audio, or a justified high-bitrate original branch for a high-value film, remains neither produced nor concretely deferred with a blocker.
- Metadata collection is not gated by playable readiness. If a scanned work is worth cataloging, create or repair its work-level metadata even when no video is ready to upload.
- Do not block work-page creation and sourced metadata backfill on video upload readiness. Playable Media Assets rows still require real uploaded/probed media evidence.
- Avoid root-level manual upload cleanup by preparing the page structure early. Because uploaded media blocks cannot be moved by Notion API, a planned movie encode must have a target spec child page, and a planned series encode must have a target spec page plus Episode child pages, before upload. If the target pages cannot be prepared, do not start automatic upload or invite manual upload yet.
- For normal series delivery, create and upload one playable file per Episode page. Do not build collection files merely to reduce upload work; collection delivery requires an explicit user instruction and the uploader's explicit opt-in flag.
- Source/original-disc upload is not the default playable production path.
- A deferred production decision must not be reconsidered every cycle. Keep it
  visible in status, but only select it again after its `next_review_at` is due
  or after an explicit human retry.
- Never clear or archive a bound source while a concrete supplemental variant is
  selected, deferred, encoding, QC-pending, or publication-pending. A released
  work may be `已完成` while its source remains active for expansion.
- If the user explicitly cancels an optional variant after QC but before upload, or an existing canonical media asset makes a prepared duplicate unnecessary, confirm that no upload is in flight, archive only its exact empty placeholder page when applicable, and retire the ledger variant with `retire-variant`. It records terminal publication state `cancelled`; do not mark a retired variant `sync_ready`, and do not leave it in `upload_pending` or `assets_pending` where a later cycle can select it again.
- An empty production queue does not mean the workflow is idle. Check `queue --stage intake`, `queue --stage metadata`, and `queue --stage subtitle` before stopping.
- Do not claim completion until Notion or Media Assets readback proves the external state.
- Do not claim release completion from `sync_ready` alone. Exact work-page
  metadata verification and live poster/core-metadata readback are additional
  hard gates for `Workflow Status=已完成`.
- Treat `Workflow Status` as collaboration state only. It does not replace `Media Availability`, `Hide from Website`, `Needs Review`, production state, or publication state.
- Read the unacknowledged plain-text tail of `Workflow Note` as the human instruction, then append an AI acknowledgement marker without changing it. `Human Issue` and `AI Issue` contain unresolved issues only; use neither as a coordination log.

## References

- Selection and value rules: `../../references/decision-rules.md`
- Encoding and stream reuse rules: `../../references/encoding-rules.md`
- Notion and Media Assets rules: `../../references/notion-media-assets.md`
- Metadata sources: `../../references/metadata-sources.md`
- Script inventory: `../../references/script-map.md`
- Work title and duplicate prevention: `../../references/work-title-identity-rules.md`
- Human/AI collaboration handoff: `../../references/workflow-handoff.md`
- Storage and optional external-disk handling: `../../references/storage-rules.md`
