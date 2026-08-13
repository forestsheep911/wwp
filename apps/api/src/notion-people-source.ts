import type { MovieCreditDepartment, PersonLockedField, PersonProfile } from "@wwpdw/shared";
import { selectPersonBiographyTexts, selectPersonDisplayNames } from "@wwpdw/shared";
import { ProviderRateLimiter } from "./person-sources/provider-http.js";
import type { ChineseBiographyMethod } from "./person-biography-quality.js";

interface NotionPeopleClient {
  dataSources: {
    query(input: Record<string, unknown>): Promise<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }>;
  };
  pages: {
    create(input: Record<string, unknown>): Promise<unknown>;
    update(input: Record<string, unknown>): Promise<unknown>;
    retrieve(input: Record<string, unknown>): Promise<unknown>;
  };
}

export interface ExistingPeopleValues {
  personId: string;
  lockedFields: PersonLockedField[];
  chineseName?: string;
  englishName?: string;
  originalName?: string;
  biographyZh?: string;
  biographyZhStatus?: "draft" | "partial" | "verified" | "conflict";
  biographyZhMethod?: ChineseBiographyMethod;
  biographyEn?: string;
  biographyEnStatus?: "draft" | "partial" | "verified" | "conflict";
  biographyEnMethod?: ChineseBiographyMethod;
  sources?: string;
  profileUrl?: string;
  hideFromWebsite?: boolean;
  developerMemo?: string;
}

export interface PeopleManagedValues extends ExistingPeopleValues {
  name: string;
  aliases: string;
  tmdbPersonId?: string;
  imdbNameId?: string;
  wikidataQid?: string;
  primaryDepartments: string[];
  birthDate?: string;
  deathDate?: string;
  birthPlace?: string;
  nameStatus: string;
  dataStatus: string;
  sources: string;
  lastEnrichedAt: string;
}

export interface NotionPeopleSnapshot extends ExistingPeopleValues {
  pageId: string;
  lastEditedTime: string;
  archived: boolean;
  name?: string;
  aliases: string[];
  externalIds: { tmdb?: string; imdb?: string; wikidata?: string };
  primaryDepartments: MovieCreditDepartment[];
  birthDate?: string;
  deathDate?: string;
  birthPlace?: string;
  nameStatus?: "verified" | "strong" | "provisional" | "conflict";
  dataStatus?: "draft" | "partial" | "verified" | "conflict";
}

export interface NotionPeopleInvalidSnapshot {
  pageId: string;
  lastEditedTime: string;
  archived: boolean;
  error: string;
}

export type NotionPeopleChange = NotionPeopleSnapshot | NotionPeopleInvalidSnapshot;

