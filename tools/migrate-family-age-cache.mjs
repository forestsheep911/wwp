import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { migrateAdultTheme } from "../apps/api/src/notion-adult-theme-migration.ts";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const files = args.filter((arg) => !arg.startsWith("--"));
if (files.length === 0) throw new Error("Provide one or more explicit JSON files.");

function migrateNode(value, stats) {
  if (Array.isArray(value)) {
    for (const item of value) migrateNode(item, stats);
    return;
  }
  if (!value || typeof value !== "object") return;

  const metadata = value.metadata;
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const tags = Array.isArray(metadata.contentRiskTags) ? metadata.contentRiskTags : [];
    const reason = typeof metadata.aiAgeReason === "string" ? metadata.aiAgeReason : "";
    if (tags.includes("成人主题") || /(?:成人主题|成人内容|成人向|成熟主题|少儿不宜|不适合未成年人)/u.test(reason)) {
      const migrated = migrateAdultTheme(tags, reason);
      metadata.contentRiskTags = migrated.tags;
      metadata.aiAgeReason = migrated.reason;
      stats.updated += 1;
    }
  }

  for (const child of Object.values(value)) migrateNode(child, stats);
}

const reports = [];
for (const file of files) {
  const resolved = path.resolve(file);
  const parsed = JSON.parse(await readFile(resolved, "utf8"));
  const stats = { updated: 0 };
  migrateNode(parsed, stats);
  if (apply && stats.updated > 0) await writeFile(resolved, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  reports.push({ file: resolved, mode: apply ? "apply" : "dry-run", ...stats });
}

console.log(JSON.stringify(reports, null, 2));
