import assert from "node:assert/strict";
import test from "node:test";
import { correctionActions } from "./notion-series-display-label-correction.mjs";

function page(id, episodeNumber, label) {
  return { id, properties: { "Display Label": { rich_text: [{ plain_text: label }] }, "Episode Number": { number: episodeNumber } } };
}

test("display-label correction changes only exact prefix matches with unique episodes", () => {
  const actions = correctionActions([
    page("asset-1", 1, "Old Spec 0.5GB / Episode 01"),
    page("asset-2", 2, "Old Spec 0.5GB / Episode 02"),
    page("other", 1, "Different Spec / Episode 01")
  ], { fromPrefix: "Old Spec 0.5GB", toPrefix: "Old Spec 0.5GB/集", expectedCount: 2 });
  assert.deepEqual(actions.map((action) => action.after), ["Old Spec 0.5GB/集 / Episode 01", "Old Spec 0.5GB/集 / Episode 02"]);
});

test("display-label correction fails closed on missing expected episodes", () => {
  assert.throws(() => correctionActions([page("asset-1", 1, "Old Spec / Episode 01")], {
    fromPrefix: "Old Spec", toPrefix: "New Spec", expectedCount: 2
  }), /Expected 2 exact Display Label matches/);
});
