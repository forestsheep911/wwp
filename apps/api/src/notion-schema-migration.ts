import {
  notionManagedProperties,
  propertySchemaPayload
} from "./notion-metadata-schema.js";

type JsonRecord = Record<string, unknown>;

export function schemaPatch(existingProperties: JsonRecord) {
  const patch: Record<string, unknown> = {};
  const legacyIssueName = Object.keys(existingProperties)
    .find((name) => name.trim().toLocaleLowerCase() === "issue");
  const renameLegacyIssue = Boolean(legacyIssueName && !existingProperties["Human Issue"]);

  if (renameLegacyIssue && legacyIssueName) {
    patch[legacyIssueName] = { name: "Human Issue" };
  }

  for (const property of notionManagedProperties) {
    if (existingProperties[property.name]) continue;
    if (property.name === "Human Issue" && renameLegacyIssue) continue;
    patch[property.name] = propertySchemaPayload(property);
  }
  return patch;
}
