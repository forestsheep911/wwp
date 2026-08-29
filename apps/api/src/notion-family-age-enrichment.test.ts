import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAiPayload, promptForPage, restrictPagesToAiPlan } from "./notion-family-age-enrichment.js";

test("family age prompt excludes adult-theme and requires concrete reasons", () => {
  const prompt = promptForPage("测试影片", {});

  assert.equal(prompt.includes("成人主题, 儿童友好"), false);
  assert.match(prompt, /犯罪, 死亡\/丧亲, 儿童友好/u);
  assert.match(prompt, /不得使用“成人主题”/u);
});

test("family age prompt carries release timing and exact-page content evidence", () => {
  const prompt = promptForPage("测试影片", {
    "上映日期": { type: "date", date: { start: "2026-06-12" } },
    "分级": { type: "select", select: { name: "PG-13" } }
  }, "MPA: action/violence, some bloody images and strong language.");

  assert.match(prompt, /currentDate/u);
  assert.match(prompt, /releaseDate/u);
  assert.match(prompt, /2026-06-12/u);
  assert.match(prompt, /PG-13/u);
  assert.match(prompt, /some bloody images/u);
  assert.match(prompt, /不得声称作品尚未上映/u);
  assert.match(prompt, /不得复制英文证据短语/u);
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

test("family age normalization accepts snake_case model JSON", () => {
  const payload = normalizeAiPayload({
    minimum_age: 6,
    confidence: "medium",
    risk_tags: ["儿童友好"],
    recommendation_reason: "动画歌会和夸张喜剧冲突，未见需要更高年龄的明确内容。",
    needs_review: false
  });

  assert.deepEqual(payload, {
    minimumAge: 6,
    confidence: "medium",
    riskTags: ["儿童友好"],
    reason: "动画歌会和夸张喜剧冲突，未见需要更高年龄的明确内容。",
    needsReview: false
  });
});

test("family age normalization keeps concrete reasons that explicitly negate a vague adult phrase", () => {
  const payload = normalizeAiPayload({
    minimumAge: 8,
    confidence: "medium",
    riskTags: ["儿童友好"],
    reason: "作品为搞笑格斗动画，无真实暴力后果或成人向性暗示。",
    needsReview: false
  });

  assert.equal(payload?.minimumAge, 8);
});

test("family age normalization keeps concrete risks even when the model adds a broad adult phrase", () => {
  const payload = normalizeAiPayload({
    minimumAge: 16,
    confidence: "high",
    riskTags: ["性/裸露", "脏话", "自杀自伤", "死亡/丧亲"],
    reason: "明确呈现成人内容中的裸露镜头、强烈脏话、自杀未遂和主要角色丧亲。",
    needsReview: false
  });

  assert.equal(payload?.minimumAge, 16);
});

test("family age plan apply cannot expand beyond previewed page ids", () => {
  const payload = {
    minimumAge: 12,
    confidence: "high" as const,
    riskTags: ["死亡/丧亲"],
    reason: "影片明确呈现死亡与丧亲情节。",
    needsReview: false
  };
  const pages = [{ id: "page-a" }, { id: "page-b" }];
  const plan = new Map([["page-a", payload]]);

  assert.deepEqual(restrictPagesToAiPlan(pages, plan, "reviewed-plan.json"), [{ id: "page-a" }]);
  assert.deepEqual(restrictPagesToAiPlan(pages, plan), pages);
});
