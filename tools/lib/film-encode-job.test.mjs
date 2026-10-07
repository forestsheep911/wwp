import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { claimEncodeJob, publishEncodedFile, runMedia } from "./film-encode-job.mjs";

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-job-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("Exclusive output ownership and distinct job directories protect concurrent encodes", t => {
  const dir = fixture(t), output = path.join(dir, "movie.mp4");
  const one = claimEncodeJob(output, dir, { source: "one" });
  assert.throws(() => claimEncodeJob(output, dir, { source: "one" }), /EEXIST/u);
  const otherDir = path.join(dir, "other"); fs.mkdirSync(otherDir);
  const two = claimEncodeJob(path.join(otherDir, "movie.mp4"), dir, { source: "two" });
  assert.notEqual(one.directory, two.directory);
  one.release(); two.release();
});

test("Retry preserves retained work and refuses changed source plans", t => {
  const dir = fixture(t), output = path.join(dir, "movie.mp4"), plan = { size: 1, mtime: 2 };
  const job = claimEncodeJob(output, dir, plan);
  fs.writeFileSync(path.join(job.directory, "video.work.mkv"), "retained");
  job.save("video_complete"); job.release();
  assert.throws(() => claimEncodeJob(output, dir, plan), /Retained job exists/u);
  assert.throws(() => claimEncodeJob(output, dir, { size: 2 }, { resume: true }), /different source/u);
  const resumed = claimEncodeJob(output, dir, plan, { resume: true });
  assert.equal(resumed.state.stage, "video_complete");
  assert.equal(fs.readFileSync(path.join(resumed.directory, "video.work.mkv"), "utf8"), "retained");
  resumed.release();
});

test("Lock recovery cannot remove a live owner's lock", t => {
  const dir = fixture(t), output = path.join(dir, "movie.mp4");
  const job = claimEncodeJob(output, dir, {});
  assert.throws(() => claimEncodeJob(output, dir, {}, { recoverLock: true }), /still running/u);
  job.release();
});

test("Publication verifies the copy before final naming and preserves source on failure", async t => {
  const dir = fixture(t), part = path.join(dir, "part.mp4"), output = path.join(dir, "final.mp4");
  fs.writeFileSync(part, "verified bytes");
  await assert.rejects(publishEncodedFile(part, output, 1), /verification failed/u);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.readFileSync(part, "utf8"), "verified bytes");
  fs.rmSync(`${output}.publishing-${process.pid}.mp4`);
  await publishEncodedFile(part, output, 14);
  assert.equal(fs.readFileSync(output, "utf8"), "verified bytes");
  assert.equal(fs.existsSync(part), false);
});

test("Child failures retain exact stderr and font errors cannot produce a successful job", async t => {
  const dir = fixture(t), job = { directory: dir };
  await assert.rejects(runMedia(process.execPath, ["-e", "process.stderr.write('specific decoder failure');process.exit(8)"], "sample", job), /specific decoder failure/u);
  await assert.rejects(runMedia(process.execPath, ["-e", "process.stderr.write('fontselect: failed to find any fallback with glyph 0x4E2D');setTimeout(()=>{},1000)"], "font", job), /missing subtitle glyph/u);
  assert.match(fs.readFileSync(path.join(dir, "ffmpeg.log"), "utf8"), /specific decoder failure/u);
});

test("Bounded timeout stops even a child that ignores SIGTERM", async t => {
  const dir = fixture(t);
  const start = Date.now();
  await assert.rejects(runMedia(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},100)"], "stalled", { directory: dir }, { timeoutMs: 150, killGraceMs: 50 }), /bounded job timeout/u);
  assert.ok(Date.now() - start < 2000);
});

test("Repeated zero progress cannot keep a stalled job alive", async t => {
  const dir = fixture(t);
  await assert.rejects(runMedia(process.execPath, ["-e", "setInterval(()=>process.stdout.write('out_time_us=0\\n'),20)"], "stalled", { directory: dir }, { noProgressTimeoutMs: 150, killGraceMs: 50 }), /no advancing media progress/u);
});
