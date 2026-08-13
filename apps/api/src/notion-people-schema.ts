import type { Client } from "@notionhq/client";

type NotionClient = Pick<Client, "dataSources" | "databases">;

export const PEOPLE_DATABASE_TITLE = "People / 创作人";
export const DEPRECATED_PEOPLE_PROPERTIES = ["Biography", "Biography ZH Sources", "Biography EN Sources"] as const;

export function peoplePropertySchema() {
  return {
    Name: { title: {} },
    "Person ID": { rich_text: {} },
    "Chinese Name": { rich_text: {} },
    "English Name": { rich_text: {} },
    "Original Name": { rich_text: {} },
    Aliases: { rich_text: {} },
    "TMDB Person ID": { rich_text: {} },
    "IMDb Name ID": { rich_text: {} },
    "Wikidata QID": { rich_text: {} },
    "Primary Departments": { multi_select: { options: [] } },
    "Birth Date": { date: {} },
    "Death Date": { date: {} },
    "Birth Place": { rich_text: {} },
    "Biography ZH": { rich_text: {} },
    "Biography ZH Status": { select: { options: [
      { name: "draft", color: "gray" as const },
      { name: "partial", color: "yellow" as const },
      { name: "verified", color: "green" as const },
      { name: "conflict", color: "red" as const }
    ] } },
    "Biography ZH Method": { select: { options: [
      { name: "source-summary", color: "gray" as const },
      { name: "editorial-rewrite", color: "green" as const },
      { name: "machine-translation", color: "yellow" as const },
      { name: "source-excerpt", color: "red" as const }
    ] } },
    "Biography EN": { rich_text: {} },
    "Biography EN Status": { select: { options: [
      { name: "draft", color: "gray" as const },
      { name: "partial", color: "yellow" as const },
      { name: "verified", color: "green" as const },
      { name: "conflict", color: "red" as const }
    ] } },
    "Biography EN Method": { select: { options: [
      { name: "source-summary", color: "gray" as const },
      { name: "editorial-rewrite", color: "green" as const },
      { name: "machine-translation", color: "yellow" as const },
      { name: "source-excerpt", color: "red" as const }
    ] } },
    "Profile URL": { url: {} },
    "Name Status": { select: { options: [
      { name: "verified", color: "green" as const },
      { name: "strong", color: "blue" as const },
      { name: "provisional", color: "yellow" as const },
      { name: "conflict", color: "red" as const }
    ] } },
    "Locked Fields": { multi_select: { options: [
      { name: "Chinese Name", color: "default" as const },
      { name: "English Name", color: "default" as const },
      { name: "Original Name", color: "default" as const },
      { name: "Biography ZH", color: "default" as const },
      { name: "Biography EN", color: "default" as const },
      { name: "Profile URL", color: "default" as const }
    ] } },
    "Data Status": { select: { options: [
      { name: "draft", color: "gray" as const },
      { name: "partial", color: "yellow" as const },
      { name: "verified", color: "green" as const },
      { name: "conflict", color: "red" as const }
    ] } },
    Sources: { rich_text: {} },
    "Last Enriched At": { date: {} },
    "Hide from Website": { checkbox: {} },
    "Developer Memo": { rich_text: {} }
  };
}

export interface PeopleSchemaProposal {
  title: string;
  parentPageId: string;
  referenceDatabaseId?: string;
  referenceDataSourceId: string;
  referenceTitle?: string;
  propertyNames: string[];
  writesRequired: number;
}

export async function inspectPeopleSchemaTarget(notion: NotionClient, mediaAssetsDataSourceId: string): Promise<PeopleSchemaProposal> {
  const source = await notion.dataSources.retrieve({ data_source_id: mediaAssetsDataSourceId }) as unknown as {
    id: string;
    title?: Array<{ plain_text?: string }>;
    parent?: { database_id?: string };
    database_parent?: { type?: string; page_id?: string };
  };
  if (source.database_parent?.type !== "page_id" || !source.database_parent.page_id) {
    throw new Error("Media Assets is not under a page parent; refusing to guess the People database target.");
  }
  return {
    title: PEOPLE_DATABASE_TITLE,
    parentPageId: source.database_parent.page_id,
    referenceDatabaseId: source.parent?.database_id,
    referenceDataSourceId: source.id,
    referenceTitle: source.title?.map((part) => part.plain_text ?? "").join("") || undefined,
    propertyNames: Object.keys(peoplePropertySchema()),
    writesRequired: 1
  };
}

export async function createPeopleDatabase(notion: NotionClient, proposal: PeopleSchemaProposal) {
  return notion.databases.create({
    parent: { type: "page_id", page_id: proposal.parentPageId },
    title: [{ type: "text", text: { content: proposal.title } }],
    description: [{ type: "text", text: { content: "WWP 创作人主数据。人物身份以不可变 Person ID 管理，作品关系由运行时 credits 派生。" } }],
    is_inline: false,
    initial_data_source: {
      properties: peoplePropertySchema()
    },
    icon: { type: "emoji", emoji: "🎬" }
  });
}

export function comparePeopleSchema(actualProperties: Record<string, { type?: string; [key: string]: unknown }>) {
  const expected = peoplePropertySchema();
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
