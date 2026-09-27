# Workflow Handoff Contract

Use the work-level Notion fields `Workflow Status` and `Workflow Note` as the explicit collaboration channel between the user and Codex. Do not use parent-page `last_edited_time` as proof that a manual upload finished. For an exact recorded page awaiting a manual tree move, however, a changed edit time is sufficient reason to re-read that page's structure; the resulting topology and media evidence, not the timestamp, determine whether work can continue.

## Fields

- `Workflow Status` is a controlled select and the machine-readable handoff signal.
- The user appends an instruction as ordinary plain text at the end of `Workflow Note`; multiple lines are one instruction and have no prefix or timestamp.
- AI entries are one line beginning with `【AI(^_^)`, for example `【AI(^_^) 2026-07-31T03:00:00.000Z】 已认领上述人工说明，开始处理。`.
- The plain-text tail after the latest AI entry is the unacknowledged human instruction. AI reads it, claims the work, then appends an AI acknowledgement without changing the human text. That marker is the acknowledgement boundary: on the next pass, text before it is history and must not be claimed again.
- Only automation may write the `【AI(^_^) ...】` marker. Human collaborators write ordinary text on a new line, even when correcting an earlier request; they do not need to edit, quote, or remove the AI history.
- Mirror observed status and the complete `Workflow Note` into `.local-data/wwp-film-workflow.sqlite`.
- `Human Issue` and `AI Issue` are issue records only, not a handoff inbox or an activity log.

Keep these fields separate from media and review truth:

- `Media Availability`: verified media capability.
- `Hide from Website`: website visibility authorization.
- `Needs Review`: unresolved quality/review gate.
- `AI Issue`: unresolved automation problem, not a run log.
- `Developer Memo`: durable technical/source evidence, not collaboration state.

Visibility default: the parent work page is a visible catalog entry while
metadata or the first playable spec is being prepared. Do not set or retain
`Hide from Website` merely because the work is incomplete or has no playable
asset yet. Hide empty child specs/episodes until usable media exists, and hide
the parent only for a concrete playback failure, a verified mapping error that
prevents normal viewing, or an explicit human hold. Missing Media Assets data
or failed readback alone is follow-up work.

## States

- `待 AI 处理`: the user asks AI to begin or reopen a work cycle.
- `AI 处理中`: AI has claimed the work. Keep this state when playable
  publication is already `sync_ready` but exact metadata/poster/live-site
  verification is still pending; name the remaining gate in `Workflow Note`.
- `待人工上传`: destination pages are ready and AI is waiting for the user.
- `人工上传中`: the user is still uploading; do not inspect or claim it.
- `已上传待 AI 收尾`: the upload is complete and AI should inspect exact recorded page trees, write/read back Media Assets, and evaluate publication gates.
- `待人工确认`: use only when a decision genuinely requires human judgment (for example, choosing between materially different variants or resolving ambiguous identity). It is never a routine website-publication approval state: under the user's standing delegation, publish a correctly mapped path unless there is concrete evidence it prevents normal viewing or the user explicitly holds it. A watchable work may remain in this status while visible.
- `已确认待 AI 发布`: the user explicitly authorizes the final publication step. A standing user instruction that AI controls `Hide from Website` is equivalent authorization for automation-owned visibility. For visibility release, require only that the uploaded block is mapped to the exact work/spec/episode and there is no concrete evidence it prevents normal viewing; do not wait for full QC, ffprobe/Media Assets completion, ledger closure, or website readback. Those remain follow-up/closure checks. Metadata/review defects may remain visible unless they affect playback or the human explicitly requests a hold.
- `已完成`: the current release for the work or season is complete and read back. Both
  gates must pass: (1) destination structure, uploaded media, Media Assets, QC,
  and ledger `sync_ready`; (2) exact work-page `Metadata Status=verified`, empty
  `Human Issue`/`AI Issue`, and a usable poster. Authorized release and live
  website readback must then show both the expected playable assets and the
  poster/core metadata. Neither metadata completion nor `sync_ready` alone
  qualifies. This state does not mean that the retained source has no further
  useful variants.
