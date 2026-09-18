import test from "node:test";
import assert from "node:assert/strict";

function assertBackendMatch(preflightBackend, stores) {
  if (preflightBackend && stores.some((store) => store !== preflightBackend)) {
    throw new Error(`People apply backend mismatch: preflight=${preflightBackend}, stores=${stores.join(",")}`);
  }
}

function storeBackend(store) {
  return store.description?.startsWith("azure:") ? "azure" : "local";
}

test("people apply rejects a preflight from a different backend", () => {
  assert.throws(() => assertBackendMatch("azure", ["local", "local"]), /backend mismatch/);
});

test("people apply accepts matching backend evidence", () => {
  assert.doesNotThrow(() => assertBackendMatch("azure", ["azure", "azure"]));
});

test("store descriptions identify the active backend", () => {
  assert.equal(storeBackend({ description: "azure:account/table" }), "azure");
  assert.equal(storeBackend({ description: "local:C:/state" }), "local");
});
