import { randomUUID } from "node:crypto";
import type { CollectionDocumentStore } from "@wwpdw/cache-store";
import { CollectionConflict } from "@wwpdw/cache-store";
import { collectionDoubanId, collectionStatus, parseDoubanImport } from "@wwpdw/shared";
import type { CollectionPreview, CollectionPreviewRow, CollectionResponse, DoubanRecord, ImportStrategy, MemberCollectionEntry as Entry, SearchResult } from "@wwpdw/shared";

interface Document extends CollectionResponse {
  undo?: { id: string; revision: string; entries: Entry[] };
  lastImportId?: string;
}
interface Pending {
  preview: CollectionPreview;
  baseRevision: string;
  entries: Entry[];
}
const entryId = (entry: Entry) => entry.doubanImport?.subjectId ?? collectionDoubanId(entry.result) ?? entry.assetKey;
const stamp = (entry: Entry) => entry.watchedAt ?? entry.watchingAt ?? entry.wantToWatchAt ?? entry.favoriteAt;
const statusFromDouban = (record: DoubanRecord) => record.status === "wish" ? "wantToWatch" : record.status === "do" ? "watching" : "watched";
const hasValue = (value: unknown) => value !== null && value !== undefined && value !== "";

function catalogMap(catalog: SearchResult[]) {
  const map = new Map<string, SearchResult[]>();
  for (const result of catalog) {
    const id = collectionDoubanId(result);
    if (!id) continue;
    const list = map.get(id) ?? [];
    if (!list.some(item => item.assetKey === result.assetKey)) list.push(result);
    map.set(id, list);
  }
  return map;
}
function bind(entry: Entry, index: Map<string, SearchResult[]>) {
  const matches = index.get(entryId(entry)) ?? [];
  const result = matches.find(item => item.assetKey === entry.assetKey) ?? (matches.length === 1 ? matches[0] : undefined);
  return result ? { ...entry, assetKey: result.assetKey, result } : entry;
}
function fromRecord(record: DoubanRecord): Entry {
  const now = new Date().toISOString();
  return {
    assetKey: `douban:${record.subjectId}`, title: record.title, addedAt: now, doubanImport: record,
    [statusFromDouban(record) + "At"]: record.markedAt || now,
    result: { assetKey: `douban:${record.subjectId}`, title: record.title, source: "douban", sourceUrl: `https://movie.douban.com/subject/${record.subjectId}/`, durationLabel: "", updatedAt: record.markedAt, summary: record.info, metadata: { externalIds: { douban: record.subjectId } } }
  };
}
function mergeEntry(previous: Entry, incoming: Entry, strategy: ImportStrategy): Entry {
  if (strategy === "replace") return incoming;
  const preferred = strategy === "site" ? previous : incoming;
  const fallback = strategy === "site" ? incoming : previous;
  const record = { ...fallback.doubanImport, ...preferred.doubanImport } as DoubanRecord;
  for (const key of ["rating", "comment", "tags", "originalTitle", "info"] as const) {
    (record as unknown as Record<string, unknown>)[key] = hasValue(preferred.doubanImport?.[key]) ? preferred.doubanImport![key] : fallback.doubanImport?.[key];
  }
  // Status and its date are one unit; an unknown preferred date remains unknown.
  const status = collectionStatus(preferred) ?? collectionStatus(fallback)!;
  record.status = status === "wantToWatch" ? "wish" : status === "watching" ? "do" : "collect";
  record.markedAt = preferred.doubanImport?.markedAt ?? stamp(preferred)?.slice(0, 10) ?? "";
  return { ...previous, favoriteAt: undefined, wantToWatchAt: undefined, watchingAt: undefined, watchedAt: undefined,
    [status + "At"]: stamp(preferred) ?? stamp(fallback), doubanImport: record };
}
function changedFields(before: Entry, after: Entry) {
  const fields: string[] = [];
  if (collectionStatus(before) !== collectionStatus(after)) fields.push("观看状态");
  if ((before.doubanImport?.markedAt ?? stamp(before)) !== (after.doubanImport?.markedAt ?? stamp(after))) fields.push("标记日期");
  for (const [key, label] of [["rating", "个人评分"], ["comment", "短评"], ["tags", "标签"]] as const) {
    if ((before.doubanImport?.[key] ?? "") !== (after.doubanImport?.[key] ?? "")) fields.push(label);
  }
  return fields;
}

export function buildCollectionPlan(records: DoubanRecord[], current: Entry[], catalog: SearchResult[], strategy: ImportStrategy) {
  const index = catalogMap(catalog);
  const unique = new Map<string, DoubanRecord>();
  for (const record of records) {
    const prior = unique.get(record.subjectId);
    if (!prior || record.markedAt >= prior.markedAt) unique.set(record.subjectId, record);
  }
  const old = new Map(current.map(entry => [entryId(entry), entry]));
  const next = strategy === "replace" ? new Map<string, Entry>() : new Map(old);
  const rows: CollectionPreviewRow[] = [];
  for (const [id, record] of unique) {
    const previous = old.get(id);
    const incoming = fromRecord(record);
    const entry = bind(previous ? mergeEntry(previous, incoming, strategy) : incoming, index);
    next.set(id, entry);
    const fields = previous ? changedFields(previous, entry) : [];
    const matches = index.get(id) ?? [];
    const changes = previous ? ([['rating','个人评分'],['comment','短评'],['tags','标签'],['markedAt','标记日期']] as const).flatMap(([key,field])=> {
      const before=String(previous.doubanImport?.[key] ?? "");const after=String(entry.doubanImport?.[key] ?? "");
      return before===after ? [] : [{field,before,after}];
    }) : [];
    rows.push({ subjectId: id, title: record.title, action: previous ? fields.length ? "修改" : "保留" : "新增", match: matches.length === 1 ? "已匹配" : matches.length ? "多个候选" : "未匹配", before: previous && collectionStatus(previous), after: collectionStatus(entry), fields, changes });
  }
  for (const [id, entry] of old) if (!unique.has(id)) {
    rows.push({ subjectId: id, title: entry.title, action: strategy === "replace" ? "移除" : "保留", match: index.has(id) ? "已匹配" : "未匹配", before: collectionStatus(entry), after: strategy === "replace" ? undefined : collectionStatus(entry), fields: [] });
  }
  return { entries: [...next.values()].map(entry => bind(entry, index)), rows, duplicates: records.length - unique.size };
}

