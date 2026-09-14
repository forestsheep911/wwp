import test from "node:test";
import assert from "node:assert/strict";
import { parseArgs } from "./notion-people-deduplicate-report.mjs";

test("people deduplication physical direct route requires the complete guard", () => {
  assert.throws(() => parseArgs(["--report", "one.json", "--resolve-ip", "208.103.161.2"]), /requires --local-address/u);
  assert.throws(() => parseArgs(["--report", "one.json", "--local-address", "192.168.1.22"]), /requires --resolve-ip/u);
  const options = parseArgs([
    "--report", "one.json",
    "--resolve-ip", "208.103.161.2",
    "--local-address", "192.168.1.22",
    "--no-proxy"
  ]);
  assert.equal(options.resolveIp, "208.103.161.2");
  assert.equal(options.localAddress, "192.168.1.22");
  assert.equal(options.noProxy, true);
});
