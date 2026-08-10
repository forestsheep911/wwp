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
