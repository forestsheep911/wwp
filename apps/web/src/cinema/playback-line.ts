import type { PlaybackLine } from "@wwpdw/shared";

export const playbackLineStorageKey = "wwpdw-playback-line";

export function readPlaybackLine(): PlaybackLine {
  const stored = localStorage.getItem(playbackLineStorageKey);
  return stored === "international" ? "international" : "domestic";
}

export function writePlaybackLine(line: PlaybackLine) {
  localStorage.setItem(playbackLineStorageKey, line);
}

export function playbackLineLabel(line: PlaybackLine) {
  return line === "domestic" ? "国内" : "国际";
}
