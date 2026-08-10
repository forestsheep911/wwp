import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { openLedger } from "../../../../tools/lib/film-ledger-schema.mjs";

const scriptPath = path.resolve(".codex/plugins/wwp-film-workflow/scripts/watch-input-directory.mjs");

function runWatch(root, state, output, maxSamples) {
  const result = spawnSync(process.execPath, [
    scriptPath,
    "--root",
    root,
    "--state",
    state,
    "--output",
    output,
    ...(maxSamples ? ["--max-samples", String(maxSamples)] : []),
    "--once"
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(readFileSync(output, "utf8"));
}

function runWatchPositional(root, state, output) {
  const result = spawnSync(process.execPath, [scriptPath, root, state, output], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(readFileSync(output, "utf8"));
}

test("watch-input-directory creates baseline then reports added entries", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-watch-"));
  try {
    mkdirSync(path.join(root, "Movie.One.2025"), { recursive: true });
    writeFileSync(path.join(root, "Movie.One.2025", "Movie.One.2025.mkv"), Buffer.alloc(1024));

    const state = path.join(root, "state.json");
    const output = path.join(root, "watch.json");
    const first = runWatch(root, state, output);
    assert.equal(first.baseline, true);
    assert.equal(first.summary.added, 0);

    mkdirSync(path.join(root, "Movie.Two.2026"), { recursive: true });
    writeFileSync(path.join(root, "Movie.Two.2026", "Movie.Two.2026.mkv"), Buffer.alloc(2048));

    const second = runWatch(root, state, output);
    assert.equal(second.baseline, false);
    assert.equal(second.summary.added, 1);
    assert.equal(second.added[0].name, "Movie.Two.2026");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("watch-input-directory does not treat a report sample limit change as source content change", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-watch-samples-"));
  try {
    mkdirSync(path.join(root, "Movie.One.2025"), { recursive: true });
    for (const [name, bytes] of [["a.mkv", 1024], ["b.mkv", 2048], ["c.mkv", 3072]]) {
      writeFileSync(path.join(root, "Movie.One.2025", name), Buffer.alloc(bytes));
    }

    const state = path.join(root, "state.json");
    const output = path.join(root, "watch.json");
    runWatch(root, state, output, 1);
    const next = runWatch(root, state, output, 3);
    assert.equal(next.summary.changed, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("watch-input-directory detects a new non-largest file even when its mtime is preserved", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-watch-content-fingerprint-"));
  try {
    const movie = path.join(root, "Movie.One.2025");
    mkdirSync(movie, { recursive: true });
    writeFileSync(path.join(movie, "feature.mkv"), Buffer.alloc(4096));

    const state = path.join(root, "state.json");
    const output = path.join(root, "watch.json");
    runWatch(root, state, output);

    const subtitle = path.join(movie, "subtitle.ass");
    writeFileSync(subtitle, "subtitle");
    const original = new Date("2020-01-01T00:00:00Z");
    utimesSync(subtitle, original, original);

    const next = runWatch(root, state, output);
    assert.equal(next.summary.changed, 1);
    assert.equal(next.changed[0].after.subtitleCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("watch-input-directory accepts positional root state output arguments", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-watch-positional-"));
  try {
    mkdirSync(path.join(root, "Movie.One.2025"), { recursive: true });
    writeFileSync(path.join(root, "Movie.One.2025", "Movie.One.2025.mkv"), Buffer.alloc(1024));

    const state = path.join(root, "state.json");
    const output = path.join(root, "watch.json");
    const first = runWatchPositional(root, state, output);
    assert.equal(first.baseline, true);
    assert.equal(first.statePath, state);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("watch-input-directory imports each scan into the film ledger", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-watch-ledger-"));
  try {
    mkdirSync(path.join(root, "Movie.One.2025"), { recursive: true });
    writeFileSync(path.join(root, "Movie.One.2025", "Movie.One.2025.mkv"), Buffer.alloc(1024));

    const ledger = path.join(root, "film-ledger.sqlite");
    const result = spawnSync(process.execPath, [
      scriptPath,
      "--root",
      root,
      "--ledger",
      ledger,
      "--once"
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.deepEqual(payload.ledger, { inserted: 1, unchanged: 0, changed: 0, missing: 0 });

    const db = openLedger(ledger);
    try {
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM input_roots").get().count, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sources").get().count, 1);
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("watch-input-directory does not update JSON state when ledger import fails", () => {
  const root = mkdtempSync(path.join(tmpdir(), "wwp-watch-ledger-failure-"));
  try {
    mkdirSync(path.join(root, "Movie.One.2025"), { recursive: true });
    writeFileSync(path.join(root, "Movie.One.2025", "Movie.One.2025.mkv"), Buffer.alloc(1024));
    const state = path.join(root, "state.json");
    const ledger = path.join(root, "film-ledger.sqlite");
    const movedLedger = path.join(root, "film-ledger-moved.sqlite");
    const previousState = '{"sentinel":true}\n';
    writeFileSync(state, previousState, "utf8");

    const result = spawnSync(process.execPath, [
      scriptPath,
      "--root",
      root,
      "--state",
      state,
      "--ledger",
      ledger,
      "--once"
    ], {
      encoding: "utf8",
      env: { ...process.env, WWP_TEST_FAIL_LEDGER_IMPORT: "1" }
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /test ledger import failure/);
    assert.equal(readFileSync(state, "utf8"), previousState);
    renameSync(ledger, movedLedger);
    renameSync(movedLedger, ledger);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
