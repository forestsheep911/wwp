import "dotenv/config";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";

import { comparePeopleSchema, createPeopleDatabase, DEPRECATED_PEOPLE_PROPERTIES, inspectPeopleSchemaTarget, peoplePropertySchema } from "../apps/api/src/notion-people-schema.ts";
import { installNotionDnsOverride, notionProxyUrl } from "../apps/api/src/notion-network.ts";

const apply = process.argv.includes("--apply");
const mediaSourceId = required(process.env.NOTION_MEDIA_ASSETS_DATA_SOURCE_ID, "NOTION_MEDIA_ASSETS_DATA_SOURCE_ID");
const readToken = process.env.NOTION_READ_ONLY_TOKEN || process.env.NOTION_TOKEN;
const writeToken = process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN;
installNotionDnsOverride();
const clientOptions = { auth: required(apply ? writeToken : readToken, apply ? "NOTION_WRITE_TOKEN or NOTION_TOKEN" : "NOTION_READ_ONLY_TOKEN or NOTION_TOKEN") };
const proxyUrl = notionProxyUrl();
const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl, { keepAlive: false }) : undefined;
if (proxyAgent) clientOptions.agent = proxyAgent;
const notion = new Client(clientOptions);
const proposal = await inspectPeopleSchemaTarget(notion, mediaSourceId);
const configuredPeopleSourceId = process.env.NOTION_PEOPLE_DATA_SOURCE_ID?.trim();

if (!apply) {
  if (configuredPeopleSourceId) {
    await sleep(1_000);
    const existing = await notion.dataSources.retrieve({ data_source_id: configuredPeopleSourceId });
    const properties = "properties" in existing ? existing.properties : {};
    process.stdout.write(`${JSON.stringify({
      mode: "readback",
      databaseId: process.env.NOTION_PEOPLE_DATABASE_ID,
      dataSourceId: configuredPeopleSourceId,
      propertyCount: Object.keys(properties).length,
      schemaComparison: comparePeopleSchema(properties),
      siblingTargetMatches: "database_parent" in existing && existing.database_parent.type === "page_id" && existing.database_parent.page_id === proposal.parentPageId
    }, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify({ mode: "dry-run", proposal }, null, 2)}\n`);
  }
  proxyAgent?.destroy();
  process.exit(0);
}
if (configuredPeopleSourceId) {
  await sleep(1_000);
  const existing = await notion.dataSources.retrieve({ data_source_id: configuredPeopleSourceId });
  const properties = "properties" in existing ? existing.properties : {};
  const comparison = comparePeopleSchema(properties);
  if (comparison.typeMismatches.length) throw new Error(`People schema has unsafe type drift: ${JSON.stringify(comparison.typeMismatches)}`);
  const patchNames = [...new Set([
    ...comparison.missing,
    ...comparison.optionMismatches.map((entry) => entry.name)
  ])];
  const removedProperties = DEPRECATED_PEOPLE_PROPERTIES.filter((name) => properties[name]);
  if (patchNames.length || removedProperties.length) {
    const expected = peoplePropertySchema();
    const propertyPatch = Object.fromEntries([
      ...patchNames.map((name) => [name, expected[name]]),
      ...removedProperties.map((name) => [name, null])
    ]);
    await sleep(1_000);
    await notion.dataSources.update({ data_source_id: configuredPeopleSourceId, properties: propertyPatch });
  }
  await sleep(1_000);
  const readback = await notion.dataSources.retrieve({ data_source_id: configuredPeopleSourceId });
  const readbackProperties = "properties" in readback ? readback.properties : {};
  const readbackComparison = comparePeopleSchema(readbackProperties);
  const deprecatedAfterUpdate = DEPRECATED_PEOPLE_PROPERTIES.filter((name) => readbackProperties[name]);
  if (readbackComparison.missing.length || readbackComparison.typeMismatches.length || readbackComparison.optionMismatches.length || deprecatedAfterUpdate.length) {
    throw new Error(`People schema readback failed: ${JSON.stringify(readbackComparison)}`);
  }
  process.stdout.write(`${JSON.stringify({
    mode: patchNames.length || removedProperties.length ? "schema-updated" : "unchanged",
    databaseId: process.env.NOTION_PEOPLE_DATABASE_ID,
    dataSourceId: configuredPeopleSourceId,
    updatedProperties: patchNames,
    removedProperties,
    propertyCount: Object.keys(readbackProperties).length,
    schemaComparison: readbackComparison
  }, null, 2)}\n`);
  proxyAgent?.destroy();
  process.exit(0);
}
if (process.env.NOTION_PEOPLE_DATABASE_ID) {
  throw new Error("People database ID is configured without its data source ID; refusing to create another one.");
}
await sleep(1_000);
const created = await createPeopleDatabase(notion, proposal);
if (!("data_sources" in created) || !created.data_sources?.[0]?.id) throw new Error("Created database response did not include an initial data source ID.");
await sleep(1_000);
const readback = await notion.dataSources.retrieve({ data_source_id: created.data_sources[0].id });
const properties = "properties" in readback ? readback.properties : {};
const comparison = comparePeopleSchema(properties);
if (comparison.missing.length || comparison.typeMismatches.length || comparison.optionMismatches.length) throw new Error(`People schema readback failed: ${JSON.stringify(comparison)}`);
process.stdout.write(`${JSON.stringify({
  mode: "applied",
  databaseId: created.id,
  dataSourceId: created.data_sources[0].id,
  parentPageId: proposal.parentPageId,
  propertyCount: Object.keys(properties).length,
  schemaComparison: comparison,
  next: "Copy the two IDs into NOTION_PEOPLE_DATABASE_ID and NOTION_PEOPLE_DATA_SOURCE_ID. No person rows were written."
}, null, 2)}\n`);
proxyAgent?.destroy();

function required(value, name) {
  if (!value?.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
