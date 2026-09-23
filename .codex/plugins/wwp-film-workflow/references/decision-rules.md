# WWP Decision Rules

## Inputs

- The video/source input directory is provided by the user for the current task. Do not treat any historical path as fixed.
- If the user does not provide an input directory, ask or propose a context-derived candidate and wait for confirmation before scanning heavily.
- The playable output directory defaults to `E:\video_made` only when the user has not specified another output path.

## Scan Targets

Look for media files, folders, BDMV/ISO structures, remuxes, NFOs, subtitle packs, extras, director cuts, commentary tracks, Mandarin/Cantonese/original audio, and series episode naming. Group variants of the same work together before deciding.

## Notion State

Classify each candidate as:

- new work not in Notion
- existing work with sufficient specs
- existing work with meaningful spec gaps
- possible duplicate or ambiguous match
- series/season/episode workflow instead of movie workflow
- source-only/archive workflow instead of playable workflow
- metadata-only cataloging candidate when playable production is blocked, deferred, or not worth doing now

Supplemental specs can be as valuable as new works when existing specs are weak, but a newly arrived batch follows release-first coverage: give every eligible work one releaseable playable before deepening an already covered work. Once that coverage round is complete or the remaining works are blocked, return to high-value supplemental specs.

Work-level metadata is a separate high-priority track. If a scanned work is worth collecting, do not skip cataloging just because the current source lacks subtitles, has color risk, is too large, or has no immediate playable path.

## Hard Gates

### Minimal Visibility Blockers

**默认不勾选 `Hide from Website`。** 这是“网站现在是否应该隐藏”开关，不是
“这条工作是否还有待办”的开关。只要已经存在的公开路径不影响正常观看，或者
目前只是资料/规格尚未补齐，就应保持可见；后续修复不需要先下架。`AI 处理中`、
`待人工确认`、`暂缓`、`Needs Review`、缺海报、缺人物、评分待补、标题待整理、
可选规格未做，均只能生成 follow-up，不能自动把工作条目设为隐藏。

`Hide from Website` is the narrowest playback safety gate in this workflow.
It is not a conservative default: if the evidence does not prove a viewing
failure, the work remains visible and the uncertainty is recorded as follow-up.
At work level it is fail-open: a defect in one spec, episode, or asset does not
hide the whole title while another playable path remains. Hide the work only
when the only/all playable paths are affected or the user explicitly requests
a hold; hide a child path independently when that exact path cannot be watched.
The practical default is: **if a normal user can watch the published title,
release it even when it is not perfect**. Missing metadata, a missing poster,
unfinished People enrichment, a pending subtitle/variant, a naming defect, or a
small repairable quality issue belongs in the follow-up record, not in the
work-level visibility gate.
The work page is also a catalog entry, so it may remain visible while metadata
is being collected or while the first playable spec is being prepared. Use it
only for a concrete reason that can stop or materially corrupt normal viewing
of an exposed media path: a broken or misplaced media/page structure, a failed
Media Assets or website readback, an unresolved codec/audio/color/subtitle
compatibility risk with evidence of viewing impact, or an explicit human hold.
Do not use it as a general
"not finished" flag. Once any one exact specification or episode is usable,
release the work-level page and isolate unfinished siblings at their own
specification/episode/asset level. Missing metadata, poster, ratings, People,
AI advice, review, naming cleanup, issue follow-up, or optional variants are
repair work and must not prevent an otherwise watchable title from appearing.
Minor defects and incomplete catalog data are not visibility blockers. When
impact is uncertain, prefer the verified playable delivery being visible
and record the uncertainty in `Workflow Note`/`Needs Review`; re-hide only after
new viewing-affecting evidence or a fresh human hold.
Words such as “可能无法播放”“疑似解码问题”“待确认播放风险” or “待复核” are
not viewing evidence by themselves. They must fail open and keep the title
visible until a real playback/QC/readback failure is recorded. Do not turn a
precautionary suspicion into `Hide from Website=true`.
An explicit instruction such as “有一点缺陷以后补”“先放出再修” or “不影响观看”
is a release decision, not a hide decision: clear the work-level flag and keep
the defect in the follow-up queue. Do not reinterpret that instruction as a
human visibility hold just because the old note contains a prior playback risk.
If the evidence names only one spec, episode, media block, or child page, treat
that as a child-path issue and keep the work page visible when another path is
usable. A work-level hide requires evidence that the whole title or its only
playable path is affected; a small defect that can be repaired later is not
enough.

#### Three independent gates

Every handoff must classify these gates separately. Never copy a failure from
one gate into another:

