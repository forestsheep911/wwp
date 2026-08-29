import assert from "node:assert/strict";
import test from "node:test";
import type { PersonCatalogState } from "@wwpdw/shared";

import { AzurePersonCatalogStore, type PersonCatalogTableClient } from "./person-catalog-azure.js";

class MemoryTable implements PersonCatalogTableClient {
  readonly entities = new Map<string, object>();
  manifestWrites = 0;

  async createTable() {}

  async getEntity<T extends object>(partitionKey: string, rowKey: string) {
    const entity = this.entities.get(`${partitionKey}|${rowKey}`);
    if (!entity) throw Object.assign(new Error("not found"), { statusCode: 404 });
    return structuredClone(entity) as T;
  }

  async upsertEntity<T extends object>(entity: T) {
    const value = entity as T & { partitionKey: string; rowKey: string };
    if (value.rowKey === "current") this.manifestWrites += 1;
    this.entities.set(`${value.partitionKey}|${value.rowKey}`, structuredClone(value));
  }
}

class BatchMemoryTable extends MemoryTable {
  transactionWrites = 0;

  async submitTransaction(actions: Parameters<NonNullable<PersonCatalogTableClient["submitTransaction"]>>[0]) {
    this.transactionWrites += 1;
    for (const [, entity] of actions) await this.upsertEntity(entity);
  }
}

function state(): PersonCatalogState {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-10T00:00:00.000Z",
    people: {},
    redirects: {},
    externalIdIndex: { tmdb: {}, imdb: {}, wikidata: {} },
    aliasIndex: {},
    creditsByWorkId: {},
    creditsByPersonId: {},
    issues: []
  };
}

test("Azure person catalog publishes chunks before one manifest switch", async () => {
  const table = new MemoryTable();
  const store = new AzurePersonCatalogStore({ tableClient: table, accountName: "test", tableName: "people" });
  await store.replaceState(state());

  assert.equal(table.manifestWrites, 1);
  assert.deepEqual(await store.getState(), state());
  assert.ok([...table.entities.keys()].some((key) => key.includes("snapshot:")));
});

test("Azure person catalog returns an empty state when no manifest exists", async () => {
  const store = new AzurePersonCatalogStore({ tableClient: new MemoryTable() });
  const result = await store.getState();
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.people, {});
});

test("Azure person catalog batches snapshot chunks and switches the manifest afterward", async () => {
  const table = new BatchMemoryTable();
  const store = new AzurePersonCatalogStore({ tableClient: table });
  const largeState = state();
  largeState.aliasIndex.large = ["x".repeat(100_000)];

  await store.replaceState(largeState);

  assert.equal(table.transactionWrites, 1);
  assert.equal(table.manifestWrites, 1);
  assert.deepEqual(await store.getState(), largeState);
});
