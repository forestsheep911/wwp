import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAccessStore } from "./access-store.js";

test("playback replay is free only on the same line", async () => {
  const localDataDir = await mkdtemp(path.join(os.tmpdir(), "wwp-access-playback-line-"));
  await writeFile(
    path.join(localDataDir, "access-state.json"),
    `${JSON.stringify({
      codes: {
        member_line_test: {
          id: "member_line_test",
          name: "Line Test",
          codeHash: "unused-code-hash",
          codePreview: "LINE",
          createdAt: "2026-07-30T00:00:00.000Z",
          expiresAt: "9999-12-31T23:59:59.999Z",
          creditScaleVersion: 2,
          creditBalance: 100,
          usage: []
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );

  const previousBackend = process.env.CACHE_BACKEND;
  const previousLocalDataDir = process.env.WWPDW_LOCAL_DATA_DIR;
  process.env.CACHE_BACKEND = "local";
  process.env.WWPDW_LOCAL_DATA_DIR = localDataDir;

  try {
    const store = createAccessStore();
    const domestic = await store.chargeMemberPlayback("member_line_test", {
      credits: 5,
      assetKey: "asset-1",
      title: "Asset 1",
      line: "domestic",
      windowHours: 168
    });
    const domesticReplay = await store.chargeMemberPlayback("member_line_test", {
      credits: 5,
      assetKey: "asset-1",
      title: "Asset 1",
      line: "domestic",
      windowHours: 168
    });
    const international = await store.chargeMemberPlayback("member_line_test", {
      credits: 10,
      assetKey: "asset-1",
      title: "Asset 1",
      line: "international",
      windowHours: 168
    });
    const usage = await store.listMemberCreditUsage("member_line_test", 10);

    assert.equal(domestic?.ok && domestic.charged, true);
    assert.equal(domesticReplay?.ok && domesticReplay.charged, false);
    assert.equal(international?.ok && international.charged, true);
    assert.equal(usage?.code.credits.remaining, 85);
    assert.deepEqual(usage?.entries.map((entry) => entry.line), ["international", "domestic"]);
  } finally {
    process.env.CACHE_BACKEND = previousBackend;
    process.env.WWPDW_LOCAL_DATA_DIR = previousLocalDataDir;
  }
});
