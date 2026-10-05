import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(pluginRoot, relativePath), "utf8");
}

test("an active People pause forces film-only cycle mode", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  assert.match(producer, /When the active user instruction or goal pauses People\/person enrichment, use `--mode film-only`/u);
  assert.match(producer, /do not enqueue or run People work/u);
  assert.match(producer, /Film-only still scans enabled inputs and processes film, publication, cleanup, and bounded base-metadata lanes/u);
});

test("verified Mandarin-dubbed playback is not blocked by missing Chinese subtitles", () => {
  const decisionRules = read("references/decision-rules.md");
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  const handoff = read("references/workflow-handoff.md");

  assert.match(decisionRules, /verified `国配` source without Chinese subtitles may proceed through production, publication, and final completion/u);
  assert.match(producer, /do not set `暂缓`, `Needs Review`, or `Hide from Website` for that reason alone/u);
  assert.match(publisher, /verified `国配` branch requires no Chinese subtitle for release/u);
  assert.match(handoff, /set `已完成` and append one concise AI note/u);
});

test("subtitle-free probes require distributed hard-subtitle screenshot evidence", () => {
  const decisionRules = read("references/decision-rules.md");
  const encoding = read("references/encoding-rules.md");
  const intake = read("skills/wwp-film-intake/SKILL.md");
  assert.match(decisionRules, /multiple content-bearing timestamps distributed across the runtime/iu);
  assert.match(decisionRules, /bakedChinese=true/iu);
  assert.match(encoding, /early, middle, and late dialogue/iu);
  assert.match(intake, /timestamped `bakedChinese=true` evidence/iu);
});

test("the exception does not waive subtitles for foreign-original-audio playback", () => {
  const decisionRules = read("references/decision-rules.md");
  const encoder = read("skills/wwp-playable-encoder/SKILL.md");
  const acquirer = read("skills/wwp-subtitle-acquirer/SKILL.md");

  assert.match(decisionRules, /separate foreign-original-audio branch still needs usable Chinese subtitles/u);
  assert.match(encoder, /separate foreign-original-audio branch routed through the normal Chinese-subtitle gate/u);
  assert.match(acquirer, /foreign-\s*original-audio branch/u);
});

test("Mainland Mandarin-original films do not require Chinese subtitles", () => {
  const intake = read("skills/wwp-film-intake/SKILL.md");
  const encoder = read("skills/wwp-playable-encoder/SKILL.md");

  assert.match(intake, /Mainland Chinese-language film with verified Mandarin original audio does not require Chinese subtitles/u);
  assert.match(encoder, /Mandarin-language films and verified Mandarin-dubbed/u);
});

test("foreign films prioritize original audio before dubbed expansion", () => {
  const decisionRules = read("references/decision-rules.md");
  const selector = read("skills/wwp-film-candidate-selector/SKILL.md");
  const encoder = read("skills/wwp-playable-encoder/SKILL.md");
  const producer = read("skills/wwp-film-producer/SKILL.md");

  assert.match(decisionRules, /original-language audio branch is the normal playable baseline/u);
  assert.match(decisionRules, /higher-bitrate original-audio variant before an equivalent dubbed high-bitrate expansion/u);
  assert.match(selector, /dubbed release may improve accessibility, but it does not satisfy or close original-audio coverage/u);
  assert.match(encoder, /dubbed high tier may coexist but cannot silently replace it/u);
  assert.match(producer, /completed dubbed branch does not close source expansion/u);
});

test("touched spec titles use one explicit factual grammar", () => {
  const notionRules = read("references/notion-media-assets.md");
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");

  assert.match(notionRules, /<short work title> \[edition when needed\] <audio label> <subtitle label> <resolution> <codec> <measured decimal GB>/u);
  assert.match(notionRules, /Use `<language>原声` for an original-language track/u);
  assert.match(notionRules, /`简体烧录`, `繁体烧录`, `简英烧录`, `繁英烧录`, or `无字`/u);
  assert.match(notionRules, /rounded to two decimal places for movie display, retaining a trailing zero/u);
  assert.match(notionRules, /put the verified edition immediately after the short work title and before the audio label/u);
  assert.match(notionRules, /Do not put internal tier words such as high\/medium\/low into the title/u);
  assert.match(publisher, /short canonical Chinese work title, explicit original\/dubbed audio label/u);
  assert.match(publisher, /normalize every touched sibling spec to the same token order/u);
});

test("touched spec titles stay synchronized with Media Assets labels", () => {
  const notionRules = read("references/notion-media-assets.md");
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");

  assert.match(notionRules, /Media Assets `Name` and `Display Label` must both exactly match the canonical spec-page title/u);
  assert.match(notionRules, /website ingestion may otherwise expose `Untitled Notion page`/u);
  assert.match(notionRules, /`Name` and `Display Label` may be corrected only together/u);
  assert.match(publisher, /both fields must exactly equal the canonical spec-page title/u);
  assert.match(publisher, /require direct readback and an idempotent rerun/u);
});

test("an undersized valid output and its remaining high-tier gap are separate variants", () => {
  const encoding = read("references/encoding-rules.md");
  const producer = read("skills/wwp-film-producer/SKILL.md");

  assert.match(encoding, /QC-passed, playable output remains its own publishable actual-size variant/u);
  assert.match(encoding, /true high tier as a separate deferred variant/u);
  assert.match(encoding, /never change the valid existing output to `deferred`/u);
  assert.match(producer, /reclassify and publish it at the measured size/u);
});

test("plugin revision records the updated subtitle gate contract", () => {
  const manifest = JSON.parse(read(".codex-plugin/plugin.json"));
  const cycle = read("references/workflow-cycle.md");

  assert.match(manifest.version, /^0\.1\.\d+$/u);
  assert.match(cycle, new RegExp(`Stable Contract \\(${manifest.version.replaceAll(".", "\\.")}\\)`, "u"));
  assert.match(manifest.interface.defaultPrompt, /Visibility is a playback gate, not a perfection gate/u);
  assert.match(manifest.interface.defaultPrompt, /routine human confirmation are follow-up work, not publication blockers/u);
});

