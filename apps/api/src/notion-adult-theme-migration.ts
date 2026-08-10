import "./env.js";
import { mkdir, writeFile } from "node:fs/promises";
import dns from "node:dns";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";

type JsonRecord = Record<string, unknown>;

const dataSourceId = process.env.NOTION_LIBRARY_DATA_SOURCE_ID ?? process.env.NOTION_DATA_SOURCE_ID;
const requestTimeoutMs = Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 30000);

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(operation: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(500 * (2 ** (attempt - 1)));
    }
  }
  throw lastError;
}

function richTextPlain(value: unknown) {
  return asArray(value).map((item) => asString(asRecord(item)?.plain_text)).filter(Boolean).join("");
}

function propertyText(property: unknown) {
  const record = asRecord(property);
  if (!record) return "";
  if (record.type === "title" || record.type === "rich_text") return richTextPlain(record[asString(record.type)]);
  return "";
}

function titleFromProperties(properties: JsonRecord) {
  for (const property of Object.values(properties)) {
    const record = asRecord(property);
    if (record?.type === "title") return richTextPlain(record.title) || "Untitled Notion page";
  }
  return "Untitled Notion page";
}

function tagsFromProperties(properties: JsonRecord) {
  const property = asRecord(properties["内容风险标签"]);
  return asArray(property?.multi_select).map((item) => asString(asRecord(item)?.name)).filter(Boolean);
}

