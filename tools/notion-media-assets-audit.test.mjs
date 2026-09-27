import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./notion-media-assets-audit.mjs", import.meta.url), "utf8");

test("Media Assets audit binds the physical interface for resolved direct requests", () => {
  assert.match(source, /name === "--local-address"\) options\.localAddress = value\(\)/u);
  assert.match(source, /--resolve-ip and --local-address must be used together/u);
  assert.match(source, /new https\.Agent\(\{ keepAlive: true, localAddress \}\)/u);
  assert.match(source, /createPacedFetch\(nodeFetch, \{ minIntervalMs: 1000 \}\)/u);
  assert.match(source, /--resolve-ip <api-ip> --local-address <lan-ip> --no-proxy/u);
});

test("manual upload organizer uses a paced bound-direct Notion client", () => {
  const organizer = fs.readFileSync(new URL("./notion-manual-upload-organizer.mjs", import.meta.url), "utf8");
  assert.match(organizer, /name === "--local-address"\) options\.localAddress = value\(\)/u);
  assert.match(organizer, /--resolve-ip and --local-address must be used together/u);
  assert.match(organizer, /new https\.Agent\(\{ keepAlive: true, localAddress \}\)/u);
  assert.match(organizer, /createPacedFetch\(nodeFetch, \{ minIntervalMs: 1000 \}\)/u);
});