test("evidence-only people fallbacks require a formal publishable report", () => {
  const peopleWorkflow = read("skills/wwp-people-curator/references/workflow.md");
  assert.match(peopleWorkflow, /An evidence-only fallback report is not a publishable People report/u);
  assert.match(peopleWorkflow, /require `profileCount > 0`, zero identity issues, zero unresolved entries/u);
  assert.match(peopleWorkflow, /must never be counted as completed metadata or sent directly to Notion/u);
});

test("release completion requires playable and verified metadata gates", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  const maintainer = read("skills/wwp-library-maintainer/SKILL.md");
  const cycle = read("references/workflow-cycle.md");
  const handoff = read("references/workflow-handoff.md");

  assert.match(producer, /`sync_ready` is final playable completion, not release completion/u);
  assert.match(producer, /`Metadata Status=verified`/u);
  assert.match(publisher, /published-but-metadata-incomplete work `AI 处理中`/u);
  assert.match(maintainer, /A `partial` page is\s+not complete/u);
  assert.match(cycle, /Neither metadata completion nor `sync_ready` alone|`sync_ready` alone/u);
  assert.match(handoff, /Neither metadata completion nor `sync_ready` alone\s+qualifies/u);
});

test("playable visibility is independent from metadata completion", () => {
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  const cycle = read("references/workflow-cycle.md");
  const media = read("references/notion-media-assets.md");
  const metadata = read("references/metadata-sources.md");
  const handoff = read("references/workflow-handoff.md");

  assert.match(publisher, /`posterPresent` and `coreMetadataPresent` are final-completion evidence, not visibility blockers/u);
  assert.match(cycle, /Visibility release is deliberately earlier in that\s+sequence/u);
  assert.match(cycle, /Required action order in every cycle:[\s\S]*inspect already-uploaded playable\s+paths first[\s\S]*clear the work-level hide and start website\s+sync immediately[\s\S]*without making those tasks prerequisites/u);
  assert.match(cycle, /Do not stop the cycle\s+because any of those parallel lanes is blocked/u);
  assert.match(cycle, /clear the automation-owned work hide before website sync/u);
  assert.match(cycle, /missing or incomplete fields block visibility only when the website actually needs them/u);
  assert.match(publisher, /clear the automation-owned work `Hide from Website` before website sync/u);
  assert.match(media, /only a demonstrated inability to expose\/open the intended video, an observed playback failure affecting all usable paths, or an explicit visibility hold/u);
  assert.match(media, /one verified playable asset is sufficient for work-level visibility/u);
  assert.match(publisher, /release the work if at least one exact playable asset passes/u);
  assert.match(publisher, /Keep the work page visible by default, including metadata-only or not-yet-playable catalog entries/u);
  assert.match(metadata, /Keep work pages visible by default even when they have no playable verified media yet/u);
  assert.match(handoff, /For visibility release, require only that the uploaded block is mapped to the exact work\/spec\/episode and there is no concrete evidence it prevents normal viewing; do not wait for full QC, ffprobe\/Media Assets completion/u);
  assert.doesNotMatch(handoff, /exact media, structure, QC, Media Assets, and playback gates must pass first/u);
});

test("visibility-first rule keeps metadata follow-up from rehiding a playable work", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const cycle = read("references/workflow-cycle.md");
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  const decisions = read("references/decision-rules.md");

  assert.match(producer, /`Hide from Website` is not the metadata or review master switch/u);
  assert.match(producer, /A work may therefore remain `AI 处理中` or `待人工确认` while already visible/u);
  assert.match(cycle, /metadata incompleteness, a missing poster or rating, missing People\/AI\s+enrichment, `Needs Review`, an AI\/human follow-up issue, or open optional spec\s+expansion must not re-check `Hide from Website`/u);
  assert.match(cycle, /Only a verified page\/media mapping error that makes the site open the wrong\s+video or fail to open the intended video/u);
  assert.match(cycle, /a reproduced failure that prevents\s+normal playback on every available path/u);
  assert.match(cycle, /defects that do not affect watching are\s+released first and repaired later/u);
  assert.match(cycle, /If viewing impact is unknown,\s+default to visible rather than checking `Hide from Website`/u);
  assert.match(cycle, /A missing\s+playable path alone does \*\*not\*\* hide the catalog entry/u);
  assert.match(producer, /Never re-hide a technically playable work merely because metadata, poster, people, ratings/u);
  assert.match(cycle, /must not re-check `Hide from Website`/u);
  assert.match(publisher, /Mandatory visibility action.*same bounded publication run/u);
  assert.match(decisions, /Website visibility is a playback gate, not a metadata perfection gate/u);
  assert.match(decisions, /first ask whether a normal user can play at least\s+one exact published spec\/episode/u);
  assert.match(cycle, /If the answer is yes, publish it unless the playback\s+path itself is unsafe/u);
  assert.match(decisions, /Missing posters, ratings,\s+People, AI advice, `Needs Review`, `Human Issue`, `AI Issue`/u);
  assert.match(decisions, /A metadata-only work, a work waiting\s+for subtitles, and a work waiting for its first encode remain visible/u);
  assert.match(decisions, /Visibility is monotonic by default/u);
  assert.match(decisions, /Default to visible after usable publication/u);
  assert.match(cycle, /visible-after-usable-publication/u);
  assert.match(cycle, /once the uploaded media block is verified on the exact intended\s+spec\/episode page/u);
  assert.match(cycle, /Do not make ffprobe completion,\s+Media Assets completeness, `sync_ready`, or live-site readback prerequisites\s+for clearing the hide/u);
  assert.match(producer, /Use the visible-after-usable-publication default/u);
});

test("visibility is an independent lane and workflow blockers cannot hide watchable titles", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const cycle = read("references/workflow-cycle.md");
  const producerText = producer.replace(/\s+/gu, " ");
  const cycleText = cycle.replace(/\s+/gu, " ");
  assert.match(producerText, /Visibility Is Not a Workflow Blocker/u);
  assert.match(producerText, /must not be used to express that production, QC, metadata, Media Assets, review, or human confirmation is unfinished/u);
  assert.match(producerText, /only for an explicit current human hold or current evidence that \*\*every\*\* available playable path prevents normal viewing/u);
  assert.match(cycleText, /independently classify \*\*playback visibility\*\*, \*\*production\/follow-up\*\*, and \*\*final completion\*\*/u);
  assert.match(cycleText, /Unknown impact defaults to visible/u);
  assert.match(cycleText, /Never treat `AI 处理中`, `待人工确认`, `暂缓`, or the word “blocked” as a visibility decision/u);
});

