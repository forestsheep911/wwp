import "dotenv/config";
import { runPeopleNotionSyncFromEnvironment } from "./person-notion-sync-runtime.js";

const result = await runPeopleNotionSyncFromEnvironment({ apply: true });
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (result.mode === "skipped") {
  throw new Error(`People sync was skipped: ${result.reason}.`);
}
