import "dotenv/config";
import { createPersonCatalogStore, createSearchIndexStore } from "@wwpdw/cache-store";
import { runPeopleNotionSyncFromEnvironment } from "./person-notion-sync-runtime.js";
import { applyPersonCreditNameSync, planPersonCreditNameSync } from "./person-credit-name-sync.js";

const personStore = createPersonCatalogStore();
const searchStore = createSearchIndexStore();
let creditNameSummary = { affectedWorkCount: 0, searchIndexWrites: 0, catalogChanged: false };
const result = await runPeopleNotionSyncFromEnvironment({
  apply: true,
  beforeCheckpoint: async ({ since, changes, nextCatalog }) => {
    // The first cloud run establishes a checkpoint only. It must not reinterpret
    // every historical credit name from the current profile display name.
    if (!since) return;
    const personIds = new Set(changes.flatMap((change) => "personId" in change ? [change.personId] : []));
    if (personIds.size === 0) return;
    const searchResults = await searchStore.search("", 1_000_000);
    const creditNamePlan = planPersonCreditNameSync(nextCatalog, searchResults, new Date().toISOString(), personIds);
    await applyPersonCreditNameSync({ plan: creditNamePlan, searchStore, personStore });
    creditNameSummary = creditNamePlan.summary;
  }
});
if (result.mode === "skipped") {
  throw new Error(`People sync was skipped: ${result.reason}.`);
}

process.stdout.write(`${JSON.stringify({
  ...result,
  creditNameSync: creditNameSummary
}, null, 2)}\n`);