test("metadata-only catalog entries remain visible while playable work is pending", () => {
  const media = read("references/notion-media-assets.md");
  const decisions = read("references/decision-rules.md");
  assert.match(media, /metadata-only or waiting-for-production work remains visible by default/u);
  assert.match(media, /does not hide the work-level catalog entry/u);
  assert.match(decisions, /metadata-only\s+entries are valid catalog entries/u);
});

test("user visibility decision favors release before repair", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const handoff = read("references/workflow-handoff.md");
  const decisions = read("references/decision-rules.md");
  assert.match(decisions, /Highest-priority visibility rule[\s\S]*先让用户看得到，再继续修/u);
  assert.match(decisions, /看不出缺陷是否影响观看时，[\s\S]*按“不影响观看”处理/u);
  assert.match(decisions, /即使暂时还没有播放资源也保持可见/u);
  assert.match(producer, /只要作品还有一条不影响正常观看的已发布路径，就尽量先放出/u);
  assert.match(producer, /以后补修不需要先下架/u);
  assert.match(producer, /只有全部现有播放路径都实际影响观看，或用户明确要求整条暂不发布，才隐藏整个作品/u);
  assert.match(producer, /用户最终可见性决策（高于一般流程阻拦）/u);
  assert.match(producer, /它们不代表网站必须隐藏/u);
  assert.match(producer, /缺陷容忍默认值.*不影响观看，就应尽量先发布、以后补缺/su);
  assert.match(producer, /不得把需要人工确认当成默认发布审批/u);
  assert.match(decisions, /用户的缺陷容忍决策优先执行/u);
  assert.match(producer, /At the start and end\s+of every production\/publication pass/u);
  assert.match(producer, /defer or isolate that exact encode.*not a work-level visibility decision/su);
  assert.match(handoff, /每轮读取到作品级隐藏状态时，都要结合当前可用路径重新判定/u);
  assert.match(decisions, /must clear any stale automation-owned\s+work-level hide before moving on to metadata/u);
});

test("workflow blockers are not website blockers unless playback is affected", () => {
  const cycle = read("references/workflow-cycle.md");
  const decisions = read("references/decision-rules.md");
  const producer = read("skills/wwp-film-producer/SKILL.md");
  assert.match(cycle, /Default to publishing a watchable title; do not wait for routine user approval/u);
  assert.match(cycle, /A defect that can be repaired after release is not a reason to delay release/u);
  assert.match(cycle, /must never turn a non-playback blocker into a website blocker/u);
  assert.match(cycle, /Only a concrete, current failure of the exposed playback\/structure\/Media Assets path/u);
  assert.match(decisions, /Do not use the word `blocked` as a shortcut for `Hide from Website=true`/u);
  assert.match(decisions, /A follow-up or\s+completion blocker must leave the title visible/u);
  assert.match(decisions, /可见性裁决优先于一般流程阻拦/u);
  assert.match(decisions, /前三类只暂停对应事项并继续其他可执行工作/u);
  assert.match(decisions, /Blocker scope is not visibility scope/u);
  assert.match(decisions, /只要普通用户仍能正常观看，就先公开；任何可后补的缺陷都留在后续任务/u);
  assert.match(producer, /只要作品还有一条不影响正常观看的已发布路径，就尽量先放出/u);
});

test("an unexplained hide flag is actively cleared unless current evidence supports it", () => {
  const decisions = read("references/decision-rules.md");
  assert.match(decisions, /每次读取到 `Hide from Website=true`，不得直接继承并把它当成\s+“有人决定暂缓”/u);
  assert.match(decisions, /若两者都没有，就清除该勾选并继续网站同步\/其他待办/u);
  assert.match(decisions, /隐藏原因不明、旧问题已修好、只有流程或资料阻塞，都不构成保留隐藏的理由/u);
  assert.match(decisions, /设置或保留隐藏时，\s*必须在同一轮记录具体故障、影响到的路径及复核\/恢复条件/u);
});

test("watchable titles are released despite repairable imperfections", () => {
  const cycle = read("references/workflow-cycle.md");
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const decisions = read("references/decision-rules.md");
  const handoff = read("references/workflow-handoff.md");
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  assert.match(decisions, /用户可见性总优先级（覆盖其他流程 gate）/u);
  assert.match(decisions, /只要仍有至少一条路径可以正常观看，就应尽量公开该路径并保持作品可见/u);
  assert.match(decisions, /其他阻塞，只能暂停各自事项，不能\s+连带阻止可观看内容上线/u);
  assert.match(decisions, /缺陷不影响观看，或影响尚未得到证实时，默认先放出/u);
  assert.match(producer, /If a normal user can watch the published title, release it even when it is not perfect/u);
  assert.match(decisions, /if a normal user can watch the published title,\s+release it even when it is not perfect/u);
  assert.match(decisions, /small repairable quality issue belongs in the\s+follow-up record, not in the\s+work-level visibility gate/u);
  assert.match(decisions, /最高优先级：先发布可观看版本，缺陷留在后续修/u);
  assert.match(decisions, /缺陷容忍按“能否观看”判断，不按“是否达到理想成片”判断/u);
  assert.match(handoff, /发布优先于完美和流程收尾/u);
  assert.match(handoff, /无需等待完整质检、ffprobe、Media Assets 字段补录、账本 `sync_ready` 或网站读回/u);
  assert.match(handoff, /映射错误导致打不开视频/u);
  assert.match(handoff, /`已完成` 仍可等待严格收尾条件，但它不是发布前置状态/u);
  assert.match(handoff, /Do not wait for ffprobe\/Media Assets completion, ledger `sync_ready`, or website readback/u);
  assert.match(handoff, /`待人工确认`: use only when a decision genuinely requires human judgment[\s\S]*never a routine website-publication approval state/u);
  assert.match(handoff, /A watchable work may remain in this status while visible/u);
  assert.match(publisher, /do not make them a blanket work-level release gate/u);
  assert.match(publisher, /Do not wait for every episode\/spec, every optional QC task, or final `sync_ready`\/`已完成` bookkeeping/u);
  assert.match(publisher, /Keep only an empty, mismapped, or concretely unsafe child hidden/u);
  assert.match(decisions, /最高优先级的可见性快判（先判断是否能看，不等流程全部做完）/u);
  assert.match(decisions, /证据不确定时\s+默认公开，不得把“保守起见”当作隐藏依据/u);
  assert.match(decisions, /每次操作 `Hide from Website=true` 前，必须\s+记录故障证据及影响范围或明确的人类暂缓指令/u);
  assert.match(producer, /总裁决：先发布可观看条目，后续修缺陷/u);
  assert.match(producer, /发布后继续修复与流程收尾，不要求先达到 `已完成`/u);
  assert.match(cycle, /总裁决：可观看就先放出，不因可修复缺陷或流程未收尾而阻拦/u);
  assert.match(cycle, /`Workflow Status` 未到 `已完成`，均不得成为工作级隐藏或发布阻塞理由/u);
  assert.match(cycle, /defects that do not affect watching are\s+released first and repaired later/u);
  assert.match(cycle, /If viewing impact is unknown,\s+default to visible rather than checking `Hide from Website`/u);
  assert.match(cycle, /a reproduced failure that prevents\s+normal playback on every available path/u);
});

