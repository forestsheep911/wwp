import assert from "node:assert/strict";
import test from "node:test";
import { calculateCompositeRating } from "../src/cinema/composite-rating";

test("calculates the weighted composite rating from all sources", () => {
  assert.deepEqual(calculateCompositeRating([
    { source: "douban", value: "8.0" },
    { source: "imdb", value: "7.0/10" },
    { source: "metacritic", value: "75" },
    { source: "rotten", value: "80%" }
  ]), {
    score: 76,
    sourceCount: 4
  });
});

test("renormalizes the weights when rating sources are missing", () => {
  assert.deepEqual(calculateCompositeRating([
    { source: "douban", value: "8.5" },
    { source: "imdb", value: "7.5" }
  ]), {
    score: 80,
    sourceCount: 2
  });
});

test("supports a single percentage-based source", () => {
  assert.deepEqual(calculateCompositeRating([
    { source: "metacritic", value: "62/100" }
  ]), {
    score: 62,
    sourceCount: 1
  });
});

test("ignores invalid and unavailable ratings", () => {
  assert.equal(calculateCompositeRating([
    { source: "douban", value: "N/A" },
    { source: "imdb", value: "0" }
  ]), undefined);
});
