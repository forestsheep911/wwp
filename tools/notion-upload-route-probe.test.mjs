import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { clashAuthorizationHeaders, filterTransferConnections, parseArgs } from "./notion-upload-route-probe.mjs";

test("route probe uses the configured Clash controller token without a placeholder", () => {
  assert.deepEqual(clashAuthorizationHeaders(" controller-secret "), {
    Authorization: "Bearer controller-secret"
  });
  assert.deepEqual(clashAuthorizationHeaders(""), {});
});

test("route probe documents explicit proxy bypass for selector-controlled uploads", () => {
  const result = spawnSync(process.execPath, ["tools/notion-upload-route-probe.mjs", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--no-proxy\s+Bypass explicit HTTP\(S\) proxy variables/u);
  assert.match(result.stdout, /--clash-pipe <path>\s+Clash controller named pipe/u);
});

test("route probe accepts the active Clash controller pipe", () => {
  const options = parseArgs([
    "--file", "probe.mp4",
    "--clash-pipe", "\\\\.\\pipe\\mihomo-active"
  ]);
  assert.equal(options.clashPipe, "\\\\.\\pipe\\mihomo-active");
});

test("route probe retains a reused keep-alive connection when its upload counter advances", () => {
  const baseline = new Map([["reused", 4096], ["idle", 1024]]);
  const connections = filterTransferConnections([
    { id: "reused", uploadedBytes: 8192, start: "2026-10-02T14:00:00.000Z" },
    { id: "idle", uploadedBytes: 1024, start: "2026-10-02T14:00:00.000Z" }
  ], baseline, Date.parse("2026-10-02T14:30:00.000Z"));
  assert.deepEqual(connections.map(connection => connection.id), ["reused"]);
});
