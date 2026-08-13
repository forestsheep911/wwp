import assert from "node:assert/strict";
import test from "node:test";
import { AzurePeopleNotionSyncStateStore, type PeopleNotionSyncStateTableClient } from "./person-notion-sync-state.js";

class FakeTableClient implements PeopleNotionSyncStateTableClient {
  readonly rows = new Map<string, Record<string, unknown>>();
  createCalls = 0;

  async createTable() {
    this.createCalls += 1;
  }

  async getEntity<T extends object>(partitionKey: string, rowKey: string) {
    const value = this.rows.get(`${partitionKey}:${rowKey}`);
    if (!value) throw Object.assign(new Error("missing"), { statusCode: 404 });
    return value as T;
  }

  async upsertEntity<T extends object>(entity: T) {
    const value = entity as T & { partitionKey: string; rowKey: string };
    this.rows.set(`${value.partitionKey}:${value.rowKey}`, structuredClone(value));
  }
}

test("Azure People sync state starts empty and persists checkpoint and report", async () => {
  const tableClient = new FakeTableClient();
  const store = new AzurePeopleNotionSyncStateStore({ tableClient, accountName: "test", tableName: "people" });
  assert.deepEqual(await store.readCheckpoint(), { schemaVersion: 1 });

  const checkpoint = {
    schemaVersion: 1 as const,
    lastSuccessfulSyncAt: "2026-08-14T08:00:00.000Z",
    lastSourceEditedAt: "2026-08-14T07:55:00.000Z"
  };
  await store.writeCheckpoint(checkpoint);
  await store.writeReport({ mode: "applied", scanned: 2 });

  assert.deepEqual(await store.readCheckpoint(), checkpoint);
  assert.equal(JSON.parse(String(tableClient.rows.get("peopleNotionSync:latestReport")?.payload)).scanned, 2);
  assert.equal(tableClient.createCalls, 1);
});
