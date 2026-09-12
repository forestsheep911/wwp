import assert from "node:assert/strict";
import { test } from "node:test";
import { startVisiblePoll } from "../src/cinema/visible-poll";

class Visibility extends EventTarget {
  hidden = false;
  change(hidden: boolean) {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

test("hidden pages do not poll; a completed task stays stopped after visibility changes", async () => {
  const visibility = new Visibility();
  visibility.hidden = true;
  let calls = 0;
  const stop = startVisiblePoll(async () => { calls++; return false; }, 5, visibility);
  assert.equal(calls, 0);
  visibility.change(false);
  await Promise.resolve();
  assert.equal(calls, 1);
  visibility.change(true);
  visibility.change(false);
  assert.equal(calls, 1);
  stop();
});

test("visibility changes cannot overlap a slow request and cleanup invalidates it", async () => {
  const visibility = new Visibility();
  let calls = 0;
  let finish!: () => void;
  let active!: () => boolean;
  const stop = startVisiblePoll(async (isActive) => {
    calls++;
    active = isActive;
    await new Promise<void>((resolve) => { finish = resolve; });
  }, 5, visibility);
  visibility.change(true);
  visibility.change(false);
  assert.equal(calls, 1);
  stop();
  assert.equal(active(), false);
  finish();
  await Promise.resolve();
  visibility.change(false);
  assert.equal(calls, 1);
});

test("failures back off and success restores the normal interval", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const visibility = new Visibility();
  let calls = 0;
  const stop = startVisiblePoll(async () => { if (++calls === 1) throw new Error("offline"); }, 100, visibility);
  await Promise.resolve();
  t.mock.timers.tick(100);
  assert.equal(calls, 1);
  t.mock.timers.tick(100);
  assert.equal(calls, 2);
  await Promise.resolve();
  t.mock.timers.tick(100);
  assert.equal(calls, 3);
  stop();
});
