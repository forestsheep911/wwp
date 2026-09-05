import type { Client } from "@notionhq/client";

type NotionClient = Pick<Client, "dataSources" | "databases">;

export const HONORS_DATABASE_TITLE = "Honors / 荣誉";

export function honorsPropertySchema(workDataSourceId: string) {
  return {
    Name: { title: {} },
    "Honor ID": { rich_text: {} },
    Work: {
      relation: {
        data_source_id: workDataSourceId,
        type: "dual_property" as const,
        dual_property: { synced_property_name: "Honors" }
      }
    },
    "Awarding Body": { rich_text: {} },
    Event: { rich_text: {} },
    "Edition Year": { number: { format: "number" as const } },
    Category: { rich_text: {} },
    Result: { select: { options: [
      { name: "winner", color: "green" as const },
      { name: "nominee", color: "blue" as const },
      { name: "selection", color: "yellow" as const },
      { name: "special_mention", color: "purple" as const }
    ] } },
    Recipients: { rich_text: {} },
    Sources: { rich_text: {} },
    "Review Status": { select: { options: [
      { name: "draft", color: "gray" as const },
      { name: "verified", color: "green" as const },
      { name: "conflict", color: "red" as const }
    ] } },
    "Checked At": { date: {} },
    "Developer Memo": { rich_text: {} }
  };
}

export interface HonorsSchemaProposal {
  title: string;
  parentPageId: string;
  workDataSourceId: string;
  workDatabaseId?: string;
  workTitle?: string;
  propertyNames: string[];
  writesRequired: number;
}

export async function inspectHonorsSchemaTarget(
  notion: NotionClient,
  workDataSourceId: string
): Promise<HonorsSchemaProposal> {
  const source = await notion.dataSources.retrieve({ data_source_id: workDataSourceId }) as unknown as {
    id: string;
    title?: Array<{ plain_text?: string }>;
    parent?: { database_id?: string };
    database_parent?: { type?: string; page_id?: string };
  };
  if (source.database_parent?.type !== "page_id" || !source.database_parent.page_id) {
    throw new Error("Work data source is not under a page parent; refusing to guess the Honors database target.");
  }
  return {
    title: HONORS_DATABASE_TITLE,
    parentPageId: source.database_parent.page_id,
    workDataSourceId: source.id,
    workDatabaseId: source.parent?.database_id,
    workTitle: source.title?.map((part) => part.plain_text ?? "").join("") || undefined,
    propertyNames: Object.keys(honorsPropertySchema(source.id)),
    writesRequired: 1
  };
}

export async function createHonorsDatabase(notion: NotionClient, proposal: HonorsSchemaProposal) {
  return notion.databases.create({
    parent: { type: "page_id", page_id: proposal.parentPageId },
    title: [{ type: "text", text: { content: proposal.title } }],
    description: [{ type: "text", text: { content: "WWP 作品荣誉事实库。获奖、提名、入选与特别提及分条记录并保留来源。" } }],
    is_inline: false,
    initial_data_source: { properties: honorsPropertySchema(proposal.workDataSourceId) },
    icon: { type: "emoji", emoji: "🏆" }
  });
}

export function compareHonorsSchema(
  actualProperties: Record<string, { type?: string; [key: string]: unknown }>,
  workDataSourceId: string
) {
  const expected = honorsPropertySchema(workDataSourceId);
  const missing: string[] = [];
  const typeMismatches: Array<{ name: string; expected: string; actual?: string }> = [];
  const optionMismatches: Array<{ name: string; missing: string[]; extra: string[] }> = [];
  for (const [name, config] of Object.entries(expected)) {
    const expectedType = Object.keys(config)[0];
    const actual = actualProperties[name];
    if (!actual) missing.push(name);
    else if (actual.type !== expectedType) typeMismatches.push({ name, expected: expectedType, actual: actual.type });
    else {
      const expectedOptions = ((config as Record<string, { options?: Array<{ name: string }> }>)[expectedType]?.options ?? []).map((option) => option.name);
      const actualOptions = ((actual[expectedType] as { options?: Array<{ name?: string }> } | undefined)?.options ?? [])
        .map((option) => option.name)
        .filter((option): option is string => Boolean(option));
      const missingOptions = expectedOptions.length ? expectedOptions.filter((option) => !actualOptions.includes(option)) : [];
      const extraOptions = expectedOptions.length ? actualOptions.filter((option) => !expectedOptions.includes(option)) : [];
      if (missingOptions.length || extraOptions.length) optionMismatches.push({ name, missing: missingOptions, extra: extraOptions });
    }
  }
  return { missing, typeMismatches, optionMismatches, extra: Object.keys(actualProperties).filter((name) => !(name in expected)) };
}
