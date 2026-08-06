import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/api.ts", import.meta.url), "utf8");

test("playback admission carries the selected playback line", () => {
  assert.match(appSource, /requestPlaybackAdmission\(assetKey, undefined, line\)/);
  assert.match(apiSource, /if \(line\) params\.set\("line", line\)/);
});

test("an admission failure exits the non-dismissible player-opening screen", () => {
  const executeOpenPlayer = appSource.match(
    /async function executeOpenPlayer\([\s\S]*?\n  async function enterAdmittedPlayback/,
  )?.[0];

  assert.ok(executeOpenPlayer);
  assert.match(
    executeOpenPlayer,
    /catch \(playbackError\) \{\s*setPlaybackOpening\(false\);\s*handleRequestError/,
  );
});

test("domestic playback does not require a service worker before opening", () => {
  const executeOpenPlayer = appSource.match(
    /async function executeOpenPlayer\([\s\S]*?\n  async function enterAdmittedPlayback/,
  )?.[0];

  assert.ok(executeOpenPlayer);
  assert.doesNotMatch(executeOpenPlayer, /ensureOssPlaybackServiceWorker/);
});