export function managedPeopleValues(profile: PersonProfile, existing?: ExistingPeopleValues): PeopleManagedValues {
  if (existing && existing.personId !== profile.personId) throw new Error("Person ID is immutable and cannot be changed.");
  const locked = new Set(existing?.lockedFields ?? []);
  const names = selectPersonDisplayNames(profile.names, {
    chinese: locked.has("chineseName") ? existing?.chineseName : undefined,
    english: locked.has("englishName") ? existing?.englishName : undefined,
    original: locked.has("originalName") ? existing?.originalName : undefined
  });
  const status = bestNameStatus(profile);
  const biographyTexts = selectPersonBiographyTexts(profile.biography);
  const selectedChineseBiography = (profile.biography?.texts ?? [])
    .filter((entry) => /^zh(?:-|$)/i.test(entry.language) && entry.value.trim() === biographyTexts.chinese)
    .sort((left, right) => biographyStatusRank(right.status) - biographyStatusRank(left.status))[0];
  const selectedEnglishBiography = (profile.biography?.texts ?? [])
    .filter((entry) => /^en(?:-|$)/i.test(entry.language) && entry.value.trim() === biographyTexts.english)
    .sort((left, right) => biographyStatusRank(right.status) - biographyStatusRank(left.status))[0];
  return {
    personId: profile.personId,
    name: names.primary ?? profile.personId,
    chineseName: locked.has("chineseName") ? existing?.chineseName : names.chinese,
    englishName: locked.has("englishName") ? existing?.englishName : names.english,
    originalName: locked.has("originalName") ? existing?.originalName : names.original,
    aliases: names.aliases.join(" / "),
    tmdbPersonId: profile.externalIds?.tmdb,
    imdbNameId: profile.externalIds?.imdb,
    wikidataQid: profile.externalIds?.wikidata,
    primaryDepartments: profile.departments ?? [],
    birthDate: profile.biography?.birthDate,
    deathDate: profile.biography?.deathDate,
    birthPlace: profile.biography?.birthPlace,
    biographyZh: locked.has("biographyZh") ? existing?.biographyZh : biographyTexts.chinese,
    biographyZhStatus: existing?.biographyZhStatus ?? biographyPublicationStatus(selectedChineseBiography?.status),
    biographyZhMethod: existing?.biographyZhMethod ?? selectedChineseBiography?.method,
    biographyEn: locked.has("biographyEn") ? existing?.biographyEn : biographyTexts.english,
    biographyEnStatus: existing?.biographyEnStatus ?? biographyPublicationStatus(selectedEnglishBiography?.status),
    biographyEnMethod: existing?.biographyEnMethod ?? selectedEnglishBiography?.method,
    profileUrl: locked.has("profileUrl") ? existing?.profileUrl : profile.profileImages?.[0]?.url,
    nameStatus: status,
    dataStatus: profile.dataQuality.status,
    sources: sharedSourceRefs(profile, existing?.sources).join("\n"),
    lastEnrichedAt: profile.updatedAt,
    lockedFields: [...locked],
    hideFromWebsite: existing?.hideFromWebsite ?? profile.hiddenFromWebsite ?? false,
    developerMemo: existing?.developerMemo
  };
}

export function notionPeopleProperties(values: PeopleManagedValues) {
  return {
    Name: title(values.name),
    "Person ID": richText(values.personId),
    "Chinese Name": richText(values.chineseName),
    "English Name": richText(values.englishName),
    "Original Name": richText(values.originalName),
    Aliases: richText(values.aliases),
    "TMDB Person ID": richText(values.tmdbPersonId),
    "IMDb Name ID": richText(values.imdbNameId),
    "Wikidata QID": richText(values.wikidataQid),
    "Primary Departments": { multi_select: values.primaryDepartments.map((name) => ({ name })) },
    "Birth Date": date(values.birthDate),
    "Death Date": date(values.deathDate),
    "Birth Place": richText(values.birthPlace),
    "Biography ZH": richText(values.biographyZh),
    "Biography ZH Status": { select: values.biographyZhStatus ? { name: values.biographyZhStatus } : null },
    "Biography ZH Method": { select: values.biographyZhMethod ? { name: values.biographyZhMethod } : null },
    "Biography EN": richText(values.biographyEn),
    "Biography EN Status": { select: values.biographyEnStatus ? { name: values.biographyEnStatus } : null },
    "Biography EN Method": { select: values.biographyEnMethod ? { name: values.biographyEnMethod } : null },
    "Profile URL": { url: values.profileUrl ?? null },
    "Name Status": { select: { name: values.nameStatus } },
    "Locked Fields": { multi_select: values.lockedFields.map((field) => ({ name: notionLockedField(field) })) },
    "Data Status": { select: { name: values.dataStatus } },
    Sources: sourceRichText(values.sources),
    "Last Enriched At": date(values.lastEnrichedAt),
    "Hide from Website": { checkbox: Boolean(values.hideFromWebsite) },
    "Developer Memo": richText(values.developerMemo)
  };
}

export function assertUniqueExternalIds(profiles: PersonProfile[]) {
  for (const source of ["tmdb", "imdb", "wikidata"] as const) {
    const seen = new Map<string, string>();
    for (const profile of profiles) {
      const id = profile.externalIds?.[source];
      if (!id) continue;
      const owner = seen.get(id);
      if (owner && owner !== profile.personId) throw new Error(`${source} person ID ${id} belongs to both ${owner} and ${profile.personId}.`);
      seen.set(id, profile.personId);
    }
  }
}

export type PeopleUpsertResult = {
  action: "created" | "updated" | "unchanged";
  pageId: string;
  values: PeopleManagedValues;
};

