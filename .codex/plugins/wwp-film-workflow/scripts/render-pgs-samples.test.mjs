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
