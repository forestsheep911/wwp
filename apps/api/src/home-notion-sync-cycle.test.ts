import assert from "node:assert/strict";
import test from "node:test";
import { runHomeNotionSyncCycle } from "./home-notion-sync-cycle.js";

test("runs metadata and People lanes in one home sync cycle", async () => {
  const order: string[] = [];
  const result = await runHomeNotionSyncCycle({
    runMetadataSync: async () => { order.push("metadata"); },
    runPeopleSync: async () => { order.push("people"); return { mode: "applied" }; }
  });
  assert.deepEqual(order, ["metadata", "people"]);
  assert.deepEqual(result.peopleResult, { mode: "applied" });
});

test("still runs People sync when metadata sync fails and reports the cycle failure", async () => {
  let peopleRan = false;
  await assert.rejects(() => runHomeNotionSyncCycle({
    runMetadataSync: async () => { throw new Error("metadata failed"); },
    runPeopleSync: async () => { peopleRan = true; return { mode: "applied" }; }
  }), AggregateError);
  assert.equal(peopleRan, true);
});