test("watchability does not mean ideal quality and uncertain defects fail open", () => {
  const decisions = read("references/decision-rules.md");
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const handoff = read("references/workflow-handoff.md");

  assert.match(decisions, /视频能打开，主要画面、声音和内容可辨识，即按可观看处理并尽量公开/u);
  assert.match(decisions, /轻微瑕疵、尚未复核、兼容性疑虑/u);
  assert.match(producer, /“watchable” means the video opens and its main picture, sound,/u);
  assert.match(handoff, /不要把“正常观看”抬高成“理想成片”/u);
  assert.match(handoff, /只有复现到实际妨碍观看的故障才隐藏对应子路径/u);
});

test("metadata identity conflicts do not become work-level visibility blocks by themselves", () => {
  const metadata = read("skills/wwp-metadata-backfiller/SKILL.md");
  const handoff = read("references/workflow-handoff.md");
  const decisions = read("references/decision-rules.md");

  assert.match(metadata, /must not newly set `Hide from Website=true` unless the conflict also proves that an exposed media path is mapped to the wrong work/u);
  assert.match(handoff, /metadata and issue checks are named `workCompletionBlockers`; they are never website-visibility blockers/u);
  assert.match(handoff, /Missing Media Assets data\s+or failed readback alone is follow-up work/u);
  assert.match(decisions, /The second and third rows are not reasons to set `Hide from Website=true`/u);
});

test("series catalog pages stay visible unless every exposed path is unsafe", () => {
  const series = read("skills/wwp-series-producer/SKILL.md");
  const handoff = read("references/workflow-handoff.md");
  assert.match(series, /The work page is a visible catalog entry by default/u);
  assert.match(series, /hide only the exact empty or concretely unwatchable child path/u);
  assert.match(series, /Metadata\/review follow-up alone must never keep a playable series hidden/u);
  assert.match(handoff, /先放后修（默认动作）/u);
});

test("minimal visibility blockers keep non-playback defects from hiding a usable title", () => {
  const decisions = read("references/decision-rules.md");
  const cycle = read("references/workflow-cycle.md");
  const handoff = read("references/workflow-handoff.md");
  const scripts = read("references/script-map.md");
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  const media = read("references/notion-media-assets.md");

  assert.match(decisions, /Minimal Visibility Blockers/u);
  assert.match(decisions, /only for a concrete reason that can stop or materially corrupt normal viewing/u);
  assert.match(decisions, /release the work-level page and isolate unfinished siblings/u);
  assert.match(cycle, /Minimal-blocker publication rule/u);
  assert.match(cycle, /standing authorization to release watchable entries; do not ask the user for routine approval/u);
  assert.match(cycle, /A blocker in encoding, metadata, review, or final completion pauses only that task/u);
  assert.match(cycle, /keep the catalog entry visible, publish the verified usable path when present, and record a follow-up/u);
  assert.match(handoff, /release the work-level page and isolate unfinished siblings/u);
  assert.match(handoff, /`暂缓` is a production-recovery state, not a website-hide command/u);
  assert.match(scripts, /visible catalog entry with `Needs Review=true`/u);
  assert.match(handoff, /先放后修（默认动作）.*不会影响正常观看时，本轮必须优先清除/u);
  assert.match(handoff, /无法证明会影响观看，按“可观看”处理/u);
  assert.match(decisions, /Production rejection is not a visibility decision/u);
  assert.match(decisions, /If any\s+answer is missing, keep the work visible/u);
  assert.match(decisions, /Production selection only:.*skip a new encode/su);
  assert.match(decisions, /observed, reproducible failure before hiding/u);
  assert.match(handoff, /实际故障证据门槛.*本轮确认并记录/u);
  assert.match(handoff, /缺失或不完整的 ffprobe\/Media Assets 字段作为并行补录任务/u);
  assert.match(producer, /Missing\/incomplete ffprobe or Media Assets fields are parallel backfill work, not a visibility blocker/u);
  assert.match(publisher, /missing\/incomplete ffprobe or Media Assets fields are parallel backfill work, not a visibility blocker/iu);
  assert.match(cycle, /Once one exact media path has a correctly mapped destination page and an uploaded video block, with no concrete playback failure, clear the automation-owned work hide before website sync/u);
  assert.match(cycle, /Capture ffprobe\/Media Assets metadata in parallel; missing or incomplete fields block visibility only when the website actually needs them/u);
  assert.match(publisher, /exact destination-page video block and filename match, with no concrete playback fault, are sufficient to release the path/u);
  assert.match(publisher, /missing\/incomplete ffprobe fields are not a visibility prerequisite unless the website actually needs them/u);
  assert.match(publisher, /`Needs Review=true` does not block visibility.*keep the review flag and publish that path/u);
  assert.doesNotMatch(cycle, /matching ffprobe-backed Media Assets row, clear the automation-owned work hide/u);
});

