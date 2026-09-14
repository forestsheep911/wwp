import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath) {
  return fs.readFileSync(path.join(pluginRoot, relativePath), "utf8");
}

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
  assert.match(publisher, /without waiting for optional supplemental variants/u);
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
  assert.match(cycle, /create the hidden work page and its complete destination tree immediately/u);
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

  assert.match(seriesRules, /separate database season work pages/u);
  assert.match(seriesRules, /human must move each existing spec page/u);
  assert.match(seriesProducer, /one database work entry for each verified season/u);
  assert.match(seriesProducer, /parent-series page, another season page, or another work ID is a hard failure/u);
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
});

test("HDR color QC requires matched source-reference and final frames", () => {
  const encoding = read("references/encoding-rules.md");
  const producer = read("skills/wwp-film-producer/SKILL.md");

  assert.match(encoding, /at least four distributed, content-bearing timestamps as matched pairs/u);
  assert.match(encoding, /single output-only contact sheet cannot close this gate/u);
  assert.match(producer, /matched source-reference\/final frames at distributed timestamps/u);
});