- `暂缓`: retain a work and its recovery condition without repeatedly selecting it. Use this after metadata-only completion whenever subtitle-dependent playable work is blocked or deferred by missing/unsuitable Chinese subtitles, source quality or completeness, color risk, unresolved identity, or another production gate. Do not use `暂缓` solely because a verified `国配` branch lacks Chinese subtitles.

## Operating Rules

**发布优先于完美和流程收尾：** 只要已上传的视频块确认对应正确作品及规格/集页面，且没有具体证据表明普通用户无法观看，本轮就先解除作品级 `Hide from Website` 并继续网站同步。无需等待完整质检、ffprobe、Media Assets 字段补录、账本 `sync_ready` 或网站读回；这些仍须在发布后并行/后续完成，但失败属于同步/资料待办，不自动证明视频不能观看。也无需等待元数据、海报、评分、人物、问题单、轻微瑕疵修复或可选规格全部完成。发现不影响观看的缺陷，写入后续修复队列即可。只有本轮有具体证据证明当前唯一/全部可用路径影响观看、页面/媒体映射错误导致打不开视频，或用户明确要求暂不公开，才保持作品级隐藏；单一路径故障只隔离对应子项。`已完成` 仍可等待严格收尾条件，但它不是发布前置状态。

1. Query only AI-actionable states: `待 AI 处理`, `已上传待 AI 收尾`, and `已确认待 AI 发布`.
2. Limit each Notion handoff query or claim to three work pages.
3. Re-read each page immediately before claiming it, read the unacknowledged human note tail, then set `AI 处理中` and append an AI acknowledgement marker. Skip it if its current state is no longer actionable.
   The acknowledgement must describe the claimed next action so the human can distinguish a received instruction from an old one.
