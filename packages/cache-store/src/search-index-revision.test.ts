import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalSearchIndexStore } from "./search-index.js";

test("local search index revision changes after an external writer updates the index", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wwpdw-search-index-"));
  const statePath = path.join(directory, "search-index.json");
  const writer = new LocalSearchIndexStore(statePath);
  const reader = new LocalSearchIndexStore(statePath);

  try {
    assert.equal(await reader.getRevision(), undefined);

    await writer.upsertResult({
      assetKey: "work-1",
      title: "Work 1",
      source: "test",
      updatedAt: "2026-07-28T00:00:00.000Z"
    });
    const firstRevision = await reader.getRevision();
    assert.ok(firstRevision);

    await writer.upsertResult({
      assetKey: "work-2",
      title: "Work 2",
      source: "test",
      updatedAt: "2026-07-28T00:01:00.000Z"
    });
    const secondRevision = await reader.getRevision();

    assert.ok(secondRevision);
    assert.notEqual(secondRevision, firstRevision);
    assert.equal((await reader.search("", 10)).length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
