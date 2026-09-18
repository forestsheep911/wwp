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

class QueryMemoryTable extends MemoryTable {
  entityReads = 0;
  listReads = 0;
  listFilter = "";

  override async getEntity<T extends object>(partitionKey: string, rowKey: string) {
    this.entityReads += 1;
    return super.getEntity<T>(partitionKey, rowKey);
  }

  async *listEntities<T extends object>(options?: { queryOptions?: { filter?: string } }) {
    this.listReads += 1;
    this.listFilter = options?.queryOptions?.filter ?? "";
    for (const entity of this.entities.values()) yield structuredClone(entity) as T;
  }
}

class FlakyQueryTable extends QueryMemoryTable {
  listFailuresRemaining = 1;

  override async *listEntities<T extends object>(options?: { queryOptions?: { filter?: string } }) {
    this.listReads += 1;
    this.listFilter = options?.queryOptions?.filter ?? "";
    if (this.listFailuresRemaining > 0) {
      this.listFailuresRemaining -= 1;
      throw Object.assign(new Error("table query timed out"), { code: "ETIMEDOUT" });
    }
    for (const entity of this.entities.values()) yield structuredClone(entity) as T;
  }
}

class FlakyReadTable extends MemoryTable {
  failuresRemaining = 2;

  override async getEntity<T extends object>(partitionKey: string, rowKey: string) {
    if (this.failuresRemaining > 0) {
      this.failuresRemaining -= 1;
      throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    }
    return super.getEntity<T>(partitionKey, rowKey);
  }
}

class HangingQueryTable extends QueryMemoryTable {
  override async *listEntities<T extends object>() {
    this.listReads += 1;
    await new Promise(() => {});
    yield {} as T;
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

test("Azure person catalog reads one generation with a bounded table query", async () => {
  const table = new QueryMemoryTable();
  const writer = new AzurePersonCatalogStore({ tableClient: table });
  const largeState = state();
  largeState.aliasIndex.large = ["x".repeat(100_000)];
  await writer.replaceState(largeState);

  table.entityReads = 0;
  assert.deepEqual(await writer.getState(), largeState);
  assert.equal(table.entityReads, 1);
  assert.equal(table.listReads, 1);
  assert.match(table.listFilter, /PartitionKey eq 'personcatalog'/u);
  assert.match(table.listFilter, /RowKey ge 'snapshot:[^']+:'/u);
  assert.match(table.listFilter, /RowKey lt 'snapshot:[^']+:~'/u);
  assert.doesNotMatch(table.listFilter, /generationId eq/u);
});

test("Azure person catalog can use bounded chunk reads when range query is disabled", async () => {
  const table = new QueryMemoryTable();
  const writer = new AzurePersonCatalogStore({ tableClient: table });
  await writer.replaceState(state());
  const previous = process.env.PERSON_CATALOG_AZURE_DISABLE_RANGE_QUERY;
  process.env.PERSON_CATALOG_AZURE_DISABLE_RANGE_QUERY = "1";
  try {
    table.entityReads = 0;
    table.listReads = 0;
    assert.deepEqual(await writer.getState(), state());
    assert.equal(table.entityReads, 2);
    assert.equal(table.listReads, 0);
  } finally {
    if (previous === undefined) delete process.env.PERSON_CATALOG_AZURE_DISABLE_RANGE_QUERY;
    else process.env.PERSON_CATALOG_AZURE_DISABLE_RANGE_QUERY = previous;
  }
});

test("Azure person catalog falls back to known chunks after a transient range-query failure", async () => {
  const table = new FlakyQueryTable();
  const writer = new AzurePersonCatalogStore({ tableClient: table });
  await writer.replaceState(state());

  table.entityReads = 0;
  table.listReads = 0;
  assert.deepEqual(await writer.getState(), state());
  assert.equal(table.listReads, 1);
  assert.equal(table.entityReads, 2);
});

test("Azure person catalog falls back when a range query hangs past its bound", async () => {
  const table = new HangingQueryTable();
  const writer = new AzurePersonCatalogStore({ tableClient: table });
  await writer.replaceState(state());
  const previous = process.env.PERSON_CATALOG_AZURE_RANGE_QUERY_TIMEOUT_MS;
  process.env.PERSON_CATALOG_AZURE_RANGE_QUERY_TIMEOUT_MS = "10";
  try {
    assert.deepEqual(await writer.getState(), state());
    assert.equal(table.listReads, 1);
    assert.equal(table.entityReads, 2);
  } finally {
    if (previous === undefined) delete process.env.PERSON_CATALOG_AZURE_RANGE_QUERY_TIMEOUT_MS;
    else process.env.PERSON_CATALOG_AZURE_RANGE_QUERY_TIMEOUT_MS = previous;
  }
});

test("Azure person catalog retries transient reads before failing", async () => {
  const table = new FlakyReadTable();
  const store = new AzurePersonCatalogStore({ tableClient: table });
  await store.replaceState(state());

  assert.deepEqual(await store.getState(), state());
  assert.equal(table.failuresRemaining, 0);
});