4. An explicit chat message such as “我上传完了” may be recorded as `已上传待 AI 收尾` for the named work before claiming it.
5. Never treat `人工上传中` as complete, even if media blocks are already visible.
6. When some expected files are absent, return to `待人工上传` and append an AI marker naming the missing specs or episodes. Use `AI Issue` only for a concrete unresolved automation problem.
7. `Hide from Website` is controlled by the workflow's minimal-blocker rule. Hide a child spec/episode/asset only while that exact path has a concrete playback failure that prevents normal viewing, a verified page/media mapping error that makes the site open the wrong video or fail to open it, or an explicit human hold. Missing/incomplete Media Assets, ffprobe fields, index readback, and other technical bookkeeping are not viewing failures, even when confirmed missing, unless the website consequently cannot open the intended video. The work-level checkbox is narrower: one bad child, missing optional spec, incomplete metadata, missing poster/rating, unfinished People/AI enrichment, `Needs Review`, unresolved issues, naming cleanup, and open optional expansion must not hide the whole title when another playable path remains. If the only or all playable paths are affected, the work may remain hidden with exact evidence recorded. Once an uploaded video block is confirmed on its exact work/spec/episode page, with no evidence normal users cannot watch it, release the work-level page and isolate unfinished siblings instead of blocking the whole title. Do not wait for ffprobe/Media Assets completion, ledger `sync_ready`, or website readback; finish those as publication follow-up and do not re-hide on a bookkeeping/sync failure alone. Visibility release and `已完成` are separate operations: use `--release-visibility` after exact block/page mapping and one usable playback path are verified, and reserve `--release-work` for the stricter final completion gate. If the stricter gate fails, leave the work visible and keep the exact missing fields in the follow-up queue. The explicit release command must not be blocked by stale or child-scoped playback notes; the caller's exact usable-path verification is authoritative. Only an explicit current human work-level hold can stop that release. In code, metadata and issue checks are named `workCompletionBlockers`; they are never website-visibility blockers.
   Keep the three gates separate in every report: `visibility` answers whether a normal user can watch, `follow_up` answers whether repair/review remains, and `completion` answers whether the work may be marked `已完成`. `follow_up` and `completion` failures must never be copied into `Hide from Website=true`.
   Ordinary AI handoff writes also repair a stale work-level hide: if the page is hidden but its current Workflow Note contains neither a concrete viewing risk nor an explicit human hold, the handoff clears `Hide from Website=false` in the same write. This prevents legacy or over-conservative hidden flags from silently blocking otherwise watchable catalog entries.
   The note is append-only history, so this check uses the latest AI handoff segment rather than matching an old resolved playback incident forever. Phrases such as `已修复`, `播放正常`, or `通过声音复核` clear the old risk; a newly recorded unresolved playback risk or explicit human hold still keeps the work hidden.
   Human confirmation such as `可以发布`、`质检通过`、`允许同步` has the same effect: it resolves an older visibility warning when the same line does not introduce a newer playback risk. A later `仍然无声音`/`仍然无法解码` statement wins and keeps only the affected path hidden.
   **先放后修（默认动作）**：当已有播放路径不会影响正常观看时，本轮必须优先清除工作条目的 `Hide from Website`，再把缺陷写入 `Workflow Note`/`AI Issue` 并排入后续队列。不能因为“还没补完”“还在 `AI 处理中`/`待人工确认`”“有待复核”“资料不全”而主动勾选隐藏。轻微瑕疵、待补资料、可选规格未做完，以及影响不确定的问题，都按“可观看”处理；若无法证明会影响观看，按“可观看”处理。只有证据表明整部作品或唯一可播放路径确实影响观看，或人类明确要求暂不发布，才允许维持工作级隐藏。单个规格、单集、媒体块或子页面的问题只隔离对应子路径。
   **不要把“正常观看”抬高成“理想成片”：** 能打开且主要画面、声音和内容可辨识就先公开；码率、色彩、音量、字幕或资料的小问题以及尚未验证的疑虑都记为后续修复。只有复现到实际妨碍观看的故障才隐藏对应子路径；确认所有可用路径都受影响，才隐藏作品。
   这不是可选建议：每轮读取到作品级隐藏状态时，都要结合当前可用路径重新判定；发现至少一条已发布且可观看的路径，就在本轮解除陈旧的自动隐藏，不等资料补齐或用户再次提醒。不要把某一个规格的 QC 暂停扩大成整部作品下架。
   **实际故障证据门槛**：将工作级 `Hide from Website` 改为 `true` 前，必须在本轮确认并记录：具体的作品/规格/集页面或媒体块、实际测试的播放入口与环境、观察到的故障，以及该故障是否影响全部当前可用播放路径。仅凭编码/色彩/音轨的理论风险、历史问题、单一非目标客户端表现、未复现的报告或“质量不够理想”不得隐藏；影响范围不明时保持可见并排入复核。若只有一个规格或客户端路径受影响，只处理该子路径，不连带隐藏作品。只要已上传媒体块与目标作品/规格/集的对应关系明确，且没有证据表明普通用户无法观看，就先放行并继续网站同步；缺失或不完整的 ffprobe/Media Assets 字段作为并行补录任务，只有它实际导致网站无法呈现/打开该视频时才构成可见性阻断。抽检发现的小瑕疵不应变成全片发布门槛。
   这条规则优先于“完成度”判断：`Workflow Status` 可以继续停留在 `AI 处理中`、`待人工确认` 或 `暂缓`，但只要观看路径没有被证明有问题，工作页面仍应公开。只有实际播放/解码/声音/画面颜色故障影响全部可用路径，或经验证的页面/媒体映射错误导致网站打不开目标视频或播放了错误视频，或人类明确要求暂不发布，才允许工作级隐藏。单纯 Media Assets 缺失/读回失败、API 读回失败、索引同步失败或技术登记不全属于发布后续任务，不是下架理由。
   **隐藏必须可解释**：任何把工作级 `Hide from Website` 设为 `true` 的自动操作，都必须在同一次操作的 `Workflow Note` 中写出上条要求的实测环境、具体故障和影响范围，或明确的“暂不发布/人工保留隐藏”要求。单纯的资料缺失、`Needs Review`、People/海报/评分未补、规格扩展未完成、状态仍在处理中，不能作为隐藏理由；若影响不确定，默认可见并记录后续任务。
