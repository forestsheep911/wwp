import test from "node:test";
import assert from "node:assert/strict";
import {
  CHINESE_SUBTITLE_STATES,
  classifyChineseSubtitleState,
  hasVerifiedMandarinAudio
} from "./film-subtitle-state.mjs";

test("verified Chinese evidence is production-ready", () => {
  assert.equal(classifyChineseSubtitleState({
    subtitleEvidence: { internalProbeState: "completed", verifiedChinese: true }
  }), CHINESE_SUBTITLE_STATES.VERIFIED);
});

test("legacy verifiedChinese false alone remains unknown", () => {
  assert.equal(classifyChineseSubtitleState({
    subtitleEvidence: { internalProbeState: "completed", verifiedChinese: false, note: "language tag missing" }
  }), CHINESE_SUBTITLE_STATES.UNKNOWN);
});

test("explicit absence is routed to subtitle acquisition", () => {
  assert.equal(classifyChineseSubtitleState({
    subtitleEvidence: { internalProbeState: "complete", hasChineseSubtitle: false }
  }), CHINESE_SUBTITLE_STATES.CONFIRMED_MISSING);
  assert.equal(classifyChineseSubtitleState({
    qualityState: "subtitle_missing",
    subtitleEvidence: { verifiedChinese: false }
  }), CHINESE_SUBTITLE_STATES.CONFIRMED_MISSING);
  assert.equal(classifyChineseSubtitleState({
    subtitleEvidence: { has_chinese_subtitle: false }
  }), CHINESE_SUBTITLE_STATES.CONFIRMED_MISSING);
  assert.equal(classifyChineseSubtitleState({
    subtitleEvidence: { hardGate: "missing_chinese_subtitle", verifiedChinese: false }
  }), CHINESE_SUBTITLE_STATES.CONFIRMED_MISSING);
});

test("contradictory evidence returns to review", () => {
  assert.equal(classifyChineseSubtitleState({
    subtitleEvidence: { hasChineseSubtitle: false, bakedChinese: true }
  }), CHINESE_SUBTITLE_STATES.UNKNOWN);
});

test("verified Mandarin audio is a non-blocking subtitle exception", () => {
  assert.equal(hasVerifiedMandarinAudio('{"language":"Mandarin"}'), true);
  assert.equal(hasVerifiedMandarinAudio('{"language":"English"}'), false);
});
