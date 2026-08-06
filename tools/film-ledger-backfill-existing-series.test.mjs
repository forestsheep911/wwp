import assert from "node:assert/strict";
import test from "node:test";

import { episodeSpecMap } from "./film-ledger-backfill-existing-series.mjs";

test("episodeSpecMap finds episode pages beneath a legacy toggle-wrapped spec", async () => {
  const children = new Map([
    ["work", [
      { id: "toggle", type: "toggle", has_children: true },
      { id: "note", type: "callout", has_children: false }
    ]],
    ["toggle", [{ id: "spec", type: "child_page", child_page: { title: "Example spec" } }]],
    ["spec", [
      { id: "episode-01", type: "child_page", child_page: { title: "Episode 01" } },
      { id: "metadata", type: "child_page", child_page: { title: "Notes" } }
    ]]
  ]);
  const notion = {
    blocks: {
      children: {
        async list({ block_id }) {
          return { results: children.get(block_id) ?? [], has_more: false };
        }
      }
    }
  };

  const mapping = await episodeSpecMap(notion, "work");
  assert.deepEqual([...mapping.entries()], [["episode-01", "spec"]]);
});