8. After an explicit `已确认待 AI 发布` or standing AI-visibility delegation, verify the minimum uploaded-block/page mapping and lack of a known playback failure, apply the visibility change immediately, then run website-sync and Media Assets/ledger readback as required follow-up. Record any sync failure without re-hiding a watchable title. Set `已完成` only when the separate work-page metadata and finalization gate also passes.
9. After a direct publisher operation changes a work page outside `notion-workflow-handoff set`, reconcile the exact completed page IDs into SQLite. This is a bounded read-only mirror refresh, not a library watcher.
10. Continue intake, metadata, and production lanes after processing the bounded handoff batch. The handoff queue does not replace the complete workflow cycle.
11. When metadata is valid but no playable specification can continue, append an AI marker with the exact blocker and recovery condition, then set `暂缓`. `暂缓` is a production-recovery state, not a website-hide command: preserve the current visible catalog state unless the same run records a concrete viewing risk or an explicit human visibility hold. Do not use `已完成` for a metadata-only catalog entry.
12. A verified `国配` branch without Chinese subtitles may follow the normal playable completion path. After media, QC, Media Assets, ledger, release, website sync, and live readback pass, set `已完成` and append one concise AI note that Chinese subtitles remain an optional later enhancement. Do not keep the work hidden or under review for that reason alone.
13. For an AI-authored handoff that asks a human to move a spec or season subtree, retain the exact target page ID in the ledger. On each bounded production cycle, re-read up to three such pages when their Notion edit time has advanced or when explicitly named in chat. Run the structure audit before declaring an empty/missing spec. A legacy wrapper whose title equals its parent season page must be unwrapped by the audit before counting specs and episodes.
14. Before writing `已完成`, append one current expansion marker to `Workflow Note`: `[规格扩展:OPEN]` with concrete selected/deferred specs and the earliest `next_review_at`, or `[规格扩展:CLOSED]` with the reason that no further useful source-supported spec is planned. Treat the exact ledger variant rows as machine truth. This marker is not a Notion property and supplemental work does not keep a verified first release hidden.

## Commands

```powershell
node tools/notion-workflow-handoff.mjs schema --json
node tools/notion-workflow-handoff.mjs schema --apply --json
node tools/notion-workflow-handoff.mjs scan --limit 3 --json
node tools/notion-workflow-handoff.mjs claim --limit 3 --apply --json
node tools/notion-workflow-handoff.mjs set --page-id <id> --expected-title "<exact work title>" --status "待人工上传" --actor ai --apply --json
node tools/notion-workflow-handoff.mjs set --page-id <id> --expected-title "<exact work title>" --status "暂缓" --actor ai --apply --json
node tools/notion-workflow-handoff.mjs set --page-id <id> --expected-title "<exact work title>" --release-visibility --hide-from-website false --actor ai --apply --json
node tools/notion-workflow-handoff.mjs reconcile --page-id <id> [--page-id <id> ...] --limit 3 --json
node tools/film-ledger.mjs queue --stage handoff --limit 3 --json
```

Run `schema` in dry-run mode before apply. `scan` queries only actionable statuses and mirrors matching work-page IDs into the local ledger. `reconcile` reads up to three explicit recorded IDs and mirrors their current state without changing Notion. `claim` is write-only and requires `--apply`. An explicit `set` also requires the exact current work title; the tool retrieves the page and rejects a mismatch before mutation so a stale or copied page ID cannot change another work. Use the exact boolean `--hide-from-website true` only for an explicit human hold or a concrete viewing failure that leaves no usable work-level path. After confirming the uploaded media block is mapped to the exact work/spec/episode page, `--release-visibility --hide-from-website false` clears only the work visibility gate and preserves the current workflow status and metadata follow-up; do not wait for ffprobe/Media Assets, `sync_ready`, or site readback. Complete those checks after releasing visibility. The exact Media Assets publisher manifest remains useful for recording/closing publication evidence; `notion-workflow-handoff --release-work` additionally marks the work `已完成` and therefore still requires the metadata/review completion gates.
