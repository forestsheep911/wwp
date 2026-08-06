import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheCreditCost,
  defaultCreditPolicy,
  hasBillablePlaybackSize,
  playbackCreditCost
} from "./index.js";

test("playbackCreditCost prices domestic and international lines separately", () => {
  assert.equal(defaultCreditPolicy.domesticPlaybackCreditBytes, 200 * 1000 * 1000);
  assert.equal(defaultCreditPolicy.internationalPlaybackCreditBytes, 100 * 1000 * 1000);
  assert.equal(defaultCreditPolicy.playbackReplayFreeHours, 7 * 24);
  assert.equal(playbackCreditCost(1, defaultCreditPolicy, "domestic"), 1);
  assert.equal(playbackCreditCost(200 * 1000 * 1000, defaultCreditPolicy, "domestic"), 1);
  assert.equal(playbackCreditCost(200 * 1000 * 1000 + 1, defaultCreditPolicy, "domestic"), 2);
  assert.equal(playbackCreditCost(1_000_000_000, defaultCreditPolicy, "domestic"), 5);
  assert.equal(playbackCreditCost(1_000_000_000, defaultCreditPolicy, "international"), 10);
  assert.equal(playbackCreditCost(1_000_000_001, defaultCreditPolicy, "international"), 11);
});

test("cacheCreditCost has a two-credit floor and grows per started 2 GB", () => {
  assert.equal(defaultCreditPolicy.cacheCredits, 2);
  assert.equal(defaultCreditPolicy.cacheCreditBytes, 2 * 1000 * 1000 * 1000);
  assert.equal(cacheCreditCost(undefined, defaultCreditPolicy), 2);
  assert.equal(cacheCreditCost(1, defaultCreditPolicy), 2);
  assert.equal(cacheCreditCost(4_000_000_000, defaultCreditPolicy), 2);
  assert.equal(cacheCreditCost(4_000_000_001, defaultCreditPolicy), 3);
  assert.equal(cacheCreditCost(10_000_000_000, defaultCreditPolicy), 5);
});

test("playbackCreditCost refuses missing or invalid sizes", () => {
  assert.equal(playbackCreditCost(undefined, defaultCreditPolicy), undefined);
  assert.equal(playbackCreditCost(0, defaultCreditPolicy), undefined);
  assert.equal(playbackCreditCost(-1, defaultCreditPolicy), undefined);
  assert.equal(playbackCreditCost(Number.NaN, defaultCreditPolicy), undefined);

  assert.equal(hasBillablePlaybackSize(undefined), false);
  assert.equal(hasBillablePlaybackSize(0), false);
  assert.equal(hasBillablePlaybackSize(1), true);
});

test("playbackCreditCost is zero when billing is disabled", () => {
  const freePolicy = {
    ...defaultCreditPolicy,
    billingEnabled: false
  };
  assert.equal(playbackCreditCost(undefined, freePolicy), 0);
  assert.equal(playbackCreditCost(1_000_000_000, freePolicy), 0);
  assert.equal(cacheCreditCost(undefined, freePolicy), 0);
  assert.equal(cacheCreditCost(10_000_000_000, freePolicy), 0);
});

test("playbackCreditCost defaults to the international line", () => {
  assert.equal(playbackCreditCost(200 * 1000 * 1000, defaultCreditPolicy), 2);
});
