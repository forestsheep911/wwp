import type { WorkHonorRecord } from "./work-honor.js";
import { validateWorkHonorRecord } from "./work-honor.js";

type NotionPage = { id: string; properties: Record<string, unknown> };
type NotionHonorsClient = {
  dataSources: { query(input: unknown): Promise<{ results: unknown[]; has_more?: boolean }> };
  pages: {
    create(input: unknown): Promise<{ id: string }>;
    update(input: unknown): Promise<{ id: string }>;
    retrieve(input: unknown): Promise<unknown>;
  };
};

export type HonorUpsertResult = { action: "created" | "updated" | "unchanged"; pageId: string };

export class NotionHonorsSource {
  constructor(
    private readonly notion: NotionHonorsClient,
    private readonly dataSourceId: string,
    private readonly request: <T>(operation: () => Promise<T>) => Promise<T>
  ) {
    if (!dataSourceId.trim()) throw new Error("NOTION_HONORS_DATA_SOURCE_ID is required.");
  }

  async upsert(record: WorkHonorRecord, workPageId: string): Promise<HonorUpsertResult> {
    const validation = validateWorkHonorRecord(record);
    if (!validation.valid) throw new Error(`Invalid honor ${record.honorId}: ${validation.errors.join(", ")}`);
    if (!workPageId.trim()) throw new Error(`Missing Notion work page ID for ${record.workId}.`);
    const response = await this.request(() => this.notion.dataSources.query({
      data_source_id: this.dataSourceId,
      filter: { property: "Honor ID", rich_text: { equals: record.honorId } },
      page_size: 3
    }));
    if (response.has_more || response.results.length > 1) throw new Error(`Duplicate Honors rows found for ${record.honorId}.`);
    const existing = response.results[0] as NotionPage | undefined;
    const properties = notionHonorProperties(record, workPageId);
    if (existing && notionHonorMismatches(existing.properties, properties).length === 0) {
      return { action: "unchanged", pageId: existing.id };
    }
    const written = existing
      ? await this.request(() => this.notion.pages.update({ page_id: existing.id, properties }))
      : await this.request(() => this.notion.pages.create({ parent: { type: "data_source_id", data_source_id: this.dataSourceId }, properties }));
    const readback = await this.request(() => this.notion.pages.retrieve({ page_id: written.id })) as NotionPage;
    const mismatches = notionHonorMismatches(readback.properties, properties);
    if (mismatches.length) throw new Error(`Honors readback mismatch for ${record.honorId}: ${mismatches.join(", ")}.`);
    return { action: existing ? "updated" : "created", pageId: written.id };
  }
}

export function notionHonorProperties(record: WorkHonorRecord, workPageId: string) {
  return {
    Name: title(`${record.eventName} — ${record.category}`),
    "Honor ID": richText(record.honorId),
    Work: { relation: [{ id: workPageId }] },
    "Awarding Body": richText(record.awardingBody),
    Event: richText(record.eventName),
    "Edition Year": { number: record.editionYear },
    Category: richText(record.category),
    Result: { select: { name: record.result } },
    Recipients: richText(record.recipients.join(" / ")),
    Sources: sourceRichText(record.sourceRefs.map((source) => source.url)),
    "Review Status": { select: { name: record.status } },
    "Checked At": { date: { start: record.checkedAt } },
    "Developer Memo": richText("")
  };
}

export function notionHonorMismatches(actual: Record<string, unknown>, expected: ReturnType<typeof notionHonorProperties>) {
  return Object.entries(expected)
    .filter(([name, value]) => JSON.stringify(comparableProperty(actual[name])) !== JSON.stringify(comparableProperty(value)))
    .map(([name]) => name);
}

function comparableProperty(value: unknown): unknown {
  const property = value && typeof value === "object" ? value as Record<string, unknown> : {};
  if ("title" in property || "rich_text" in property) return { text: plainText(property) };
  if ("relation" in property) return { relation: ((property.relation as Array<{ id?: string }> | undefined) ?? []).map((entry) => entry.id ?? "") };
  if ("number" in property) return { number: typeof property.number === "number" ? property.number : null };
  if ("select" in property) return { select: (property.select as { name?: string } | null)?.name ?? null };
  if ("date" in property) {
    const start = (property.date as { start?: string } | null)?.start;
    const normalized = start?.includes("T") && Number.isFinite(Date.parse(start))
      ? new Date(Date.parse(start)).toISOString()
      : start;
    return { date: normalized ?? null };
  }
  return property;
}

function plainText(property: Record<string, unknown>) {
  const parts = (property.title ?? property.rich_text ?? []) as Array<{ plain_text?: string; text?: { content?: string } }>;
  return parts.map((part) => part.plain_text ?? part.text?.content ?? "").join("");
}

function title(value: string) {
  return { title: [{ type: "text" as const, text: { content: value.slice(0, 2_000) } }] };
}

function richText(value: string) {
  return { rich_text: value ? [{ type: "text" as const, text: { content: value.slice(0, 2_000) } }] : [] };
}

function sourceRichText(urls: string[]) {
  return {
    rich_text: urls.flatMap((url, index) => [
      ...(index ? [{ type: "text" as const, text: { content: "\n" } }] : []),
      { type: "text" as const, text: { content: url.slice(0, 2_000), link: { url } } }
    ])
  };
}