test("work-level hiding requires evidence covering every playable path", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  assert.match(producer, /Scope proof is mandatory for a work-level hide/u);
  assert.match(producer, /Unless the note explicitly\s+identifies that path as the only playable one or confirms all currently usable\s+paths fail, do not hide the work/u);
});

test("technical playback incidents isolate the affected variant instead of hiding a usable work", () => {
  const encoding = read("references/encoding-rules.md");
  assert.match(encoding, /defer that source\/encode and keep any separate watchable published path visible/u);
  assert.match(encoding, /Isolate or replace that exact variant; do not hide the parent work if another published path remains usable/u);
  assert.match(encoding, /mark only the exact affected variant as replacement-pending/u);
  assert.match(encoding, /never hide the entire matching encode family or parent work while another published path remains usable/u);
});

test("Media Assets backfill does not use hidden as a conservative default", () => {
  const media = read("skills/wwp-media-assets-backfiller/SKILL.md");
  assert.match(media, /A newly created row is visible by default/u);
  assert.match(media, /do not use `Hide from Website=true` as a conservative placeholder/u);
  assert.match(media, /prevents normal users from opening or watching that exact asset, or the user explicitly asks for a hold/u);
  assert.match(media, /Missing Media Assets fields, ffprobe details, or a readback failure are bookkeeping follow-up/u);
  assert.match(media, /separate final metadata gate/u);
});

test("normal uploaded media does not require human playback before visibility release", () => {
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  const media = read("references/notion-media-assets.md");
  assert.match(publisher, /do not hold a usable title for routine manual playback checks/u);
  assert.match(publisher, /exact destination-page video block and filename match, with no concrete playback fault, are sufficient to release the path/u);
  assert.match(publisher, /missing\/incomplete ffprobe fields are not a visibility prerequisite unless the website actually needs them/u);
  assert.match(media, /Do not require a human to play every asset/u);
  assert.match(media, /hide the work only if no other usable path remains/u);
  assert.match(media, /Missing or incomplete ffprobe fields, a failed index refresh, or a non-playback\s+metadata mismatch is follow-up work/u);
  assert.match(media, /only a demonstrated inability to expose\/open the intended video/u);
  const releaseTool = read("../../../tools/notion-media-assets-release.mjs");
  assert.doesNotMatch(releaseTool, /actual\.playbackVerified !== true\) failures\.push/u);
  assert.match(releaseTool, /Playback Verified needs follow-up/u);
});

test("release-first coverage is separate from source expansion", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const selector = read("skills/wwp-film-candidate-selector/SKILL.md");
  const encoder = read("skills/wwp-playable-encoder/SKILL.md");
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  const cycle = read("references/workflow-cycle.md");
  const archive = read("references/source-archive-rules.md");

  assert.match(producer, /prioritize one releaseable playable for each eligible newly arrived work/u);
  assert.match(selector, /Do not build a Cartesian product/u);
  assert.match(encoder, /Default to a compact first release/u);
  assert.match(encoder, /upload the high tier while deriving compact/iu);
  assert.match(publisher, /Mandatory visibility action|without waiting for optional supplemental variants/u);
  assert.match(cycle, /production queue is also the durable expansion query/u);
  assert.match(archive, /`Workflow Status=已完成` means the current release is live/u);
});

test("expansion marker uses concrete ledger variants instead of a new Notion property", () => {
  const selector = read("skills/wwp-film-candidate-selector/SKILL.md");
  const handoff = read("references/workflow-handoff.md");
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");

  assert.match(selector, /Create concrete ledger variants/u);
  assert.match(selector, /`\[规格扩展:OPEN\]`/u);
  assert.match(selector, /human-visible marker, not a new Notion property/u);
  assert.match(handoff, /supplemental work does not keep a verified first release hidden/u);
  assert.match(publisher, /exact selected\/deferred ledger variants remain the queryable machine queue/u);
});

test("quarantined sources retain explicit expansion value", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const cycle = read("references/workflow-cycle.md");
  const scripts = read("references/script-map.md");

  assert.match(producer, /Moving a source to a same-volume `待人工删除` directory disables routine\s+input-root discovery only/u);
  assert.match(producer, /Quarantine location is not an expansion\s+decision/u);
  assert.match(cycle, /Directory placement alone must never close or cancel a supplemental variant/u);
  assert.match(cycle, /partial specification with no such rows is production work/u);
  assert.match(cycle, /Ignore explicit smoke\/sample files and special\/OVA\/SP specifications/u);
  assert.match(cycle, /unknown children are skipped and never create a new source or intake task/u);
  assert.match(scripts, /`待人工删除` is an audit\/quarantine root, never a discovery root/u);
});

test("source cleanup follows the latest append-only expansion marker", () => {
  const archive = read("references/source-archive-rules.md");
  assert.match(archive, /only the last `\[规格扩展:OPEN\]` or `\[规格扩展:CLOSED\]` marker represents the current expansion decision/u);
  assert.match(archive, /older OPEN must not permanently block/u);
});

test("goal idle reporting accounts for every source left in an input root", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const archive = read("skills/wwp-source-archive-operator/SKILL.md");
  const workflowCycle = read("references/workflow-cycle.md");
  assert.match(producer, /auditing every\s+still-present source under every enabled input root/u);
  assert.match(producer, /Never collapse these states into “没有新的可进行项”/u);
  assert.match(archive, /source_quarantine_failed/u);
  assert.match(workflowCycle, /complete disposition audit for every still-present/u);
});

test("archive-only sources have an explicit non-production disposition", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const cycle = read("references/workflow-cycle.md");
  const scripts = read("references/script-map.md");
  assert.match(cycle, /`archive_bundle`/u);
  assert.match(cycle, /Archive-only directories with no recognized media file/u);
  assert.match(scripts, /Archive-only folders.*`archiveCount`/u);
  assert.match(producer, /archive_bundle/u);
});

test("completed outputs can return from staging before quarantine", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const cycle = read("references/workflow-cycle.md");

  assert.match(producer, /relocate that output back to\s+the default root before quarantine/u);
  assert.match(producer, /Verify the copied byte count,\s*remove the\s+old copy only after verification/u);
  assert.match(cycle, /update the exact ledger path plus a relocation event atomically/u);
});

