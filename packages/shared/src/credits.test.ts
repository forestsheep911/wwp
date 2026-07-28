import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultCreditPolicy,
  hasBillablePlaybackSize,
  playbackCreditCost
} from "./index.js";

test("playbackCreditCost charges one credit per started 100 MB", () => {
  assert.equal(defaultCreditPolicy.cacheCredits, 10);
  assert.equal(defaultCreditPolicy.playbackCreditBytes, 100 * 1000 * 1000);
  assert.equal(playbackCreditCost(1, defaultCreditPolicy), 1);
  assert.equal(playbackCreditCost(20 * 1000 * 1000, defaultCreditPolicy), 1);
  assert.equal(playbackCreditCost(200 * 1000 * 1000, defaultCreditPolicy), 2);
  assert.equal(playbackCreditCost(1_000_000_000, defaultCreditPolicy), 10);
  assert.equal(playbackCreditCost(1_000_000_001, defaultCreditPolicy), 11);
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
});

test("playbackCreditCost keeps legacy policy responses chargeable", () => {
  assert.equal(playbackCreditCost(200 * 1000 * 1000, {
    playbackCreditBytes: defaultCreditPolicy.playbackCreditBytes
  }), 2);
});