export function migrateAdultTheme(tags: string[], reason: string) {
  const nextTags = tags.filter((tag) => tag !== "成人主题");
  const concreteCrime = /(?:谋杀|绑架|勒索|黑帮|有组织犯罪|犯罪活动|贩毒|毒枭|抢劫|盗窃|诈骗|连环杀手)/u.test(reason);
  const concreteBereavement = /(?:丧亲|丧子|丧偶|葬礼|哀悼|失去.{0,8}(?:父母|亲人|孩子|子女|伴侣|家人)|亲人.{0,8}(?:去世|离世|死亡)|死亡(?:是|作为|构成|成为).{0,8}(?:核心|主题)|围绕.{0,8}(?:死亡|丧失|哀伤))/u.test(reason);
  if (concreteCrime && !nextTags.includes("犯罪")) nextTags.push("犯罪");
  if (concreteBereavement && !nextTags.includes("死亡/丧亲")) nextTags.push("死亡/丧亲");

  const nextReason = reason
    .replace(/\bexplicit\b/giu, "明确的")
    .replace(/((?:涉及|包含|探讨|聚焦|呈现|核心探讨))([^，。；]{1,60})等(?:较|较为|复杂|沉重|较沉重|较深|需一定理解力的)*的?成人主题/gu, "$1$2等议题，需要一定理解能力")
    .replace(/属(?:较|较为|复杂|沉重|较沉重|较深)*的?成人主题/gu, "相关议题需要一定理解能力")
    .replace(/等(?:较|较为|复杂|沉重|较沉重|较深|需一定理解力的)*的?成人主题/gu, "等议题，需要一定理解能力")
    .replace(/(?:较|较为|复杂|沉重|较沉重|较深)*的?成人主题/gu, "相关议题")
    .replace(/成人向/gu, "")
    .replace(/成人情感关系/gu, "复杂情感关系")
    .replace(/成人情感/gu, "复杂情感")
    .replace(/复杂成人关系/gu, "复杂亲密关系")
    .replace(/成人间/gu, "成年人之间")
    .replace(/成人亲密/gu, "亲密")
    .replace(/成人社交/gu, "复杂社交")
    .replace(/成人电影演员/gu, "色情影片演员")
    .replace(/成人政治社会议题/gu, "政治与社会议题")
    .replace(/成人政治主题/gu, "政治议题")
    .replace(/成人政治/gu, "政治")
    .replace(/成人社会议题/gu, "复杂社会议题")
    .replace(/成人阶层/gu, "社会阶层")
    .replace(/成人幽默/gu, "含性暗示的幽默")
    .replace(/针对成人的科学幽默/gu, "需要较多背景知识的科学幽默")
    .replace(/成人爱情关系/gu, "爱情关系")
    .replace(/成人恋爱关系/gu, "恋爱关系")
    .replace(/成人关系/gu, "亲密关系")
    .replace(/成人价值观/gu, "婚恋价值观")
    .replace(/成人道德/gu, "复杂道德")
    .replace(/成人伦理/gu, "复杂伦理")
    .replace(/成人哲学主题/gu, "哲学议题")
    .replace(/成人叙事/gu, "复杂叙事")
    .replace(/成人情节/gu, "复杂情节")
    .replace(/成人犯罪主题/gu, "犯罪主题")
    .replace(/成人健康危机/gu, "严重健康危机")
    .replace(/成人身份认同/gu, "职业与自我身份认同")
    .replace(/成人生活/gu, "现实生活")
    .replace(/成人浪漫暗示/gu, "浪漫与性暗示")
    .replace(/成人危险/gu, "高风险")
    .replace(/成人内涵/gu, "沉重内涵")
    .replace(/成人级历史议题/gu, "沉重历史议题")
    .replace(/成人观众/gu, "18岁以上观众")
    .replace(/成人心理/gu, "高强度心理")
    .replace(/成人社会/gu, "复杂社会")
    .replace(/成人职场/gu, "职场")
    .replace(/成人信任/gu, "人际信任")
    .replace(/成人对话/gu, "含性暗示或粗俗内容的对话")
    .replace(/成人化叙事/gu, "复杂叙事")
    .replace(/成人化生存困境/gu, "严峻的生存困境")
    .replace(/成人化幽默/gu, "含性暗示的幽默")
    .replace(/成人化调侃/gu, "含性暗示的调侃")
    .replace(/成人化的/gu, "复杂的")
    .replace(/高度成人化/gu, "涉及高强度内容")
    .replace(/主题偏成人化/gu, "主题较沉重")
    .replace(/主题较成人化/gu, "主题需要较高理解力")
    .replace(/成人导向/gu, "面向较高年龄层")
    .replace(/成人隐喻/gu, "性或社会隐喻")
    .replace(/成人世界/gu, "成年人世界")
    .replace(/儿童与成人/gu, "儿童与成年人")
    .replace(/仅限成人观看/gu, "仅建议18岁以上观众观看")
    .replace(/成人议题/gu, "复杂议题")
    .replace(/成人主题/gu, "复杂议题")
    .replace(/成人欺诈/gu, "欺诈")
    .replace(/无([^。；]{0,30})成人内容/gu, "无$1性或裸露内容")
    .replace(/成人内容/gu, "性或裸露内容")
    .replace(/成熟主题/gu, "复杂议题")
    .replace(/少儿不宜/gu, "可能不适合低龄儿童")
    .replace(/不适合未成年人独立观看/gu, "可能给低龄观众造成较强心理压力")
    .replace(/不适合未成年人/gu, "可能给低龄观众造成较强心理压力")
    .replace(/不适(?:于|宜)未成年人/gu, "可能给低龄观众造成较强心理压力")
    .replace(/需一定理解力的相关议题/gu, "需要一定理解能力的议题")
    .replace(/相关议题，需要一定理解能力，需要一定理解能力/gu, "相关议题，需要一定理解能力")
    .replace(/复杂复杂议题/gu, "复杂议题")
    .replace(/属典型相关议题/gu, "相关内容具体且贯穿核心情节")
    .replace(/无\s+明确的\s+/gu, "无明确的")
    .replace(/明确性或裸露/gu, "明确的性或裸露")
    .replace(/或性或裸露/gu, "、性或裸露")
    .replace(/复杂相关叙事/gu, "复杂叙事")
    .replace(/，{2,}/gu, "，")
    .trim();

  return { tags: nextTags, reason: nextReason };
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

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const value = (name: string, fallback: string) => {
    const inline = args.find((arg) => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? fallback : fallback;
  };
  const limit = Math.max(1, Number(value("--limit", "2000")));
  const concurrency = Math.min(8, Math.max(1, Number(value("--concurrency", "4"))));
  const batchDelayMs = Math.max(0, Number(value("--batch-delay-ms", "400")));
  const reportPath = value("--report", ".local-data/notion-adult-theme-migration.json");
  const includeAmbiguousReasons = args.includes("--include-ambiguous-reasons");
  const token = apply
    ? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN
    : process.env.NOTION_READ_ONLY_TOKEN ?? process.env.NOTION_WRITE_TOKEN ?? process.env.NOTION_TOKEN;
  if (!token) throw new Error("Set a Notion token before migrating adult-theme data.");
  if (!dataSourceId) throw new Error("Set NOTION_LIBRARY_DATA_SOURCE_ID or NOTION_DATA_SOURCE_ID.");

  installNotionDnsOverride();
  const notion = new Client({ auth: token, timeoutMs: requestTimeoutMs });
  const pages: JsonRecord[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      page_size: Math.min(100, limit - pages.length),
      start_cursor: cursor,
      filter: includeAmbiguousReasons
        ? {
            or: [
              { property: "内容风险标签", multi_select: { contains: "成人主题" } },
              { property: "AI年龄建议理由", rich_text: { contains: "成人" } },
              { property: "AI年龄建议理由", rich_text: { contains: "成熟主题" } },
              { property: "AI年龄建议理由", rich_text: { contains: "少儿不宜" } },
              { property: "AI年龄建议理由", rich_text: { contains: "不适合未成年人" } }
            ]
          }
        : { property: "内容风险标签", multi_select: { contains: "成人主题" } }
    } as never);
    pages.push(...response.results.map((page) => page as unknown as JsonRecord));
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor && pages.length < limit);

  const plans = pages.map((page) => {
    const properties = asRecord(page.properties) ?? {};
    const beforeTags = tagsFromProperties(properties);
    const beforeReason = propertyText(properties["AI年龄建议理由"]);
    const next = migrateAdultTheme(beforeTags, beforeReason);
    return {
      pageId: asString(page.id),
      title: titleFromProperties(properties),
      beforeTags,
      afterTags: next.tags,
      beforeReason,
      afterReason: next.reason,
      addedTags: next.tags.filter((tag) => !beforeTags.includes(tag))
    };
  });

  let applied = 0;
  if (apply) {
    for (let index = 0; index < plans.length; index += concurrency) {
      const batch = plans.slice(index, index + concurrency);
      await Promise.all(batch.map(async (plan) => {
        await withRetry(() => notion.pages.update({
          page_id: plan.pageId,
          properties: {
            "内容风险标签": { multi_select: plan.afterTags.map((name) => ({ name })) },
            ...(plan.afterReason !== plan.beforeReason
              ? { "AI年龄建议理由": { rich_text: [{ type: "text", text: { content: plan.afterReason } }] } }
              : {})
          }
        } as never));
        applied += 1;
      }));
      if (index + concurrency < plans.length && batchDelayMs > 0) await sleep(batchDelayMs);
    }
  }

  const report = {
    mode: apply ? "apply" : "dry-run",
    dataSourceId,
    includeAmbiguousReasons,
    scanned: pages.length,
    planned: plans.length,
    applied,
    reasonsChanged: plans.filter((plan) => plan.beforeReason !== plan.afterReason).length,
    addedCrime: plans.filter((plan) => plan.addedTags.includes("犯罪")).length,
    addedBereavement: plans.filter((plan) => plan.addedTags.includes("死亡/丧亲")).length,
    emptyReasons: plans.filter((plan) => !plan.afterReason).map((plan) => ({ pageId: plan.pageId, title: plan.title })),
    allPlans: includeAmbiguousReasons ? plans : undefined,
    changes: plans.filter((plan) => plan.beforeReason !== plan.afterReason || plan.addedTags.length > 0),
    sample: plans.slice(0, 30)
  };
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ ...report, allPlans: includeAmbiguousReasons ? `${plans.length} entries in report` : undefined, changes: `${report.changes.length} entries in report`, sample: report.sample.slice(0, 5) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