export class NotionPeopleSource {
  constructor(
    private readonly notion: NotionPeopleClient,
    private readonly dataSourceId: string,
    private readonly limiter = new ProviderRateLimiter(1_000)
  ) {
    if (!dataSourceId.trim()) throw new Error("NOTION_PEOPLE_DATA_SOURCE_ID is required.");
  }

  async upsert(profile: PersonProfile): Promise<PeopleUpsertResult> {
    const matches = await this.request(() => this.notion.dataSources.query({
      data_source_id: this.dataSourceId,
      filter: { property: "Person ID", rich_text: { equals: profile.personId } },
      page_size: 3
    }));
    if (matches.has_more || matches.results.length > 1) {
      throw new Error(`Duplicate Notion People rows found for immutable Person ID ${profile.personId}.`);
    }

    const existingPage = matches.results[0] as NotionPage | undefined;
    const existing = existingPage ? readExistingPeopleValues(existingPage) : undefined;
    const values = managedPeopleValues(profile, existing);
    const properties = notionPeopleProperties(values);
    if (existingPage && notionPropertiesEqual(existingPage.properties, properties)) {
      return { action: "unchanged", pageId: existingPage.id, values };
    }

    const written = existingPage
      ? await this.request(() => this.notion.pages.update({ page_id: existingPage.id, properties }))
      : await this.request(() => this.notion.pages.create({
        parent: { type: "data_source_id", data_source_id: this.dataSourceId },
        properties
      }));
    const pageId = pageIdOf(written);
    const readback = await this.request(() => this.notion.pages.retrieve({ page_id: pageId })) as NotionPage;
    const mismatches = notionPropertyMismatches(readback.properties, properties);
    if (mismatches.length) {
      throw new Error(`Notion People readback mismatch for ${profile.personId}: ${mismatches.join(", ")}.`);
    }
    return { action: existingPage ? "updated" : "created", pageId, values };
  }

  async listChanged(options: { since?: string; limit?: number; pageSize?: number } = {}) {
    const rows: NotionPeopleChange[] = [];
    const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 100));
    let cursor: string | undefined;
    do {
      const remaining = options.limit ? options.limit - rows.length : pageSize;
      if (remaining <= 0) break;
      const response = await this.request(() => this.notion.dataSources.query({
        data_source_id: this.dataSourceId,
        page_size: Math.min(pageSize, remaining),
        sorts: [{ timestamp: "last_edited_time", direction: "ascending" }],
        ...(options.since ? {
          filter: { timestamp: "last_edited_time", last_edited_time: { on_or_after: options.since } }
        } : {}),
        ...(cursor ? { start_cursor: cursor } : {})
      }));
      rows.push(...response.results.map((value) => {
        const page = value as NotionPage;
        try {
          return readNotionPeopleSnapshot(page);
        } catch (error) {
          return {
            pageId: page.id,
            lastEditedTime: page.last_edited_time ?? new Date(0).toISOString(),
            archived: Boolean(page.archived || page.in_trash),
            error: error instanceof Error ? error.message : String(error)
          } satisfies NotionPeopleInvalidSnapshot;
        }
      }));
      cursor = response.has_more && response.next_cursor ? response.next_cursor : undefined;
    } while (cursor && (!options.limit || rows.length < options.limit));
    return rows;
  }

  private request<T>(operation: () => Promise<T>) {
    return this.limiter.schedule(operation);
  }
}

interface NotionPage {
  id: string;
  last_edited_time?: string;
  archived?: boolean;
  in_trash?: boolean;
  properties: Record<string, unknown>;
}

export function readNotionPeopleSnapshot(page: NotionPage): NotionPeopleSnapshot {
  const existing = readExistingPeopleValues(page);
  return {
    ...existing,
    pageId: page.id,
    lastEditedTime: page.last_edited_time ?? new Date(0).toISOString(),
    archived: Boolean(page.archived || page.in_trash),
    name: plainText(page.properties.Name),
    aliases: splitAliases(plainText(page.properties.Aliases)),
    externalIds: {
      tmdb: plainText(page.properties["TMDB Person ID"]),
      imdb: plainText(page.properties["IMDb Name ID"]),
      wikidata: plainText(page.properties["Wikidata QID"])
    },
    primaryDepartments: multiSelectNames(page.properties["Primary Departments"]).filter(isCreditDepartment),
    birthDate: dateStart(page.properties["Birth Date"]),
    deathDate: dateStart(page.properties["Death Date"]),
    birthPlace: plainText(page.properties["Birth Place"]),
    nameStatus: nameStatus(page.properties["Name Status"]),
    dataStatus: dataStatus(page.properties["Data Status"])
  };
}

