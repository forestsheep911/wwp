import assert from "node:assert/strict";
import test from "node:test";

import { buildSubtitleExtractArgs, distinctEventTimes, parseArgs, visiblePgsEvents, isUniformSubtitleImage } from "./render-pgs-samples.mjs";

test("blank rendered subtitle images cannot count as visible subtitle samples", () => {
  assert.equal(isUniformSubtitleImage('lavfi.signalstats.YMIN=16\nlavfi.signalstats.YMAX=16'), true);
  assert.equal(isUniformSubtitleImage('lavfi.signalstats.YMIN=16\nlavfi.signalstats.YMAX=235'), false);
  assert.throws(() => isUniformSubtitleImage(''), /Missing/);
});

function pcs(time, objects) {
  const segment = Buffer.alloc(24);
  segment.write("PG"); segment.writeUInt32BE(Math.round(time * 90000), 2);
  segment[10] = 0x16; segment.writeUInt16BE(11, 11); segment[23] = objects;
  return segment;
}

test("visible PGS samples exclude clear events and retain short display intervals", () => {
  const bytes = Buffer.concat([pcs(600, 1), pcs(600.2, 0), pcs(610, 1), pcs(612, 0)]);
  assert.deepEqual(visiblePgsEvents(bytes, 3), [{ time: 600, end: 600.2 }, { time: 610, end: 612 }]);
});

test("truncated SUP segments cannot become samples", () => {
  assert.throws(() => visiblePgsEvents(pcs(10, 1).subarray(0, 20), 3), /Truncated/);
});

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

test("subtitle extraction preserves source timestamps when seeking", () => {
  const args = buildSubtitleExtractArgs({ start: 1200, subtitleStream: 4, events: 3 }, "source.m2ts", "sample.sup");

  assert.deepEqual(args.slice(3, 6), ["-copyts", "-ss", "1200"]);
  assert.equal(args.includes("0:s:4"), true);
});
