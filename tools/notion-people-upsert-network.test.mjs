import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.resolve("tools/notion-people-upsert.mjs");

test("people upsert rejects a fixed Notion IP without physical-interface binding", () => {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", script,
    "--report", "missing-report.json",
    "--resolve-ip", "203.0.113.10",
    "--no-proxy"
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--resolve-ip requires --local-address <physical-lan-ip> and --no-proxy/u);
});

test("people upsert accepts the complete fixed-IP direct-route argument set", () => {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", script,
    "--report", "missing-report.json",
    "--resolve-ip", "203.0.113.10",
    "--local-address", "192.0.2.10",
    "--no-proxy"
  ], { encoding: "utf8" });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /requires --local-address|requires --resolve-ip/u);
  assert.match(result.stderr, /ENOENT|no such file/u);
});