export function readExistingPeopleValues(page: NotionPage): ExistingPeopleValues {
  const personId = plainText(page.properties["Person ID"]);
  if (!personId) throw new Error(`Notion People row ${page.id} is missing immutable Person ID.`);
  return {
    personId,
    lockedFields: multiSelectNames(page.properties["Locked Fields"]).flatMap(runtimeLockedField),
    chineseName: plainText(page.properties["Chinese Name"]),
    englishName: plainText(page.properties["English Name"]),
    originalName: plainText(page.properties["Original Name"]),
    biographyZh: plainText(page.properties["Biography ZH"]),
    biographyZhStatus: biographyDataStatus(page.properties["Biography ZH Status"]),
    biographyZhMethod: biographyMethod(page.properties["Biography ZH Method"]),
    biographyEn: plainText(page.properties["Biography EN"]),
    biographyEnStatus: biographyDataStatus(page.properties["Biography EN Status"]),
    biographyEnMethod: biographyMethod(page.properties["Biography EN Method"]),
    sources: plainText(page.properties.Sources),
    profileUrl: propertyObject(page.properties["Profile URL"]).url as string | undefined,
    hideFromWebsite: Boolean(propertyObject(page.properties["Hide from Website"]).checkbox),
    developerMemo: plainText(page.properties["Developer Memo"])
  };
}

export function notionPropertiesEqual(current: Record<string, unknown>, desired: Record<string, unknown>) {
  return notionPropertyMismatches(current, desired).length === 0;
}

export function notionPropertyMismatches(current: Record<string, unknown>, desired: Record<string, unknown>) {
  return Object.entries(desired)
    .filter(([name, value]) => JSON.stringify(comparableProperty(current[name])) !== JSON.stringify(comparableProperty(value)))
    .map(([name]) => name);
}

function bestNameStatus(profile: PersonProfile) {
  const statuses = profile.names.map((entry) => entry.status);
  if (statuses.includes("verified")) return "verified";
  if (statuses.includes("strong")) return "strong";
  if (statuses.includes("conflict")) return "conflict";
  return "provisional";
}

function notionLockedField(field: PersonLockedField) {
  const labels: Record<PersonLockedField, string> = {
    chineseName: "Chinese Name",
    englishName: "English Name",
    originalName: "Original Name",
    biographyZh: "Biography ZH",
    biographyEn: "Biography EN",
    profileUrl: "Profile URL"
  };
  return labels[field];
}

function runtimeLockedField(value: string): PersonLockedField[] {
  const fields: Record<string, PersonLockedField> = {
    "Chinese Name": "chineseName",
    "English Name": "englishName",
    "Original Name": "originalName",
    "Biography ZH": "biographyZh",
    "Biography EN": "biographyEn",
    "Profile URL": "profileUrl"
  };
  return fields[value] ? [fields[value]] : [];
}

function pageIdOf(value: unknown) {
  const id = (value as { id?: string })?.id;
  if (!id) throw new Error("Notion People write did not return a page ID.");
  return id;
}

function propertyObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function plainText(value: unknown) {
  const property = propertyObject(value);
  const items = (property.rich_text ?? property.title) as Array<Record<string, unknown>> | undefined;
  const text = (items ?? []).map((item) => typeof item.plain_text === "string"
    ? item.plain_text
    : propertyObject(item.text).content as string | undefined).filter(Boolean).join("").trim();
  return text || undefined;
}

function multiSelectNames(value: unknown) {
  const items = propertyObject(value).multi_select as Array<{ name?: string }> | undefined;
  return (items ?? []).map((item) => item.name?.trim()).filter((name): name is string => Boolean(name));
}

function dateStart(value: unknown) {
  return (propertyObject(value).date as { start?: string } | null)?.start;
}

function selectName(value: unknown) {
  return (propertyObject(value).select as { name?: string } | null)?.name;
}