| Gate | Question | Typical blockers | Default action |
| --- | --- | --- | --- |
| Website visibility | Can a normal user watch an exposed path? | no audio, decode failure, black/green picture, broken page/media relation, failed Media Assets readback, explicit human hold | Hide only the affected child; hide the parent only when the only/all exposed paths are unsafe |
| Follow-up/review | Is there something worth repairing or confirming? | poster, score, People, AI advice, naming, missing optional variant, `Needs Review`, issue note, uncertain but currently watchable defect | Keep visible; record the exact follow-up and continue other lanes |
| Final completion | Can this work be called `已完成`? | metadata not verified, unresolved issue fields, missing poster, open expansion decision | Keep visible if playback is usable; retain `AI 处理中`/`待人工确认` and requeue the missing work |

The second and third rows are not reasons to set `Hide from Website=true`.
Likewise, an empty or not-yet-encoded child page may be hidden as an isolated
child path, but its parent catalog entry remains visible by default. If impact
is uncertain, fail open for the verified usable delivery and write the evidence
to `Workflow Note`/`Needs Review`; do not turn uncertainty into a parent-level
visibility block.

- **Visibility decision order:** first ask whether a normal user can play at least
  one exact published spec/episode. If yes, publish the work unless there is a
  concrete playback/structure/Media Assets defect or an explicit human hold.
  Do not turn a metadata, poster, rating, People, review, naming, optional-spec,
  or other repair task into `Hide from Website=true`. Those are follow-up queues,
  not viewing failures. If no playable path exists yet, keep the parent catalog
  entry visible unless an exposed path has a concrete viewing risk; metadata-only
  entries are valid catalog entries. Keep empty child spec/episode pages
  hidden until they have usable media, and record the missing playable path as
  workflow follow-up.
- **Default to visible after usable publication:** when a work has any verified
  playable delivery and the known defects do not affect watching, the default
  action is to clear `Hide from Website` in the same publication pass. Do not
  choose hidden merely because the work is imperfect, still under AI follow-up,
  or has a sibling delivery that is unfinished. If uncertain whether a defect
  affects watching, keep the work visible when the verified delivery itself is
  usable and put the uncertainty in `Needs Review`/`Workflow Note`; hide only
  the affected asset or wait for concrete playback evidence.
- **Do not re-hide during ordinary follow-up:** any writer or backfill must write
  `Hide from Website=false` by default, including source-only Media Assets rows
  that are not exposed as playable website variants. It may write `true` only
  when the manifest carries an explicit visibility hold or the same run records
  a concrete playback/structure/Media Assets risk. Creating an empty
  work/spec/episode page before upload may still start hidden; that provisional
  default must be cleared in the first bounded run that verifies a usable media
  path.
- **Release evidence outranks stale notes:** after the exact release manifest
  independently verifies one usable playable path, `--release-visibility` must
  not be blocked by an old or child-scoped playback warning in `Workflow Note`.
  Only an explicit human work-level hold can stop that release; keep the
  warning attached to the affected child path and continue the repair queue.
- **Writer-level fail-open rule:** a stale manifest, an inherited checkbox, an
  unfinished workflow status, or an omitted optional field must never be enough
  to write `Hide from Website=true`. Any automated hide request must carry a
  concrete current reason such as playback failure, broken page/media
  structure, unsafe Media Assets readback, or an explicit human hold. If that
  reason is absent or only describes metadata/review work, write the asset
  visible and keep the issue in `Workflow Note`/the relevant issue field.
- Website visibility is a playback gate, not a metadata perfection gate. Once one
  exact work/spec/episode path is playable and has passed structure, Media Assets,
  ffprobe/QC, ledger, and publication readback, release the work-level
  `Hide from Website` gate in that same publication run. Missing posters, ratings,
  People, AI advice, `Needs Review`, `Human Issue`, `AI Issue`, or optional
  specification expansion become follow-up work and must not block viewing.
- Keep the whole work hidden only when an exposed media path has a concrete
  playback or structure risk, the Media Assets/readback is unsafe, or the human
  explicitly requests a visibility hold. A metadata-only work, a work waiting
  for subtitles, and a work waiting for its first encode remain visible by
  default; hide only the affected empty or unsafe child spec/episode. A
  defective sibling specification may remain hidden without hiding the work.
  The absence of a playable path is not a work-level hide condition. It is a
  cataloging or production state; keep the work visible and hide only empty
  child specs/episodes. A work-level hide requires an exposed path that is
  unsafe or an explicit human visibility hold.
- Visibility is monotonic by default: after a work has been released, a later
  metadata, enrichment, naming, review, or optional-spec pass must not re-hide
  it. Re-hiding requires fresh evidence of a viewing-affecting defect or a new
  explicit human hold, and the reason must be written to `Workflow Note` before
  the visibility change.