export class MemberCollectionService {
  constructor(private readonly store: CollectionDocumentStore, private readonly catalog: () => Promise<SearchResult[]>) {}
  private key(owner: string) { return `collection:${owner}`; }
  private async document(owner: string) {
    const stored = await this.store.read<Document>(this.key(owner));
    return { value: stored?.value ?? { entries: [], revision: "0" }, etag: stored?.etag };
  }
  async get(owner: string): Promise<CollectionResponse> {
    const { value } = await this.document(owner);
    const index = catalogMap(await this.catalog());
    return { entries: value.entries.map(entry => bind(entry, index)), revision: value.revision, undoImportId: value.undo?.revision === value.revision ? value.undo.id : undefined };
  }
  async preview(owner: string, data: unknown, strategy: ImportStrategy): Promise<CollectionPreview> {
    if (!["replace", "douban", "site"].includes(strategy)) throw new Error("请选择有效的导入策略。");
    const records = parseDoubanImport(data);
    const { value } = await this.document(owner);
    const catalog = await this.catalog();
    const plan = buildCollectionPlan(records, value.entries, catalog, strategy);
    const preview: CollectionPreview = { id: randomUUID(), strategy, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(), rows: plan.rows, duplicates: plan.duplicates, total: plan.entries.length, catalogCount: catalog.length, dateFiltered: Boolean((data as { dateFilter?: unknown }).dateFilter) };
    // One expiring preview per account avoids accumulating uploaded private files.
    const key = `preview:${owner}`;
    const prior = await this.store.read<Pending>(key);
    await this.store.write(key, { preview, baseRevision: value.revision, entries: plan.entries } satisfies Pending, prior?.etag);
    return preview;
  }
  async commit(owner: string, id: string, confirmReplace: boolean) {
    const current = await this.document(owner);
    if (current.value.lastImportId === id) return this.get(owner);
    const pending = (await this.store.read<Pending>(`preview:${owner}`))?.value;
    if (!pending || pending.preview.id !== id || Date.parse(pending.preview.expiresAt) < Date.now()) throw new CollectionConflict("预览已过期，请重新上传并预览。");
    if (pending.baseRevision !== current.value.revision) throw new CollectionConflict("片单已变化，请重新预览，避免覆盖其他设备的修改。");
    if (pending.preview.strategy === "replace" && !confirmReplace) throw new Error("请确认完整替换个人片单。");
    const revision = randomUUID();
    await this.store.write(this.key(owner), { entries: pending.entries, revision, lastImportId: id, undo: { id, revision, entries: current.value.entries } } satisfies Document, current.etag);
    return this.get(owner);
  }
  async undo(owner: string, id: string, revision: string) {
    const current = await this.document(owner);
    if (current.value.revision !== revision || current.value.undo?.id !== id || current.value.undo.revision !== revision) throw new CollectionConflict("导入后片单已有修改，不能直接撤销。");
    await this.store.write(this.key(owner), { entries: current.value.undo.entries, revision: randomUUID() }, current.etag);
    return this.get(owner);
  }
  async mark(owner: string, assetKey: string, mark: string, active: boolean, revision: string) {
    if (!["wantToWatch", "watching", "watched"].includes(mark) || typeof active !== "boolean") throw new Error("观看状态无效。");
    const current = await this.document(owner);
    if (revision !== current.value.revision) throw new CollectionConflict("片单已变化，请刷新后重试。");
    const catalog = await this.catalog();
    const result = catalog.find(item => item.assetKey === assetKey);
    const id = result && collectionDoubanId(result);
    const previous = current.value.entries.find(entry => entry.assetKey === assetKey || (id && entryId(entry) === id));
    if (!previous && !result) throw new Error("未找到影片。");
    const target = result ?? previous!.result;
    const kind = target.metadata?.work?.kind ?? target.metadata?.kind;
    if (active && mark === "watching" && !["series", "season", "episode"].includes(kind ?? "") && !/tv|series|season|电视|剧集|影集/i.test(target.metadata?.type ?? "") && previous?.doubanImport?.status !== "do") throw new Error("只有电视剧支持在看状态。");
    let entries = current.value.entries.filter(entry => entry !== previous);
    if (active) {
      const now = new Date().toISOString();
      const record = previous?.doubanImport;
      entries.push({ ...previous, assetKey: target.assetKey, title: target.title, result: target, addedAt: previous?.addedAt ?? now, favoriteAt: undefined, wantToWatchAt: undefined, watchingAt: undefined, watchedAt: undefined, [mark + "At"]: now,
        doubanImport: record ? { ...record, status: mark === "wantToWatch" ? "wish" : mark === "watching" ? "do" : "collect", markedAt: now.slice(0,10) } : undefined });
    } else if (previous && collectionStatus(previous) !== mark) entries.push(previous);
    await this.store.write(this.key(owner), { entries, revision: randomUUID() }, current.etag);
    return this.get(owner);
  }
}
