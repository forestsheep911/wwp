export const CHINESE_SUBTITLE_STATES = Object.freeze({
  VERIFIED: "verified",
  CONFIRMED_MISSING: "confirmed_missing",
  UNKNOWN: "unknown"
});

function parseEvidence(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function evidenceEntries(value, entries = []) {
  if (Array.isArray(value)) {
    for (const item of value) evidenceEntries(item, entries);
    return entries;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      entries.push([key.toLowerCase().replace(/[^a-z0-9]/gu, ""), item]);
      evidenceEntries(item, entries);
    }
  }
  return entries;
}

function trueValue(entries, names) {
  return entries.some(([key, value]) => names.has(key) && value === true);
}

function falseValue(entries, names) {
  return entries.some(([key, value]) => names.has(key) && value === false);
}

export function classifyChineseSubtitleState({ subtitleEvidence, qualityState } = {}) {
  const parsed = parseEvidence(subtitleEvidence);
  const entries = evidenceEntries(parsed);
  const raw = typeof subtitleEvidence === "string"
    ? subtitleEvidence.toLowerCase()
    : JSON.stringify(subtitleEvidence ?? "").toLowerCase();

  const positiveKeys = new Set([
    "verifiedchinese",
    "verifiedchinesesubtitle",
    "haschinesesubtitle",
    "bakedchinese",
    "bakedchinesesubtitle",
    "burnedchinese"
  ]);
  const explicitNegativeKeys = new Set([
    "nochinesesubtitles",
    "nochinesesubtitle",
    "haschinesesubtitle",
    "verifiedchinesesubtitle"
  ]);
  const positive = trueValue(entries, positiveKeys);
  const explicitNegative = String(qualityState ?? "").toLowerCase() === "subtitle_missing"
    || trueValue(entries, new Set(["nochinesesubtitles", "nochinesesubtitle"]))
    || falseValue(entries, explicitNegativeKeys)
    || raw.includes("no_chinese_subtitles")
    || raw.includes("chinese subtitles absent")
    || raw.includes("confirmed_absent")
    || raw.includes("confirmed_missing")
    || raw.includes("missing_chinese_subtitle");

  // Contradictory legacy evidence must be rechecked instead of being sent to
  // either encoding or subtitle acquisition on a guess.
  if (positive && explicitNegative) return CHINESE_SUBTITLE_STATES.UNKNOWN;
  if (positive) return CHINESE_SUBTITLE_STATES.VERIFIED;
  if (explicitNegative) return CHINESE_SUBTITLE_STATES.CONFIRMED_MISSING;

  // Legacy rows often used verifiedChinese=false for both "not checked yet"
  // and "checked and absent". That boolean alone is therefore intentionally
  // non-terminal; an explicit absence marker is required above.
  return CHINESE_SUBTITLE_STATES.UNKNOWN;
}

export function hasVerifiedMandarinAudio(audioEvidence) {
  return /(?:mandarin|cmn|国语|普通话)/iu.test(String(audioEvidence ?? ""));
}

export function hasVerifiedJapaneseOriginalAudio(audioEvidence) {
  const parsed = parseEvidence(audioEvidence);
  const entries = evidenceEntries(parsed);
  const verifiedOriginal = trueValue(entries, new Set([
    "verifiedoriginal",
    "verifiedoriginalaudio",
    "verifiedoriginallanguage"
  ]));
  const originalLanguage = entries.some(([key, value]) =>
    ["originalaudio", "originallanguage"].includes(key)
      && /(?:japanese|jpn|日语|日本语)/iu.test(String(value ?? ""))
  );
  const japaneseTrack = entries.some(([key, value]) =>
    ["language", "languages", "audio", "audiotracks", "tracks"].includes(key)
      && /(?:japanese|jpn|日语|日本语)/iu.test(JSON.stringify(value ?? ""))
  );
  return originalLanguage || (verifiedOriginal && japaneseTrack);
}

export function hasSubtitleExemptAudio(audioEvidence) {
  return hasVerifiedMandarinAudio(audioEvidence) || hasVerifiedJapaneseOriginalAudio(audioEvidence);
}
