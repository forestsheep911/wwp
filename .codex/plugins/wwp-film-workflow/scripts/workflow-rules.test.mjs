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

test("plugin revision records the updated subtitle gate contract", () => {
  const manifest = JSON.parse(read(".codex-plugin/plugin.json"));
  const cycle = read("references/workflow-cycle.md");

  assert.match(manifest.version, /^0\.1\.\d+$/u);
  assert.match(cycle, new RegExp(`Stable Contract \\(${manifest.version.replaceAll(".", "\\.")}\\)`, "u"));
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

  assert.match(producer, /Moving a source to a same-volume `待人工删除` directory disables routine\s+input-root discovery only/u);
  assert.match(producer, /Quarantine location is not an expansion\s+decision/u);
  assert.match(cycle, /Directory placement alone must never close or cancel a supplemental variant/u);
});

test("compact derivation verifies burned subtitle pixels before inheriting labels", () => {
  const encoding = read("references/encoding-rules.md");
  const encoder = read("skills/wwp-playable-encoder/SKILL.md");

  assert.match(encoding, /sample real dialogue frames from the parent and identify the visible Chinese script/u);
  assert.match(encoding, /correct the parent spec, parent Media Asset, ledger variant, and the planned compact variant/u);
  assert.match(encoder, /Do not inherit `简`\/`繁`\/bilingual labels from filenames, old spec titles, or ledger text/u);
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

test("large upload retries preserve accepted parts and bind the physical direct route", () => {
  const publisher = read("skills/wwp-notion-publisher/SKILL.md");

  assert.match(publisher, /retry the same resumable manifest with `--resolve-ip <api-ip> --local-address <physical-lan-ip> --no-proxy`/u);
  assert.match(publisher, /Previously accepted multipart parts must be reused/u);
  assert.match(publisher, /retain concurrency 1/u);
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