test("compact derivation verifies burned subtitle pixels before inheriting labels", () => {
  const encoding = read("references/encoding-rules.md");
  const encoder = read("skills/wwp-playable-encoder/SKILL.md");

  assert.match(encoding, /sample real dialogue frames from the parent and identify the visible Chinese script/u);
  assert.match(encoding, /correct the parent spec, parent Media Asset, ledger variant, and the planned compact variant/u);
  assert.match(encoder, /Do not inherit `简`\/`繁`\/bilingual labels from filenames, old spec titles, or ledger text/u);
});

test("encode plans distinguish global stream indexes from relative audio and subtitle ordinals", () => {
  const encoding = read("references/encoding-rules.md");
  const series = read("skills/wwp-series-producer/SKILL.md");

  assert.match(encoding, /`--subtitle-stream` accepts the subtitle ordinal, not the global stream index/u);
  assert.match(encoding, /`--audio-stream` is relative to audio streams \(`a:0`, `a:1`, \.\.\.\), not the global ffprobe stream index/u);
  assert.match(series, /create and retain a per-source subtitle map showing global ffprobe stream indexes versus subtitle ordinals/u);
});

test("color checks distinguish mixed-color films from monochrome sources", () => {
  const encoding = read("references/encoding-rules.md");

  assert.match(encoding, /at least three points distributed across the runtime \(early, middle, and late\)/u);
  assert.match(encoding, /`color`, `monochrome`, `mixed`, or `unknown`/u);
  assert.match(encoding, /A black-and-white opening, flashback, dream sequence, or isolated shot is not evidence that the whole source is monochrome/u);
});

test("legacy media labels are leads and uncovered valuable streams block cleanup", () => {
  const encoding = read("references/encoding-rules.md");

  assert.match(encoding, /historical filename, spec title, Media Assets label, and ledger label as a lead rather than stream truth/u);
  assert.match(encoding, /actual source-to-output stream mapping/u);
  assert.match(encoding, /unidentified but potentially valuable audio track remains an explicit deferred variant and blocks source cleanup/u);
});

test("audio-only variants reuse an exact visual parent and remain below the upload cap", () => {
  const encoding = read("references/encoding-rules.md");
  const encoder = read("skills/wwp-playable-encoder/SKILL.md");

  assert.match(encoding, /same cut, complete duration, framing, resolution, color\/tone-map result, and burned-subtitle pixels/u);
  assert.match(encoding, /never use `-shortest`/u);
  assert.match(encoding, /project the replacement audio bytes from duration and target bitrate before mux/u);
  assert.match(encoder, /direct decoding of a source track such as TrueHD makes the full video pipeline slow/u);
  assert.match(encoder, /verify that the copied video duration and packet hash match the parent/u);
});

