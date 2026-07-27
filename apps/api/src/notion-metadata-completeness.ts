export const coreMetadataFields = [
  "Simplified Chinese Title",
  "Release Year",
  "上映日期",
  "Countries",
  "Languages",
  "旨趣",
  "外部类型原文",
  "Runtime Minutes",
  "Directors",
  "Cast",
  "Poster URL",
  "AI建议最低年龄",
  "AI年龄建议置信度",
  "内容风险标签",
  "AI年龄建议理由"
] as const;

export const optionalMetadataFields = [
  "Douban Subject ID",
  "TMDB ID",
  "Traditional Chinese Title (Taiwan)",
  "Traditional Chinese Title (Hong Kong)",
  "未映射类型",
  "Writers",
  "分级",
  "IMDB评分",
  "Metascore",
  "烂番茄新鲜度",
  "Box Office",
  "Box Office Amount",
  "Box Office Currency",
  "人工年龄覆盖"
] as const;

export function deriveMetadataCompleteness(input: {
  hasExternalId: boolean;
  conflicts: string[];
  values: Record<string, string>;
}) {
  const missingCoreFields = coreMetadataFields.filter((field) => !input.values[field]?.trim());
  const unresolvedIssues = ["Human Issue", "AI Issue"].filter((field) => input.values[field]?.trim());
  const status = input.conflicts.length > 0
    ? "conflict"
    : input.hasExternalId && missingCoreFields.length === 0 && unresolvedIssues.length === 0
      ? "verified"
      : input.hasExternalId
        ? "partial"
        : "draft";
  return { status, missingCoreFields, unresolvedIssues };
}