- An appended human approval such as `可以发布`、`质检通过` or `允许同步`
  resolves an older AI visibility warning when that approval line contains no
  newer playback risk. A later explicit finding that playback is still broken
  takes precedence and keeps the affected path hidden.
- `Workflow Status=AI 处理中` or `待人工确认` may coexist with a visible work:
  those states describe unfinished follow-up, not a reason to remove an already
  playable title from the website. `Workflow Status=已完成` remains the stricter
  metadata-and-issue completion state.

### Fail-open blocker rule

Do not use the word `blocked` as a shortcut for `Hide from Website=true`.
Every blocker must first be classified as one of: viewing blocker, follow-up
blocker, or completion blocker. Only the first class can hide the work, and
only when it applies to the only/all exposed playable paths. A follow-up or
completion blocker must leave the title visible when a normal user can watch
it, while recording the exact missing evidence and next action. This applies
equally to old pages, newly created pages, metadata-only pages, and pages in
`AI 处理中` or `暂缓`; the status can stay blocked without blocking website
visibility.

- Chinese subtitles are a hard requirement only for subtitle-dependent versions unless the user explicitly overrides. A verified Mandarin-dubbed (`国配`) branch is Chinese-language playable and is not subtitle-dependent merely because the picture originated in another language.
- Subtitle evidence may come from internal subtitle tracks, sidecar subtitle files, or visually confirmed source hard subtitles. If a probe has no subtitle stream, do not declare the source subtitle-free from ffprobe alone: capture multiple content-bearing timestamps distributed across the runtime, at minimum early, middle, and late dialogue. If all representative screenshots clearly show complete burned-in Chinese dialogue, record the timestamped evidence as `bakedChinese=true` and allow the normal production path; if samples are inconclusive, keep the evidence unknown and defer rather than guessing.
- An unlabelled bitmap/PGS subtitle stream is not Chinese-subtitle evidence by itself. Inspect that specific stream with a real timestamped sample; if the language still cannot be identified reliably, keep playable production deferred and continue the metadata-only track.
- Filename markers such as `chs`, `cht`, `zh`, or `Chinese` are only leads, never final hard-subtitle language evidence. Prefer a dialogue-frame inspection; when the user has actually played the file, that user observation overrides a contradictory filename marker and must be recorded in the selected spec label.
- Mandarin/Chinese-language works are not subtitle-dependent by default; prefer no added hard subtitles unless the source already has unavoidable hard subtitles.
- A verified `国配` source without Chinese subtitles may proceed through production, publication, and final completion. Record missing Chinese subtitles as a non-blocking future enhancement in the production manifest and the AI completion note; do not set `暂缓`, `Needs Review`, or `Hide from Website` for that reason alone. This exception applies only to the verified Mandarin branch; a separate foreign-original-audio branch still needs usable Chinese subtitles.
- Dolby Vision Profile 5 is a normal-production blocker unless there is an explicit compatible color strategy; prefer a non-DV or HDR10-compatible source for full pipeline work.
- When a worthwhile subtitle-dependent source has no verified Chinese subtitle, create or continue a bounded `wwp-subtitle-acquirer` task. Browser-backed providers require an explicit page refresh/capture in v0.1; record `waiting_user` or `deferred` rather than silently abandoning the source. Do not bypass login, CAPTCHA, copyright removal, download confirmation, or other access controls.
- Skip sources with poor technical quality, serious color risk, unreliable subtitle timing, broken audio, or likely encode failure unless the user asks for an experiment.
- Do not encode just because a file is present.

## Priority Signals

Raise priority for:

- well-known, influential, or high-library-value films
- smooth encode path and reliable subtitles
- manageable file size and upload path
- children's films with Mandarin dubbing
- Hong Kong films with Cantonese plus Chinese subtitles
- director cuts, commentary tracks with Chinese assistance, or missing Mandarin/Cantonese specs
- verified commentary tracks that can be paired with Chinese subtitles; when the source and a QC-passed visual stream are available, prioritize this branch before optional duplicate language or bitrate variants
- existing works lacking a better 3-4GB-ish playable when the source quality supports it
- existing works that have only high-bitrate files but lack a compact 1.0-1.8GB-ish playable for easier streaming
- newly arrived input-directory entries detected by a queue watcher, after they pass the same subtitle, quality, Notion-state, and risk gates

## Original-Audio Baseline

- For a foreign-language work, the verified original-language audio branch is the normal playable baseline. A dubbed branch is supplemental and never substitutes for an omitted original-language branch.
- Apply the Chinese-subtitle hard gate to that original-language branch. When the source and Chinese-subtitle evidence pass, select or explicitly defer a compact original-audio variant before expanding dubbed variants.
- For a high-value foreign film whose source materially supports a higher-bitrate version, evaluate and normally select a higher-bitrate original-audio variant before an equivalent dubbed high-bitrate expansion. A dubbed higher-bitrate variant may still be valuable, but it must not be the only higher-bitrate branch without a recorded blocker for the original audio.
- Children's, animation, and family works may produce Mandarin early for accessibility, but the original-language branch remains part of the same source-expansion decision when usable Chinese subtitles exist.
- Record the exact blocker when original audio cannot proceed, such as missing Chinese subtitles, bad color, failed QC, unavailable source stream, or materially duplicate existing coverage. Do not silently close the source merely because a dubbed playable already exists.

