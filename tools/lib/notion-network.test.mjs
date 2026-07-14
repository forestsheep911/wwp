import test from "node:test";
import assert from "node:assert/strict";
import { installNotionDnsOverride } from "./notion-network.mjs";

test("DNS override replaces only api.notion.com while preserving other lookups", () => {
  let installed;
  const original = (hostname, options, callback) => callback(null, `origin:${hostname}`, 4);
  installNotionDnsOverride("208.103.161.1", { lookup: original, setLookup: (value) => { installed = value; } });

  installed("api.notion.com", (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "208.103.161.1");
    assert.equal(family, 4);
  });
  installed("example.com", {}, (error, address, family) => {
    assert.equal(error, null);
    assert.equal(address, "origin:example.com");
    assert.equal(family, 4);
  });
});
