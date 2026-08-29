import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("route probe documents explicit proxy bypass for selector-controlled uploads", () => {
  const result = spawnSync(process.execPath, ["tools/notion-upload-route-probe.mjs", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /--no-proxy\s+Bypass explicit HTTP\(S\) proxy variables/u);
});
