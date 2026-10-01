import assert from "node:assert/strict";
import test from "node:test";
import { resolveSecretReferences } from "./project-secrets.mjs";

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
