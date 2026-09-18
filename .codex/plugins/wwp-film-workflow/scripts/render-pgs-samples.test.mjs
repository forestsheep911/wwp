import assert from "node:assert/strict";
import test from "node:test";

import { distinctEventTimes, parseArgs } from "./render-pgs-samples.mjs";

test("parseArgs accepts a bounded positive subtitle sample start", () => {
  const options = parseArgs([
    "--input", "movie.mkv",
    "--subtitle-stream", "2",
    "--output-dir", "samples",
    "--events", "5",
    "--start", "600.5"
  ]);

  assert.equal(options.subtitleStream, 2);
  assert.equal(options.events, 5);
  assert.equal(options.start, 600.5);
  assert.equal(options.timeoutMs, 180000);
});

test("parseArgs accepts a positive subtitle sample timeout", () => {
  const options = parseArgs([
    "--input", "movie.mkv",
    "--subtitle-stream", "2",
    "--output-dir", "samples",
    "--timeout-ms", "30000"
  ]);

  assert.equal(options.timeoutMs, 30000);
});

test("parseArgs rejects a non-positive subtitle sample timeout", () => {
  assert.throws(() => parseArgs([
    "--input", "movie.mkv",
    "--subtitle-stream", "0",
    "--output-dir", "samples",
    "--timeout-ms", "0"
  ]), /--timeout-ms must be a positive integer/);
});

test("parseArgs rejects a negative subtitle sample start", () => {
  assert.throws(() => parseArgs([
    "--input", "movie.mkv",
    "--subtitle-stream", "0",
    "--output-dir", "samples",
    "--start", "-1"
  ]), /--start must be a non-negative number/);
});

test("distinctEventTimes keeps separated events only", () => {
  assert.deepEqual(distinctEventTimes(["0", "0.1", "1.5", "2.0"], 3), [0, 1.5, 2]);
});
