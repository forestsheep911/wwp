import "dotenv/config";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";

import {
  compareHonorsSchema,
  createHonorsDatabase,
  honorsPropertySchema,
  inspectHonorsSchemaTarget
} from "../apps/api/src/notion-honors-schema.ts";
import { installNotionDnsOverride, notionProxyUrl } from "../apps/api/src/notion-network.ts";

const apply = process.argv.includes("--apply");
const workSourceId = required(process.env.NOTION_LIBRARY_DATA_SOURCE_ID || process.env.NOTION_DATA_SOURCE_ID, "NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_DATA_SOURCE_ID");
const readToken = process.env.NOTION_READ_ONLY_TOKEN || process.env.NOTION_TOKEN;
const writeToken = process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN;
installNotionDnsOverride();
const clientOptions = { auth: required(apply ? writeToken : readToken, apply ? "NOTION_WRITE_TOKEN or NOTION_TOKEN" : "NOTION_READ_ONLY_TOKEN or NOTION_TOKEN") };
const proxyUrl = notionProxyUrl();
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl, { keepAlive: false }) : undefined;
if (proxyAgent) clientOptions.agent = proxyAgent;
const notion = new Client(clientOptions);
const proposal = await inspectHonorsSchemaTarget(notion, workSourceId);
const configuredHonorsSourceId = process.env.NOTION_HONORS_DATA_SOURCE_ID?.trim();

if (!apply) {
  if (configuredHonorsSourceId) {
    await sleep(1_000);
    const existing = await notion.dataSources.retrieve({ data_source_id: configuredHonorsSourceId });
    const properties = "properties" in existing ? existing.properties : {};
    process.stdout.write(`${JSON.stringify({
      mode: "readback",
      databaseId: process.env.NOTION_HONORS_DATABASE_ID,
      dataSourceId: configuredHonorsSourceId,
      propertyCount: Object.keys(properties).length,
      schemaComparison: compareHonorsSchema(properties, workSourceId),
      siblingTargetMatches: "database_parent" in existing && existing.database_parent.type === "page_id" && existing.database_parent.page_id === proposal.parentPageId
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", proposal }, null, 2)}\n`);
  }
  process.exit(0);
}

if (configuredHonorsSourceId) {
  await sleep(1_000);
  const existing = await notion.dataSources.retrieve({ data_source_id: configuredHonorsSourceId });
  const properties = "properties" in existing ? existing.properties : {};
  const comparison = compareHonorsSchema(properties, workSourceId);
  if (comparison.typeMismatches.length) throw new Error(`Honors schema has unsafe type drift: ${JSON.stringify(comparison.typeMismatches)}`);
  const patchNames = [...new Set([...comparison.missing, ...comparison.optionMismatches.map((entry) => entry.name)])];
  if (patchNames.length) {
    const expected = honorsPropertySchema(workSourceId);
    await sleep(1_000);
    await notion.dataSources.update({
      data_source_id: configuredHonorsSourceId,
      properties: Object.fromEntries(patchNames.map((name) => [name, expected[name]]))
    });
  }
  await sleep(1_000);
  const readback = await notion.dataSources.retrieve({ data_source_id: configuredHonorsSourceId });
  const readbackProperties = "properties" in readback ? readback.properties : {};
  const readbackComparison = compareHonorsSchema(readbackProperties, workSourceId);
  if (readbackComparison.missing.length || readbackComparison.typeMismatches.length || readbackComparison.optionMismatches.length) {
    throw new Error(`Honors schema readback failed: ${JSON.stringify(readbackComparison)}`);
  }
  process.stdout.write(`${JSON.stringify({
    mode: patchNames.length ? "schema-updated" : "unchanged",
    databaseId: process.env.NOTION_HONORS_DATABASE_ID,
    dataSourceId: configuredHonorsSourceId,
    updatedProperties: patchNames,
    propertyCount: Object.keys(readbackProperties).length,
    schemaComparison: readbackComparison
  }, null, 2)}\n`);
  process.exit(0);
}

if (process.env.NOTION_HONORS_DATABASE_ID) {
  throw new Error("Honors database ID is configured without its data source ID; refusing to create another one.");
}
await sleep(1_000);
const created = await createHonorsDatabase(notion, proposal);
if (!("data_sources" in created) || !created.data_sources?.[0]?.id) throw new Error("Created database response did not include an initial data source ID.");
await sleep(1_000);
const readback = await notion.dataSources.retrieve({ data_source_id: created.data_sources[0].id });
const properties = "properties" in readback ? readback.properties : {};
const comparison = compareHonorsSchema(properties, workSourceId);
if (comparison.missing.length || comparison.typeMismatches.length || comparison.optionMismatches.length) throw new Error(`Honors schema readback failed: ${JSON.stringify(comparison)}`);
process.stdout.write(`${JSON.stringify({
  mode: "applied",
  databaseId: created.id,
  dataSourceId: created.data_sources[0].id,
  parentPageId: proposal.parentPageId,
  propertyCount: Object.keys(properties).length,
  schemaComparison: comparison,
  next: "Copy the two IDs into NOTION_HONORS_DATABASE_ID and NOTION_HONORS_DATA_SOURCE_ID. No honor rows were written."
}, null, 2)}\n`);
function required(value, name) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
