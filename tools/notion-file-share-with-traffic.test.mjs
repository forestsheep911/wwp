import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { trafficReportPath, uploadedBytesFromState } from "./notion-file-share-with-traffic.mjs";

test("counts each accepted multipart part once and caps the final part", () => {
  const state = {
    file: { bytes: 45 },
    plan: { partBytes: 20, partCount: 3 },
    upload: { sentParts: [1, 2, 2, 3] }
  };
  assert.equal(uploadedBytesFromState(state), 45);
});

test("ignores invalid or missing upload state", () => {
  assert.equal(uploadedBytesFromState(null), 0);
  assert.equal(uploadedBytesFromState({ file: { bytes: 100 }, plan: { partBytes: 25 } }), 0);
});

test("keeps prior traffic reports when a multipart upload resumes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wwp-upload-monitor-"));
  try {
    const state = path.join(dir, "upload.json");
    fs.writeFileSync(`${state}.vpn-traffic.json`, "{}\n");
    assert.equal(
      trafficReportPath(state, new Date("2026-10-02T00:00:00.000Z")),
      `${state}.2026-10-02T00-00-00-000Z.vpn-traffic.json`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
