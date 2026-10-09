import test from "node:test";
import assert from "node:assert/strict";
import { flattenSettings, vaultContentType } from "./cloud-config.mjs";
import { migrationItems } from "../migrate-cloud-config.mjs";

const settings = { prefix: "wwp:", label: "dev", machine: "dev:machine:test" };
test("labels override deterministically, exclude other projects, preserve Vault references", () => {
  const values = flattenSettings([
    { key: "wwp:PORT", label: settings.machine, value: "9000" },
    { key: "other:PORT", label: "dev", value: "bad" },
    { key: "wwp:PORT", label: "dev", value: "8000" },
    { key: "wwp:TOKEN", label: "dev", value: JSON.stringify({ uri: "https://vault.vault.azure.net/secrets/TOKEN" }), contentType: vaultContentType }
  ], settings);
  assert.deepEqual(values, { PORT: "9000", TOKEN__KEY_VAULT: "vault/TOKEN" });
});
test("machine value replaces a base reference without retaining the old binding", () => {
  const values = flattenSettings([
    { key: "wwp:KEY", label: "dev", value: JSON.stringify({ uri: "https://vault.vault.azure.net/secrets/KEY" }), contentType: vaultContentType },
    { key: "wwp:KEY", label: settings.machine, value: "override" }
  ], settings);
  assert.deepEqual(values, { KEY: "override" });
});
test("invalid Vault targets are rejected", () => {
  assert.throws(() => flattenSettings([{ key: "wwp:KEY", label: "dev", value: '{"uri":"https://attacker.example/secret"}', contentType: vaultContentType }], settings), /Invalid Key Vault/);
});
test("plain secret values cannot enter the metadata cache", () => {
  assert.throws(() => flattenSettings([{ key: "wwp:NOTION_TOKEN", label: "dev", value: "do-not-cache" }], settings), /Plaintext sensitive/);
});
test("migration isolates machine paths and rejects plaintext credentials", () => {
  const items = migrationItems({ API_PORT: "8000", WWPDW_MEDIA_ROOT: "F:/media", NOTION_TOKEN__KEY_VAULT: "vault/TOKEN" }, settings.machine);
  assert.equal(items.find(i => i.key === "wwp:WWPDW_MEDIA_ROOT").label, settings.machine);
  assert.equal(items.find(i => i.key === "wwp:NOTION_TOKEN").content_type, vaultContentType);
  assert.throws(() => migrationItems({ NOTION_TOKEN: "do-not-upload" }, settings.machine), /Refusing plaintext/);
});