test("large uploads stop before paid proxy fallback and bind fixed-IP retries to the physical direct route", () => {
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  const sourceOperator = read("skills/wwp-source-archive-operator/SKILL.md");
  const sourceRules = read("references/source-archive-rules.md");
  const cycle = read("references/workflow-cycle.md");
  const scriptMap = read("references/script-map.md");
  const routeProbe = read("../../../tools/notion-upload-route-probe.mjs");
  const routeWrapper = read("../../../tools/with-notion-upload-route.mjs");
  const trafficMonitor = read("../../../tools/lib/vpn-traffic-monitor.mjs");
  const uploadEntrypoints = [
    read("../../../tools/notion-upload-movie-video.mjs"),
    read("../../../tools/notion-upload-series-videos.mjs"),
    read("../../../tools/notion-upload-movie-package.mjs")
  ];

  assert.match(publisher, /A non-`DIRECT` route is a hard stop unless the exact controlled Freedom s801 exception/u);
  assert.match(publisher, /Never pass `--resolve-ip` by itself/u);
  assert.match(publisher, /retry the same resumable manifest with `--resolve-ip <api-ip> --local-address <physical-lan-ip> --no-proxy`/u);
  assert.match(publisher, /Previously accepted multipart parts must be reused/u);
  assert.match(publisher, /resume the same `file_upload_id` from the last accepted `part_number`/u);
  assert.match(publisher, /bounded number of fresh DIRECT connections[\s\S]*before considering s801/u);
  assert.match(publisher, /retain concurrency 1/u);
  assert.match(routeProbe, /HttpsProxyAgent/u);
  assert.match(routeProbe, /production uploader/u);
  assert.match(routeProbe, /local Clash proxy[\s\S]*api\.notion\.com as DIRECT/u);
  for (const entrypoint of uploadEntrypoints) {
    assert.match(entrypoint, /--resolve-ip requires --local-address <physical-lan-ip> and --no-proxy/u);
    assert.match(entrypoint, /createVpnTrafficMonitor/u);
  }
  assert.match(routeProbe, /createVpnTrafficMonitor/u);
  assert.match(publisher, /Traffic-counter growth is corroborating evidence, not a route verdict/u);
  assert.match(publisher, /sustained growth projects exhaustion before the provider reset/u);
  assert.match(publisher, /Notion -> JMS London 节点 -> JMS London s801 - Reality/u);
  assert.match(publisher, /--expected-route jms-s801/u);
  assert.match(routeProbe, /requireNotionUploadRoute/u);
  assert.match(routeProbe, /--expected-route <direct\|jms-s801>/u);
  assert.match(publisher, /Never assume a multiplier of 10/u);
  assert.match(publisher, /proactively when a large transfer is unavoidable/u);
  assert.match(publisher, /never infer upload accounting solely from that download example/u);
  assert.match(publisher, /multiplier as unknown rather than infinite/u);
  assert.match(cycle, /unavoidable large traffic makes protection of the normal allowance/u);
  assert.match(scriptMap, /existing `Notion` and `JMS London 节点` nested selectors plus their selectable s801 member are sufficient/u);
  assert.match(publisher, /selectable s801 member inside the existing node group is sufficient/u);
  assert.match(cycle, /do not require or create a permanent dedicated routing rule or group/u);
  assert.match(publisher, /Do not require or create a dedicated permanent s801 route/u);
  assert.match(publisher, /stop when it is missing or ambiguous instead of guessing/u);
  assert.match(publisher, /Restore and read back both saved selector values in a `finally`-style cleanup/u);
  assert.match(publisher, /with-notion-upload-route\.mjs --route jms-s801 --reason <estimated-batch-size-or-direct-failure> --apply/u);
  assert.match(publisher, /The s801 wrapper requires `--reason <text>`/u);
  assert.match(publisher, /read the relevant selectors back before every file part/u);
  for (const entrypoint of uploadEntrypoints) {
    assert.match(entrypoint, /createNotionUploadSelectorGuard/u);
    assert.match(entrypoint, /routeGuard\.assert/u);
  }
  assert.match(routeWrapper, /withTemporaryNotionRoute/u);
  assert.match(routeWrapper, /NOTION_UPLOAD_EXPECTED_ROUTE/u);
  assert.match(cycle, /restore plus read back both saved choices on success, failure, or interruption/u);
  assert.match(publisher, /courtesy Freedom server[\s\S]*taken offline at any time/u);
  assert.match(sourceOperator, /only non-DIRECT exception is a deliberately wrapped, probed, and traffic-monitored JMS Freedom `s801` batch/u);
  assert.match(sourceOperator, /without a dedicated routing rule/u);
  assert.match(sourceRules, /JMS Freedom `s801` is the sole controlled non-DIRECT exception/u);
  assert.match(sourceRules, /do not require a dedicated permanent s801 route/u);
  assert.match(publisher, /POSTER_CACHE_REQUEST_TIMEOUT_MS=30000/u);
  assert.match(cycle, /single slow poster host must not hold unrelated completed media outside the website index/u);
  assert.match(cycle, /recycle only that uploader's connection[\s\S]*fresh DIRECT connections first/u);
  assert.doesNotMatch(trafficMonitor, /state[^]*endpoint\.url/u);
});

test("new series intake persists probe evidence and prepares size-neutral destinations before encoding", () => {
  const cycle = read("references/workflow-cycle.md");
  const series = read("skills/wwp-series-producer/SKILL.md");

  assert.match(cycle, /persist the representative probe path plus quality, subtitle, audio, color, and episode-coverage evidence/u);
  assert.match(cycle, /create the \*\*visible catalog work page\*\* and its complete destination tree immediately/u);
  assert.match(cycle, /provisional prepared spec title may omit its size/u);
  assert.match(cycle, /inherited proxy `ECONNRESET`\/TLS failure is transport evidence, not a page-permission verdict/u);
  assert.match(cycle, /does not waive the separate upload route proof/u);
  assert.match(series, /prepared title may omit size until outputs exist/u);
  assert.match(series, /calculate the measured decimal-GB range from every selected episode/u);
  assert.match(cycle, /Register the exact work\/spec\/episode target first, then use `adopt-existing-variant`/u);
  assert.match(series, /do not call `record-qc` directly from `selected`/u);
});

test("production people catalog reads only the current indexed snapshot generation", () => {
  const workflow = read("skills/wwp-people-curator/references/workflow.md");
  const azureStore = read("../../../packages/cache-store/src/person-catalog-azure.ts");

  assert.match(workflow, /indexed `PartitionKey` plus\s+`RowKey` prefix range/u);
  assert.match(workflow, /Never filter the history\s+by the non-key `generationId` property/u);
  assert.match(workflow, /never issue one request per chunk/u);
  assert.match(azureStore, /RowKey ge/u);
  assert.match(azureStore, /RowKey lt/u);
  assert.doesNotMatch(azureStore, /generationId eq/u);
});

test("structured Media Assets are not truncated by the legacy variant cap", () => {
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");
  const scriptMap = read("references/script-map.md");
  const notionSource = read("../../../apps/api/src/notion-source.ts");

  assert.match(publisher, /Relation-bounded structured Media Assets must bypass the legacy `NOTION_VARIANT_LIMIT` block-scan cap/u);
  assert.match(scriptMap, /bypass the legacy `NOTION_VARIANT_LIMIT` block-scan cap/u);
  assert.match(notionSource, /completeStructuredMediaAssetVariants/u);
  assert.doesNotMatch(notionSource, /completeStructuredMediaAssetVariants\([^)]*\)\s*\.slice/u);
});

test("safe ledger title reconciliation is bounded and exact", () => {
  const scriptMap = read("references/script-map.md");
  assert.match(scriptMap, /film-ledger-reconcile-index-titles\.mjs/u);
  assert.match(scriptMap, /exact page-ID match/u);
  assert.match(scriptMap, /precisely the ledger title plus its recorded terminal `\(year\)` suffix/u);
  assert.match(scriptMap, /terminal `updated`\/`skipped` record with a non-empty subject ID/u);
  assert.match(scriptMap, /all remaining renames, year conflicts, and missing identities fail closed/u);
});

test("unproduced useful audio branches keep a source out of cleanup", () => {
  const archive = read("skills/wwp-source-archive-operator/SKILL.md");

  assert.match(archive, /Completing original-audio high\/compact variants does not exhaust a source/u);
  assert.match(archive, /Mandarin, Taiwan Mandarin, Cantonese, or commentary branch/u);
  assert.match(archive, /Keep the source and record the remaining branch/u);
});

test("metadata task completion requires exact core and poster evidence", () => {
  const metadata = read("skills/wwp-metadata-backfiller/SKILL.md");
  const sources = read("references/metadata-sources.md");
  const scripts = read("references/script-map.md");

  assert.match(metadata, /Complete the ledger `metadata_backfill` task only after that exact readback/u);
  assert.match(metadata, /Determine `movie` versus `series` before the first Notion metadata write/u);
  assert.match(metadata, /notion-create-work-page\.mjs --work-id <id>/u);
  assert.match(metadata, /every later `notion-metadata-backfill\.mjs` pass must include `--preserve-existing-identity`/u);
  assert.match(metadata, /structured `IMDb ID` property with the legacy linked `imdb` property/u);
  assert.match(metadata, /do not let `--preserve-existing-identity` bypass the inconsistency/u);
  assert.match(sources, /internal identity defect[\s\S]*notion-work-identity-correction\.mjs/u);
  assert.match(metadata, /must not replace a verified Chinese-plus-original title with an English title/u);
  assert.match(metadata, /`missingCoreFields`/u);
  assert.match(metadata, /maintained `Poster URL` is usable and later website readback succeeds/u);
  assert.match(sources, /Complete the ledger\s+metadata task only for `Metadata Status=verified`/u);
  assert.match(scripts, /A `partial` result must stay\s+pending or be deferred/u);
});

