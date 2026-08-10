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

## States

- `待 AI 处理`: the user asks AI to begin or reopen a work cycle.
- `AI 处理中`: AI has claimed the work. Keep this state when playable
  publication is already `sync_ready` but exact metadata/poster/live-site
  verification is still pending; name the remaining gate in `Workflow Note`.
- `待人工上传`: destination pages are ready and AI is waiting for the user.
- `人工上传中`: the user is still uploading; do not inspect or claim it.
- `已上传待 AI 收尾`: the upload is complete and AI should inspect exact recorded page trees, write/read back Media Assets, and evaluate publication gates.
- `待人工确认`: technical work is complete enough to present a bounded decision, commonly visibility or variant selection.
- `已确认待 AI 发布`: the user explicitly authorizes the final publication step. A standing user instruction that AI controls `Hide from Website` is equivalent authorization for automation-owned gates; in either case, exact media, structure, QC, Media Assets, playback, and metadata/review gates must pass first.
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

1. Query only AI-actionable states: `待 AI 处理`, `已上传待 AI 收尾`, and `已确认待 AI 发布`.
2. Limit each Notion handoff query or claim to three work pages.
3. Re-read each page immediately before claiming it, read the unacknowledged human note tail, then set `AI 处理中` and append an AI acknowledgement marker. Skip it if its current state is no longer actionable.
   The acknowledgement must describe the claimed next action so the human can distinguish a received instruction from an old one.
4. An explicit chat message such as “我上传完了” may be recorded as `已上传待 AI 收尾` for the named work before claiming it.
5. Never treat `人工上传中` as complete, even if media blocks are already visible.
6. When some expected files are absent, return to `待人工上传` and append an AI marker naming the missing specs or episodes. Use `AI Issue` only for a concrete unresolved automation problem.
7. `Hide from Website` is controlled by the workflow: keep it true until media, Media Assets, QC, and structure pass; then clear the automation-owned gate during the authorized publish step. A work page with incomplete metadata, `Needs Review`, or unresolved `Human Issue`/`AI Issue` remains hidden even when its asset row is technically releasable.
8. After an explicit `已确认待 AI 发布` or standing AI-visibility delegation, verify the other gates, apply the visibility change, run website-sync readback, append an AI completion marker, then set `已完成` only when the work-page metadata gate also passes.
9. After a direct publisher operation changes a work page outside `notion-workflow-handoff set`, reconcile the exact completed page IDs into SQLite. This is a bounded read-only mirror refresh, not a library watcher.
10. Continue intake, metadata, and production lanes after processing the bounded handoff batch. The handoff queue does not replace the complete workflow cycle.
11. When metadata is valid but no playable specification can continue, append an AI marker with the exact blocker and recovery condition, then set `暂缓`. Do not use `已完成` for a metadata-only catalog entry.
12. A verified `国配` branch without Chinese subtitles may follow the normal playable completion path. After media, QC, Media Assets, ledger, release, website sync, and live readback pass, set `已完成` and append one concise AI note that Chinese subtitles remain an optional later enhancement. Do not keep the work hidden or under review for that reason alone.
13. For an AI-authored handoff that asks a human to move a spec or season subtree, retain the exact target page ID in the ledger. On each bounded production cycle, re-read up to three such pages when their Notion edit time has advanced or when explicitly named in chat. Run the structure audit before declaring an empty/missing spec. A legacy wrapper whose title equals its parent season page must be unwrapped by the audit before counting specs and episodes.
14. Before writing `已完成`, append one current expansion marker to `Workflow Note`: `[规格扩展:OPEN]` with concrete selected/deferred specs and the earliest `next_review_at`, or `[规格扩展:CLOSED]` with the reason that no further useful source-supported spec is planned. Treat the exact ledger variant rows as machine truth. This marker is not a Notion property and supplemental work does not keep a verified first release hidden.

## Commands

```powershell
node tools/notion-workflow-handoff.mjs schema --json
node tools/notion-workflow-handoff.mjs schema --apply --json
node tools/notion-workflow-handoff.mjs scan --limit 3 --json
node tools/notion-workflow-handoff.mjs claim --limit 3 --apply --json
node tools/notion-workflow-handoff.mjs set --page-id <id> --status "待人工上传" --actor ai --apply --json
node tools/notion-workflow-handoff.mjs reconcile --page-id <id> [--page-id <id> ...] --limit 3 --json
node tools/film-ledger.mjs queue --stage handoff --limit 3 --json
```

Run `schema` in dry-run mode before apply. `scan` queries only actionable statuses and mirrors matching work-page IDs into the local ledger. `reconcile` reads up to three explicit recorded IDs and mirrors their current state without changing Notion. `claim` is write-only and requires `--apply`.
