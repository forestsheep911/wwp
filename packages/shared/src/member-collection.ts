import type { SearchResult } from "./index.js";
export interface DoubanRecord {
  status: "wish" | "do" | "collect";
  subjectId: string;
  title: string;
  originalTitle: string;
  info: string;
  markedAt: string;
  rating: number | null;
  tags: string;
  comment: string;
}
export function parseDoubanImport(data: unknown): DoubanRecord[] {
  const input = data as { records?: unknown[] };
  if (!input || !Array.isArray(input.records) || !input.records.length) throw new Error("文件必须包含非空 records 数组，请选择纳豆导出的 JSON。");
  if (input.records.length > 20000) throw new Error("单次最多导入 20,000 条记录。");
  return input.records.map((r: any, index: number) => {
    if (!r || !["wish", "do", "collect"].includes(r.status) || typeof r.subjectId !== "string" || !/^\d+$/.test(r.subjectId) || typeof r.title !== "string" || !r.title.trim()) throw new Error(`第 ${index + 1} 条记录的状态、影片 ID 或片名无效。`);
    if (r.markedAt !== "" && (typeof r.markedAt !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.markedAt) || !Number.isFinite(Date.parse(r.markedAt)) || new Date(r.markedAt).toISOString().slice(0,10) !== r.markedAt)) throw new Error(`第 ${index + 1} 条记录的标记日期无效。`);
    if (r.rating != null && ![2,4,6,8,10].includes(r.rating)) throw new Error(`第 ${index + 1} 条记录的个人评分无效。`);
    const str = (key: string) => typeof r[key] === "string" ? r[key] : "";
    return {status:r.status, subjectId:r.subjectId, title:r.title, originalTitle:str("originalTitle"), info:str("info"), markedAt:r.markedAt, rating:r.rating ?? null, tags:str("tags"), comment:str("comment")};
  });
}

export type CollectionStatus = "wantToWatch" | "watching" | "watched";
export type ImportStrategy = "replace" | "douban" | "site";
export interface MemberCollectionEntry {
  assetKey: string;
  title: string;
  addedAt: string;
  favoriteAt?: string;
  wantToWatchAt?: string;
  watchingAt?: string;
  watchedAt?: string;
  result: SearchResult;
  doubanImport?: DoubanRecord;
}
export interface CollectionResponse {
  entries: MemberCollectionEntry[];
  revision: string;
  undoImportId?: string;
}
export interface CollectionPreviewRow {
  subjectId: string;
  title: string;
  action: "新增" | "修改" | "保留" | "移除";
  match: "已匹配" | "未匹配" | "多个候选";
  before?: CollectionStatus;
  after?: CollectionStatus;
  fields: string[];
  changes?: Array<{field:string;before:string;after:string}>;
}
export interface CollectionPreview {
  id: string;
  strategy: ImportStrategy;
  expiresAt: string;
  rows: CollectionPreviewRow[];
  duplicates: number;
  total: number;
  catalogCount: number;
  dateFiltered: boolean;
}
export function collectionStatus(entry: MemberCollectionEntry): CollectionStatus | undefined {
  return entry.watchedAt ? "watched" : entry.watchingAt ? "watching" : entry.wantToWatchAt || entry.favoriteAt ? "wantToWatch" : undefined;
}
export function collectionDoubanId(result: SearchResult) {
  const raw = result.metadata?.work?.externalIds?.douban ?? result.metadata?.externalIds?.douban;
  if (raw && /^\d+$/.test(raw)) return raw;
  return (raw ?? (result.source === "douban" ? result.sourceUrl : "")).match(/^https?:\/\/movie\.douban\.com\/subject\/(\d+)(?:\/|$)/)?.[1];
}
