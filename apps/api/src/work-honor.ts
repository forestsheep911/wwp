export type WorkHonorResult = "winner" | "nominee" | "selection" | "special_mention";
export type WorkHonorStatus = "draft" | "verified" | "conflict";

export interface WorkHonorSourceRef {
  url: string;
  title?: string;
  authority: "official" | "institutional";
  observedAt: string;
}

export interface WorkHonorRecord {
  honorId: string;
  workId: string;
  awardingBody: string;
  eventName: string;
  editionYear: number;
  category: string;
  result: WorkHonorResult;
  recipients: string[];
  sourceRefs: WorkHonorSourceRef[];
  status: WorkHonorStatus;
  checkedAt: string;
}

export interface WorkHonorValidation {
  valid: boolean;
  errors: string[];
}

export function validateWorkHonorRecord(record: WorkHonorRecord): WorkHonorValidation {
  const errors: string[] = [];
  const vagueClaim = /^(?:获奖|获奖无数|多项大奖|重要奖项|最佳影片|award(?:s)?|multiple awards?|acclaimed)$/i;
  if (!/^honor_[a-z0-9_-]+$/i.test(record.honorId)) errors.push("invalid_honor_id");
  if (!/^wwm_[A-Za-z0-9_-]+$/.test(record.workId)) errors.push("invalid_work_id");
  if (!record.awardingBody.trim()) errors.push("missing_awarding_body");
  if (!record.eventName.trim()) errors.push("missing_event_name");
  if (!Number.isInteger(record.editionYear) || record.editionYear < 1880 || record.editionYear > 2200) errors.push("invalid_edition_year");
  if (!record.category.trim()) errors.push("missing_category");
  else if (vagueClaim.test(record.category.trim())) errors.push("vague_category");
  if (!["winner", "nominee", "selection", "special_mention"].includes(record.result)) errors.push("invalid_result");
  if (record.recipients.length === 0 || record.recipients.some((recipient) => !recipient.trim())) errors.push("missing_recipient_scope");
  if (record.sourceRefs.length === 0) errors.push("missing_source_reference");
  if (record.sourceRefs.some((source) => !/^https:\/\//i.test(source.url))) errors.push("source_must_be_https");
  if (record.sourceRefs.some((source) => !["official", "institutional"].includes(source.authority))) {
    errors.push("invalid_source_authority");
  }
  if (record.sourceRefs.some((source) => !source.observedAt.trim() || Number.isNaN(Date.parse(source.observedAt)))) {
    errors.push("invalid_source_observed_at");
  }
  if (!record.checkedAt.trim()) errors.push("missing_checked_at");
  else if (Number.isNaN(Date.parse(record.checkedAt))) errors.push("invalid_checked_at");
  return { valid: errors.length === 0, errors };
}
