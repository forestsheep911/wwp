# Workflow Handoff Contract

Use the work-level Notion fields `Workflow Status` and `Workflow Note` as the explicit collaboration channel between the user and Codex. Do not use parent-page `last_edited_time` as proof that a manual upload finished.

## Fields

- `Workflow Status` is a controlled select and the machine-readable handoff signal.
- `Workflow Note` is shared current-cycle context. Append timestamped actor entries; do not overwrite human text.
- Mirror observed status and note values into `.local-data/wwp-film-workflow.sqlite`. SQLite events retain durable history; the Notion note may remain concise.

Keep these fields separate from media and review truth:

- `Media Availability`: verified media capability.
- `Hide from Website`: website visibility authorization.
- `Needs Review`: unresolved quality/review gate.
- `Human Issue` and `AI Issue`: unresolved problems, not run logs.
- `Developer Memo`: durable technical/source evidence, not collaboration state.

## States

- `待 AI 处理`: the user asks AI to begin or reopen a work cycle.
- `AI 处理中`: AI has claimed the work.
- `待人工上传`: destination pages are ready and AI is waiting for the user.
- `人工上传中`: the user is still uploading; do not inspect or claim it.
- `已上传待 AI 收尾`: the upload is complete and AI should inspect exact recorded page trees, write/read back Media Assets, and evaluate publication gates.
- `待人工确认`: technical work is complete enough to present a bounded decision, commonly visibility or variant selection.
- `已确认待 AI 发布`: the user explicitly authorizes the final publication step. This is the only handoff state that may authorize clearing an otherwise unexplained `Hide from Website`, and only after all other gates pass.
- `已完成`: the current requested work cycle is complete and read back. A later source, spec, or metadata refresh may reopen it as `待 AI 处理`.
- `暂缓`: retain the work and the reason without repeatedly selecting it.

## Operating Rules

1. Query only AI-actionable states: `待 AI 处理`, `已上传待 AI 收尾`, and `已确认待 AI 发布`.
2. Limit each Notion handoff query or claim to three work pages.
3. Re-read each page immediately before claiming it, then set `AI 处理中`. Skip it if its current state is no longer actionable.
4. An explicit chat message such as “我上传完了” may be recorded as `已上传待 AI 收尾` for the named work before claiming it.
5. Never treat `人工上传中` as complete, even if media blocks are already visible.
6. When some expected files are absent, return to `待人工上传` and name the missing specs or episodes in `Workflow Note`.
7. When media, Media Assets, QC, and structure pass but visibility is still intentionally gated, use `待人工确认`. Do not clear `Hide from Website`.
8. After `已确认待 AI 发布`, verify the other gates, apply the authorized visibility change, run website-sync readback, then set `已完成`.
9. Continue intake, metadata, and production lanes after processing the bounded handoff batch. The handoff queue does not replace the complete workflow cycle.

## Commands

```powershell
node tools/notion-workflow-handoff.mjs schema --json
node tools/notion-workflow-handoff.mjs schema --apply --json
node tools/notion-workflow-handoff.mjs scan --limit 3 --json
node tools/notion-workflow-handoff.mjs claim --limit 3 --apply --json
node tools/notion-workflow-handoff.mjs set --page-id <id> --status "待人工上传" --note "目标规格页已准备。" --actor ai --apply --json
node tools/film-ledger.mjs queue --stage handoff --limit 3 --json
```

Run `schema` in dry-run mode before apply. `scan` queries only actionable statuses and mirrors matching work-page IDs into the local ledger. `claim` is write-only and requires `--apply`.

