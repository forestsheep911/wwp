import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import { createPersonCatalogStore } from "@wwpdw/cache-store";
import { LocalRunLease, writeJsonAtomic } from "./person-enrichment.js";
import { NotionPeopleSource } from "./notion-people-source.js";
import {
  emptyPeopleNotionSyncCheckpoint,
  runPeopleNotionSync,
  type PeopleNotionSyncCheckpoint
} from "./person-notion-sync.js";
import { ProviderRateLimiter } from "./person-sources/provider-http.js";
import { installNotionDnsOverride, notionProxyUrl } from "./notion-network.js";
import { AzurePeopleNotionSyncStateStore } from "./person-notion-sync-state.js";

export async function runPeopleNotionSyncFromEnvironment(options: {
  apply?: boolean;
  limit?: number;
  pageSize?: number;
  stateDir?: string;
} = {}) {
  if (!enabled(process.env.WWPDW_PEOPLE_NOTION_SYNC_ENABLED, true)) {
    return { mode: "skipped" as const, reason: "disabled" };
  }
  const token = process.env.NOTION_READ_ONLY_TOKEN || process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN;
  const dataSourceId = process.env.NOTION_PEOPLE_DATA_SOURCE_ID?.trim();
  if (!token || !dataSourceId) {
    return {
      mode: "skipped" as const,
      reason: !token ? "missing_notion_token" : "missing_people_data_source_id"
    };
  }

  const stateDir = path.resolve(options.stateDir ?? process.env.WWPDW_PEOPLE_STATE_DIR ?? ".local-data/people");
  const checkpointPath = path.join(stateDir, "notion-sync-checkpoint.json");
  const reportPath = path.join(stateDir, "notion-sync-last-report.json");
  const stateBackend = (process.env.WWPDW_PEOPLE_SYNC_STATE_BACKEND ?? "local").toLowerCase();
  if (!new Set(["local", "azure"]).has(stateBackend)) {
    throw new Error(`Unsupported WWPDW_PEOPLE_SYNC_STATE_BACKEND: ${stateBackend}.`);
  }
  const azureState = stateBackend === "azure" ? new AzurePeopleNotionSyncStateStore() : undefined;
  const lease = new LocalRunLease(path.join(stateDir, "notion-people.lock"));
  const checkpoint = azureState
    ? await azureState.readCheckpoint()
    : await readCheckpoint(checkpointPath);
  installNotionDnsOverride();
  const proxyUrl = notionProxyUrl();
  const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl, { keepAlive: false }) : undefined;
  const clientOptions: ConstructorParameters<typeof Client>[0] = { auth: token };
  if (proxyAgent) clientOptions.agent = proxyAgent;
  const source = new NotionPeopleSource(new Client(clientOptions), dataSourceId, new ProviderRateLimiter(1_000));
  const store = createPersonCatalogStore();

  await lease.acquire();
  try {
    const result = await runPeopleNotionSync({
      source,
      store,
      checkpoint,
      apply: options.apply ?? true,
      limit: options.limit,
      pageSize: options.pageSize ?? numberOption("WWPDW_PEOPLE_NOTION_SYNC_PAGE_SIZE", 100),
      overlapMinutes: numberOption("WWPDW_PEOPLE_NOTION_SYNC_OVERLAP_MINUTES", 10),
      persistCheckpoint: (value) => azureState
        ? azureState.writeCheckpoint(value)
        : writeJsonAtomic(checkpointPath, value)
    });
    const report = {
      ...result,
      store: store.description,
      dataSourceId,
      state: azureState?.description ?? `local:${stateDir}`,
      ...(azureState ? {} : { checkpointPath, reportPath })
    };
    if (azureState) await azureState.writeReport(report);
    else await writeJsonAtomic(reportPath, report);
    return report;
  } finally {
    proxyAgent?.destroy();
    await lease.release();
  }
}

async function readCheckpoint(filePath: string): Promise<PeopleNotionSyncCheckpoint> {
  try {
    const value = JSON.parse(await readFile(filePath, "utf8")) as PeopleNotionSyncCheckpoint;
    if (value.schemaVersion !== 1) throw new Error(`Unsupported People Notion sync checkpoint: ${String(value.schemaVersion)}`);
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyPeopleNotionSyncCheckpoint();
    throw error;
  }
}

function enabled(value: string | undefined, fallback: boolean) {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function numberOption(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;
}