function nameStatus(value: unknown): NotionPeopleSnapshot["nameStatus"] {
  const valueName = selectName(value);
  return ["verified", "strong", "provisional", "conflict"].includes(valueName ?? "")
    ? valueName as NotionPeopleSnapshot["nameStatus"]
    : undefined;
}

function dataStatus(value: unknown): NotionPeopleSnapshot["dataStatus"] {
  const valueName = selectName(value);
  return ["draft", "partial", "verified", "conflict"].includes(valueName ?? "")
    ? valueName as NotionPeopleSnapshot["dataStatus"]
    : undefined;
}

function biographyDataStatus(value: unknown): ExistingPeopleValues["biographyZhStatus"] {
  const valueName = selectName(value);
  return ["draft", "partial", "verified", "conflict"].includes(valueName ?? "")
    ? valueName as ExistingPeopleValues["biographyZhStatus"]
    : undefined;
}

function biographyStatusRank(status?: string) {
  return ({ verified: 4, strong: 3, provisional: 2, conflict: 1, rejected: 0 } as Record<string, number>)[status ?? ""] ?? 0;
}

function biographyPublicationStatus(status?: string): ExistingPeopleValues["biographyZhStatus"] {
  if (status === "verified") return "verified";
  if (status === "conflict") return "conflict";
  return status ? "partial" : undefined;
}

function biographyMethod(value: unknown): ChineseBiographyMethod | undefined {
  const valueName = selectName(value);
  return ["source-summary", "editorial-rewrite", "machine-translation", "source-excerpt"].includes(valueName ?? "")
    ? valueName as ChineseBiographyMethod
    : undefined;
}

function splitAliases(value?: string) {
  return (value ?? "").split(/\s+\/\s+/).map((entry) => entry.trim()).filter(Boolean);
}

function isCreditDepartment(value: string): value is MovieCreditDepartment {
  return new Set<string>([
    "directing", "writing", "acting", "production", "camera", "music", "editing", "art", "sound",
    "visual_effects", "costume", "makeup", "crew", "other"
  ]).has(value);
}

function comparableProperty(value: unknown): unknown {
  const property = propertyObject(value);
  if ("title" in property || "rich_text" in property) return { text: plainText(property) ?? "" };
  if ("multi_select" in property) return { multiSelect: multiSelectNames(property).sort() };
  if ("select" in property) return { select: (property.select as { name?: string } | null)?.name ?? null };
  if ("date" in property) {
    const start = (property.date as { start?: string } | null)?.start;
    const normalized = start?.includes("T") && Number.isFinite(Date.parse(start))
      ? new Date(Math.floor(new Date(start).getTime() / 60_000) * 60_000).toISOString()
      : start;
    return { date: normalized ?? null };
  }
  if ("url" in property) return { url: property.url ?? null };
  if ("checkbox" in property) return { checkbox: Boolean(property.checkbox) };
  return property;
}

function richText(value?: string) {
  return { rich_text: value ? [{ type: "text", text: { content: value.slice(0, 2_000) } }] : [] };
}

function sourceRichText(value?: string) {
  const values = (value ?? "").split(/[;\n]+/u).map((entry) => entry.trim()).filter(Boolean);
  return {
    rich_text: values.flatMap((entry, index) => [
      ...(index ? [{ type: "text" as const, text: { content: "\n" } }] : []),
      {
        type: "text" as const,
        text: {
          content: entry.slice(0, 2_000),
          ...(/^https?:\/\//iu.test(entry) ? { link: { url: entry } } : {})
        }
      }
    ])
  };
}

function sharedSourceRefs(profile: PersonProfile, existing?: string) {
  const values = [
    ...(existing ?? "").split(/[;\n]+/u),
    ...(profile.sourceRefs ?? []).map((ref) => ref.url ?? [ref.source, ref.id].filter(Boolean).join(":")),
    ...(profile.biography?.texts ?? []).flatMap((text) => text.supportingSourceRefs ?? [])
  ].map((value) => value.trim()).filter(Boolean);
  return [...new Set(values)];
}

function title(value: string) {
  return { title: [{ type: "text", text: { content: value.slice(0, 2_000) } }] };
}

function date(value?: string) {
  return { date: value ? { start: value } : null };
}
