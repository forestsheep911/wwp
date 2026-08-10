import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAiPayload, promptForPage } from "./notion-family-age-enrichment.js";

test("family age prompt excludes adult-theme and requires concrete reasons", () => {
  const prompt = promptForPage("测试影片", {});

  assert.equal(prompt.includes("成人主题, 儿童友好"), false);
  assert.match(prompt, /犯罪, 死亡\/丧亲, 儿童友好/u);
  assert.match(prompt, /不得使用“成人主题”/u);
});

test("family age normalization rejects legacy adult-theme tags and vague reasons", () => {
  const concrete = normalizeAiPayload({
    minimumAge: 12,
    confidence: "high",
    riskTags: ["成人主题", "犯罪"],
    reason: "影片持续呈现绑架和勒索等有组织犯罪。"
  });
  assert.deepEqual(concrete?.riskTags, ["犯罪"]);

  const vague = normalizeAiPayload({
    minimumAge: 12,
    confidence: "high",
    riskTags: ["成人主题"],
    reason: "影片涉及复杂成人主题。"
  });
  assert.equal(vague, undefined);
});
