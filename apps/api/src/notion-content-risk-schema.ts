import "./env.js";
import dns from "node:dns";
import { Client } from "@notionhq/client";
import { notionManagedProperties } from "./notion-metadata-schema.js";

type JsonRecord = Record<string, unknown>;

const dataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
const requestTimeoutMs = Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000);

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function installNotionDnsOverride() {
  const notionApiIp = process.env.NOTION_API_RESOLVE_IP?.trim();
  if (!notionApiIp) return;
  const originalLookup = dns.lookup.bind(dns) as (...args: unknown[]) => unknown;
  dns.lookup = ((hostname: string, options: unknown, callback?: unknown) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") {
        options(null, notionApiIp, 4);
        return;
      }
      if (typeof callback === "function") {
        if (options && typeof options === "object" && "all" in options && options.all) {
          callback(null, [{ address: notionApiIp, family: 4 }]);
          return;
        }
        callback(null, notionApiIp, 4);
        return;
      }
    }
    return originalLookup(hostname, options, callback);
  }) as typeof dns.lookup;
}

function optionNames(dataSource: JsonRecord) {
  const properties = asRecord(dataSource.properties) ?? {};
  const property = asRecord(properties["内容风险标签"]);
  const config = asRecord(property?.multi_select);
  return asArray(config?.options).map((item) => String(asRecord(item)?.name ?? "")).filter(Boolean);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const keepLegacy = args.includes("--keep-legacy-adult-theme");
  const token = apply
    ? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN
    : process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN;
  if (!token) throw new Error("Set a Notion token before syncing content-risk options.");
  if (!dataSourceId) throw new Error("Set NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_DATA_SOURCE_ID.");

  installNotionDnsOverride();
  const notion = new Client({ auth: token, timeoutMs: requestTimeoutMs });
  const before = await notion.dataSources.retrieve({ data_source_id: dataSourceId }) as unknown as JsonRecord;
  const managed = notionManagedProperties.find((property) => property.name === "内容风险标签");
  const target = [...(managed?.options ?? [])];
  if (keepLegacy) target.push({ name: "成人主题", color: "brown" });

  if (apply) {
    await notion.dataSources.update({
      data_source_id: dataSourceId,
      properties: {
        "内容风险标签": { multi_select: { options: target } }
      }
    } as never);
  }

  const after = apply
    ? await notion.dataSources.retrieve({ data_source_id: dataSourceId }) as unknown as JsonRecord
    : before;
  const actualNames = optionNames(after);
  const targetNames = target.map((option) => option.name);
  const matches = targetNames.length === actualNames.length && targetNames.every((name, index) => name === actualNames[index]);
  const report = {
    mode: apply ? "apply" : "dry-run",
    dataSourceId,
    keepLegacy,
    before: optionNames(before),
    target: targetNames,
    after: actualNames,
    matches
  };
  console.log(JSON.stringify(report, null, 2));
  if (apply && !matches) throw new Error("Content-risk option readback does not match the managed target.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
