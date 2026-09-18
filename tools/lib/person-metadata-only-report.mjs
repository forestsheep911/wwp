const NOTION_PAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORK_ID = /^wwm_[A-Za-z0-9_-]+$/;

export function markMetadataOnlyWork(report, { workId, sourcePageId, sourceWorkId = workId }) {
  if (!WORK_ID.test(`${workId ?? ""}`)) {
    throw new Error("--work-id must be the exact stable wwm_* ID read from Notion.");
  }
  if (!NOTION_PAGE_ID.test(`${sourcePageId ?? ""}`)) {
    throw new Error("--source-page-id must be an exact Notion page UUID.");
  }
  if ((report.identityIssues ?? []).length > 0 || (report.unresolved ?? []).length > 0) {
    throw new Error("Metadata-only publication requires zero identity issues and zero unresolved credits.");
  }
  const matches = (report.proposedCredits ?? []).filter((work) => work.workId === sourceWorkId);
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one proposed credit set for ${workId}; found ${matches.length}.`);
  }
  const work = matches[0];
  if (!Array.isArray(work.credits) || work.credits.length === 0 || work.credits.some((credit) => !credit.personId)) {
    throw new Error("Metadata-only publication requires a non-empty, fully linked credit set.");
  }
  if (!Object.values(work.sourceWorkExternalIds ?? {}).some((value) => typeof value === "string" && value.trim())) {
    throw new Error("Metadata-only publication requires at least one stable external work ID.");
  }

  return {
    ...structuredClone(report),
    proposedCredits: report.proposedCredits.map((entry) => entry.workId === sourceWorkId
      ? {
          ...structuredClone(entry),
          workId,
          metadataOnlyWork: {
            mode: "metadata-only",
            sourcePageId,
            completeCreditSet: true
          }
        }
      : structuredClone(entry))
  };
}
