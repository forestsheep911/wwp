import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAccessStore } from "./access-store.js";

test("legacy member balances, invitations, and usage are displayed in the current credit scale", async () => {
  const localDataDir = await mkdtemp(path.join(os.tmpdir(), "wwp-access-credit-scale-"));
  await mkdir(localDataDir, { recursive: true });
  await writeFile(
    path.join(localDataDir, "access-state.json"),
    `${JSON.stringify({
      codes: {
        member_legacy: {
          id: "member_legacy",
          name: "Legacy Member",
          codeHash: "unused-code-hash",
          codePreview: "ABCD",
          createdAt: "2026-07-01T00:00:00.000Z",
          expiresAt: "9999-12-31T23:59:59.999Z",
          creditBalance: 12,
          usage: [
            {
              id: "usage_legacy",
              at: "2026-07-01T01:00:00.000Z",
              credits: 2,
              reason: "playback_stream",
              assetKey: "asset-1",
              title: "Legacy Asset"
            }
          ]
        }
      },
      invitations: {
        invite_legacy: {
          id: "invite_legacy",
          type: "signup",
          codeHash: "unused-invite-hash",
          codePreview: "WXYZ",
          createdAt: "2026-07-01T00:00:00.000Z",
          creditBalance: 7
        }
      }
    }, null, 2)}\n`,
    "utf8"
  );

  const previousBackend = process.env.CACHE_BACKEND;
  const previousLocalDataDir = process.env.WWPDW_LOCAL_DATA_DIR;
  const previousDefaultCredits = process.env.MEMBER_DEFAULT_CREDITS;
  process.env.CACHE_BACKEND = "local";
  process.env.WWPDW_LOCAL_DATA_DIR = localDataDir;
  process.env.MEMBER_DEFAULT_CREDITS = "200";

  try {
    const store = createAccessStore();
    const codes = await store.listMemberCodes();
    const usage = await store.listMemberCreditUsage("member_legacy", 10);
    const invitations = await store.listMemberInvitations();

    assert.equal(codes[0]?.credits.remaining, 120);
    assert.equal(usage?.entries[0]?.credits, 20);
    assert.equal(invitations[0]?.credits?.remaining, 70);
  } finally {
    process.env.CACHE_BACKEND = previousBackend;
    process.env.WWPDW_LOCAL_DATA_DIR = previousLocalDataDir;
    process.env.MEMBER_DEFAULT_CREDITS = previousDefaultCredits;
  }
});