## Mandarin-Dub Decision

- Default to producing a verified Mandarin-dubbed spec for children's, animation, and family works when the normal source, QC, duplicate, capacity, and upload gates pass.
- Also default to producing it when an existing library work has a valuable missing Mandarin/Cantonese spec and the current source supplies verified audio evidence.
- For ordinary foreign-language films, ask the user: `现在有国配，要不要做？` before adding a Mandarin branch.
- For Hong Kong films, cover Cantonese plus Chinese subtitles first, then ask the same question before adding Mandarin as a supplemental branch.
- Include the planned bitrate tiers and total additional file count in the question. Compact plus higher-bitrate production multiplied by Mandarin requires explicit user approval; resource availability alone is not approval for this matrix expansion.
- Do not let the optional confirmation block metadata, original-audio, Cantonese, or other deterministic work.
- Once a `国配` branch is selected, missing Chinese subtitles do not reopen the production-matrix confirmation or create a subtitle-acquisition blocker. Subtitle acquisition may remain scheduled as optional later enrichment.

## Compact Coverage Decision

For every movie that passes the playable-production gates, make and record a compact-coverage decision before selecting any encode. This is a required decision record, not a requirement to make two versions of every movie.

Choose the production profile before deciding the matrix:

- **Standard-value work**: a compact, easy-streaming playable is the normal sufficient baseline. Add a higher-bitrate version only when the source, library gap, and available capacity make it useful as a future parent/master candidate.
- **High-value work**: evaluate a compact version, a balanced everyday version, and a higher-bitrate preservation-oriented version independently. Produce the useful subset supported by the source; do not manufacture tiers from a weak source or create materially duplicate files.

This profile is an internal production decision. Spec titles and website-facing labels use only verifiable media facts: language, subtitle treatment, codec, cut, resolution, and measured size. Add a series per-episode size range only after the selected outputs have passed QC, calculated in decimal GB from their actual file sizes.

- `compact_exists`: an exact existing playable compact version is verified. Record its spec/page or Media Assets evidence.
- `compact_selected`: the current bounded production includes a compact version. Record the intended compact spec and target size.
- `compact_deferred`: no compact version will be made in this batch. Record a concrete reason, such as source quality, a user-requested high-bitrate-only result, an occupied equivalent compact spec, or a later explicitly scheduled batch.

For a movie, `film-ledger select-variant` requires `--compact-decision` and `--compact-detail` to retain this decision with the selected variant. A movie may proceed with only one version only after this decision is recorded. Series remain episode-aware: assess compact coverage using actual per-episode sizes and existing specs, but do not force a duplicate season-wide delivery.

## Release and Expansion Decisions

- Treat release readiness and source-value exhaustion as separate decisions. The first verified useful variant can release the work; it does not imply that every worthwhile source-supported spec has been produced.
- For each planned supplemental output, create an exact ledger variant with its bitrate/use tier, audio, subtitle treatment, cut, and target evidence. Use `selected` for current work or `deferred` with a concrete reason and `next_review_at` for later work.
- Never represent expansion with an unspecific placeholder or an informal promise. If no additional variant is worthwhile, record expansion closed with the reason: weak source, materially duplicate experience, low-value title sufficiently served by compact, or no supported distinct branch.
- Prioritize rare cuts/commentaries, original Cantonese for Hong Kong films, Mandarin/Taiwan dubbing for children's/family films, high bitrate for high-value films, and genuinely useful alternate subtitle treatments. Add a balanced tier only when it fills a distinct viewing need.
- Do not create a Cartesian product. Choose the smallest set of variants that preserves materially different fan or viewing value.

## Deferred Decisions

When a candidate is uncertain but not blocking the batch, record the question and continue with deterministic items. Ask the user at the end of the batch with enough evidence: source, subtitles, audio, Notion state, expected output, and risk.

## Queue Monitoring

- A queue watcher should compare the current input directory scan against a saved state file and report new, removed, and materially changed top-level entries.
- New queue entries are candidates for analysis, not automatic encodes. Run the hard gates and priority signals before starting work.
- During long encodes or uploads, use waiting time for Notion metadata, manual-upload organization, and Media Assets dry-runs instead of idling.
- Queue scans may create metadata-only work pages for valuable missing works even when no encode is started.
