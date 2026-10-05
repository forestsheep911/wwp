import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { projectEnv, resolveSecretReferences } from "./project-secrets.mjs";

test("vault references hydrate memory and preserve deployment overrides", () => {
  const env = { TOKEN__KEY_VAULT: "vault/token", KEY__KEY_VAULT: "vault/key", KEY: "injected" };
  const calls = [];
  resolveSecretReferences(env, (vault, name) => { calls.push([vault, name]); return "secret"; });
  assert.equal(env.TOKEN, "secret");
  assert.equal(env.KEY, "injected");
  assert.deepEqual(calls, [["vault", "token"]]);
  resolveSecretReferences(env, () => { throw new Error("must not fetch twice"); });
});

test("invalid references fail before invoking Azure", () => {
  assert.throws(() => resolveSecretReferences({ TOKEN__KEY_VAULT: "vault/token;evil" }, () => assert.fail()), /Invalid Key Vault reference/);
});

test("selective resolution ignores unrelated vault references", () => {
  const env = {
    NOTION_TOKEN__KEY_VAULT: "vault/notion",
    ALIBABA_CLOUD_ACCESS_KEY_ID__KEY_VAULT: "vault/alibaba"
  };
  const calls = [];
  resolveSecretReferences(env, (vault, name) => { calls.push([vault, name]); return `${name}-secret`; }, new Set(["NOTION_TOKEN"]));
  assert.equal(env.NOTION_TOKEN, "notion-secret");
  assert.equal(env.ALIBABA_CLOUD_ACCESS_KEY_ID, undefined);
  assert.deepEqual(calls, [["vault", "notion"]]);
});

test("projectEnv loads plain values without resolving unrelated vault references", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wwp-project-env-"));
  const envPath = path.join(dir, ".env");
  const previousPath = process.env.DOTENV_CONFIG_PATH;
  const previousValue = process.env.WWP_TEST_PLAIN_VALUE;
  const previousSecret = process.env.WWP_TEST_UNRELATED_SECRET;
  try {
    writeFileSync(envPath, "WWP_TEST_PLAIN_VALUE=local\nWWP_TEST_UNRELATED_SECRET__KEY_VAULT=missing-vault/MISSING-SECRET\n");
    process.env.DOTENV_CONFIG_PATH = envPath;
    delete process.env.WWP_TEST_PLAIN_VALUE;
    delete process.env.WWP_TEST_UNRELATED_SECRET;
    assert.equal(projectEnv("WWP_TEST_PLAIN_VALUE"), "local");
    assert.equal(process.env.WWP_TEST_UNRELATED_SECRET, undefined);
  } finally {
    if (previousPath === undefined) delete process.env.DOTENV_CONFIG_PATH;
    else process.env.DOTENV_CONFIG_PATH = previousPath;
    if (previousValue === undefined) delete process.env.WWP_TEST_PLAIN_VALUE;
    else process.env.WWP_TEST_PLAIN_VALUE = previousValue;
    if (previousSecret === undefined) delete process.env.WWP_TEST_UNRELATED_SECRET;
    else process.env.WWP_TEST_UNRELATED_SECRET = previousSecret;
    rmSync(dir, { recursive: true, force: true });
  }
});
