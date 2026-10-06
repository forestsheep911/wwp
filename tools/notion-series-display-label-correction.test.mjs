import assert from "node:assert/strict";
import fs from "node:fs";
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

test("display-label correction keeps the shared limiter when binding a local interface", () => {
  const source = fs.readFileSync(new URL("./notion-series-display-label-correction.mjs", import.meta.url), "utf8");
  assert.match(source, /fetch: createPacedFetch\(nodeFetch, \{ minIntervalMs: 1000 \}\)/u);
  assert.match(source, /clientOptions\.agent = new https\.Agent\(\{ keepAlive: true, localAddress: options\.localAddress \}\)/u);
  assert.doesNotMatch(source, /clientOptions\.fetch = nodeFetch/u);
});
