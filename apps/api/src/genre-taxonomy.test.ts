import assert from "node:assert/strict";
import test from "node:test";

import { mapExternalGenres } from "./genre-taxonomy.js";

test("mapExternalGenres maps common Chinese film genres", () => {
  const mapped = mapExternalGenres(["剧情", "爱情", "武侠", "古装"]);

  assert.deepEqual(mapped.canonical, ["剧情", "浪漫", "武侠", "古装"]);
  assert.deepEqual(mapped.unmapped, []);
});