test("multi-season shows use one database work page per season", () => {
  const seriesRules = read("references/series-rules.md");
  const seriesProducer = read("skills/wwp-series-producer/SKILL.md");
  const intake = read("skills/wwp-film-intake/SKILL.md");
  const cycle = read("references/workflow-cycle.md");

  assert.match(seriesRules, /separate database season work pages/u);
  assert.match(seriesRules, /human must move each existing spec page/u);
  assert.match(seriesProducer, /one database work entry for each verified season/u);
  assert.match(seriesProducer, /season-specific Douban subject or IMDb ID/u);
  assert.match(seriesProducer, /parent-series IMDb ID may be stored as provisional evidence/u);
  assert.match(seriesProducer, /parent-series page, another season page, or another work ID is a hard failure/u);
  assert.match(intake, /split manifest is a required intake artifact/u);
  assert.match(cycle, /Parent-series IMDb\/Douban hints must not be treated as season verification/u);
});

test("long-running continuous animation does not infer Notion seasons from source folders", () => {
  const seriesRules = read("references/series-rules.md");
  const seriesProducer = read("skills/wwp-series-producer/SKILL.md");
  assert.match(seriesRules, /Long-running animation exception/u);
  assert.match(seriesRules, /global episode number/u);
  assert.match(seriesProducer, /distribution-folder season labels do not create Notion seasons/u);
});

test("automatic goal continuations suppress duplicate no-change reports", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const cycle = read("references/workflow-cycle.md");

  assert.match(producer, /automatic goal continuation as a scheduling opportunity/u);
  assert.match(producer, /do not immediately run another full cycle or send another user-visible "no change" message/u);
  assert.match(cycle, /automatic goal continuation is not itself a workflow-state change/u);
  assert.match(cycle, /suppress a\s+duplicate user-visible status report/u);
  assert.match(cycle, /reported once with its exact next\s+trigger or review time/u);
});

test("item blockers cannot be promoted to a globally blocked Goal", () => {
  const producer = read("skills/wwp-film-producer/SKILL.md");
  const cycle = read("references/workflow-cycle.md");

  assert.match(producer, /continuation\.goalDisposition/u);
  assert.match(producer, /canMarkGoalBlocked=false/u);
  assert.match(producer, /workflow-wide blocker/u);
  assert.match(cycle, /goalDisposition/u);
  assert.match(cycle, /isolated work-item failures/u);
});

test("people sub-batches publish clean profiles without closing residual work", () => {
  const people = read("skills/wwp-people-curator/SKILL.md");
  const workflow = read("skills/wwp-people-curator/references/workflow.md");
  const cycle = read("references/workflow-cycle.md");

  assert.match(people, /publish the clean profiles as an explicit sub-batch/u);
  assert.match(people, /return the work-level People stage to `pending`/u);
  assert.match(people, /Use `completed` only after the work-level/u);
  assert.match(people, /settle-people-coverage/u);
  assert.match(workflow, /exact\s+remaining names\/credits and next trigger/u);
  assert.match(workflow, /not a\s+reason to mark the complete production Goal blocked/u);
  assert.match(workflow, /settle-people-coverage/u);
  assert.match(workflow, /non-empty `fully_linked` canonical/u);
  assert.match(workflow, /exact linked\/total\/residual counts/u);
  assert.match(people, /authoritative `works` collection/u);
  assert.match(people, /`candidates` intentionally omits `fully_linked` works/u);
  assert.match(workflow, /Prefer an unlinked matching source row/u);
  assert.match(workflow, /canonical person, department, compatible job, and character/u);
  assert.match(workflow, /Never collapse a person's distinct departments/u);
  assert.match(cycle, /incomplete-only `candidates` collection may be empty/u);
  assert.match(people, /transient provider failures/u);
  assert.match(workflow, /converted to `deferred`/u);
  assert.match(people, /catalog-apply-run\.json/u);
  assert.match(people, /no-progress error/u);
  assert.match(people, /completed\/readback_verified/u);
});

test("people targeted supplements allow reviewed stable IDs without forcing Wikidata", () => {
  const people = read("skills/wwp-people-curator/SKILL.md");
  const workflow = read("skills/wwp-people-curator/references/workflow.md");
  const scripts = read("references/script-map.md");

  assert.match(people, /reviewed IMDb or TMDB identity/u);
  assert.match(workflow, /HTTPS `workCreditUrl` proving\s+the credit on that work/u);
  assert.match(workflow, /must not infer biography, dates, images, alternate names, jobs, or\s+characters from a name match/u);
  assert.match(scripts, /person-targeted-supplement\.mjs/u);
  assert.match(scripts, /tool rejects name-only rows/u);
  assert.match(people, /--reviewed-output/u);
  assert.match(workflow, /When `identityIssues` and `unresolved` are both empty/u);
  assert.match(workflow, /never promoted automatically/u);
});

test("historical people coverage feeds the campaign instead of disappearing", () => {
  const enricher = read("skills/wwp-work-enricher/SKILL.md");
  const cycle = read("references/workflow-cycle.md");

  assert.match(enricher, /historical People coverage audit is also an intake source/u);
  assert.match(enricher, /historical_people_coverage/u);
  assert.match(enricher, /absent from the campaign must never be silently omitted/u);
  assert.match(cycle, /saved authoritative People coverage audit is an intake source/u);
  assert.match(cycle, /must never synthesize a work ID from a title alone/u);
});

test("HDR color QC requires matched source-reference and final frames", () => {
  const encoding = read("references/encoding-rules.md");
  const producer = read("skills/wwp-film-producer/SKILL.md");

  assert.match(encoding, /at least four distributed, content-bearing timestamps as matched pairs/u);
  assert.match(encoding, /single output-only contact sheet cannot close this gate/u);
  assert.match(producer, /matched source-reference\/final frames at distributed timestamps/u);
});
