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

test("multi-season shows use one database work page per season", () => {
  const seriesRules = read("references/series-rules.md");
  const seriesProducer = read("skills/wwp-series-producer/SKILL.md");

  assert.match(seriesRules, /separate database season work pages/u);
  assert.match(seriesRules, /human must move each existing spec page/u);
  assert.match(seriesProducer, /one database work entry for each verified season/u);
  assert.match(seriesProducer, /parent-series page, another season page, or another work ID is a hard failure/u);
});
