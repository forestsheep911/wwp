import type { PlaybackLine, PlaybackLinePreference } from "@wwpdw/shared";

export const playbackLineStorageKey = "wwpdw-playback-line";

const mainlandTimeZones = new Set([
  "Asia/Chongqing",
  "Asia/Harbin",
  "Asia/Shanghai",
  "Asia/Urumqi"
]);

export function suggestedPlaybackLine(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): PlaybackLine {
  return mainlandTimeZones.has(timeZone) ? "domestic" : "international";
}

export function readPlaybackLinePreference(): PlaybackLinePreference {
  const stored = localStorage.getItem(playbackLineStorageKey);
  return stored === "domestic" || stored === "international" ? stored : "auto";
}

export function writePlaybackLinePreference(preference: PlaybackLinePreference) {
  localStorage.setItem(playbackLineStorageKey, preference);
}

export function resolvePlaybackLine(
  preference: PlaybackLinePreference,
  suggestion = suggestedPlaybackLine()
): PlaybackLine {
  return preference === "auto" ? suggestion : preference;
}

export function playbackLineLabel(line: PlaybackLine) {
  return line === "domestic" ? "国内 OSS" : "国际 Azure";
}
