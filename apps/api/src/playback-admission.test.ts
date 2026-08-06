import assert from "node:assert/strict";
import test from "node:test";
import {
  PlaybackAdmissionQueue,
  playbackLoadLevel,
  playbackRequiresLocalAdmission
} from "./playback-admission.js";

test("remote and domestic playback do not require a local-media seat", () => {
  assert.equal(playbackRequiresLocalAdmission("domestic", true), false);
  assert.equal(playbackRequiresLocalAdmission("domestic", false), false);
  assert.equal(playbackRequiresLocalAdmission("international", false), false);
  assert.equal(playbackRequiresLocalAdmission("international", true), true);
});

test("load levels map an eight-seat home server to low, medium, high, and full", () => {
  assert.equal(playbackLoadLevel(0, 8), "low");
  assert.equal(playbackLoadLevel(2, 8), "low");
  assert.equal(playbackLoadLevel(3, 8), "medium");
  assert.equal(playbackLoadLevel(5, 8), "medium");
  assert.equal(playbackLoadLevel(6, 8), "high");
  assert.equal(playbackLoadLevel(7, 8), "high");
  assert.equal(playbackLoadLevel(8, 8), "full");
});

test("the next queued viewer is admitted when a seat is released", () => {
  let currentTime = 1_000;
  let sequence = 0;
  const queue = new PlaybackAdmissionQueue(2, {
    now: () => currentTime,
    createId: () => `ticket-${++sequence}`
  });

  const first = queue.request({ sessionId: "one", assetKey: "film-1", title: "Film 1" })!;
  currentTime += 1;
  const second = queue.request({ sessionId: "two", assetKey: "film-2", title: "Film 2" })!;
  currentTime += 1;
  const third = queue.request({ sessionId: "three", assetKey: "film-3", title: "Film 3" })!;

  assert.equal(first.status, "admitted");
  assert.equal(second.status, "admitted");
  assert.equal(third.status, "queued");
  assert.equal(third.position, 1);
  assert.equal(third.capacity.level, "full");

  assert.equal(queue.release(first.ticketId!, "one"), true);
  const promoted = queue.request({
    sessionId: "three",
    assetKey: "film-3",
    title: "Film 3",
    ticketId: third.ticketId
  });
  assert.equal(promoted?.status, "admitted");
  assert.equal(promoted?.capacity.active, 2);
  assert.equal(promoted?.capacity.queued, 0);
});

test("abandoned viewers expire and do not block the queue forever", () => {
  let currentTime = 1_000;
  let sequence = 0;
  const queue = new PlaybackAdmissionQueue(1, {
    now: () => currentTime,
    createId: () => `ticket-${++sequence}`,
    admittedLeaseMs: 100,
    queuedLeaseMs: 50
  });

  queue.request({ sessionId: "one", assetKey: "film-1", title: "Film 1" });
  currentTime += 60;
  const second = queue.request({ sessionId: "two", assetKey: "film-2", title: "Film 2" })!;
  currentTime += 41;

  const promoted = queue.request({
    sessionId: "two",
    assetKey: "film-2",
    title: "Film 2",
    ticketId: second.ticketId
  });
  assert.equal(promoted?.status, "admitted");
  assert.equal(promoted?.capacity.active, 1);
});
