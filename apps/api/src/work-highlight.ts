export type WorkHighlightStatus = "draft" | "reviewed" | "verified" | "rejected";

export interface WorkHighlightCandidate {
  category: string;
  label: string;
  reason: string;
  evidenceRefs: string[];
  score: { specificity: number; viewerValue: number; concreteness: number; evidence: number; wording: number };
  confidence: number;
  status: WorkHighlightStatus;
  rejectionReasons?: string[];
}

export interface WorkHighlightDraft {
  workId: string;
  snapshotVersion: string;
  generatedAt: string;
  candidates: WorkHighlightCandidate[];
  finalText?: string;
}

export function scoreHighlight(candidate: WorkHighlightCandidate) {
  return Object.values(candidate.score).reduce((sum, value) => sum + value, 0);
}

export function validateHighlightDraft(draft: WorkHighlightDraft) {
  const errors: string[] = [];
  if (!/^wwm_[A-Za-z0-9_-]+$/.test(draft.workId)) errors.push("invalid_work_id");
  if (!draft.snapshotVersion.trim()) errors.push("missing_snapshot_version");
  if (!draft.generatedAt || Number.isNaN(Date.parse(draft.generatedAt))) errors.push("invalid_generated_at");
  if (draft.candidates.length > 8) errors.push("candidate_limit_exceeded");
  const retained = draft.candidates.filter((candidate) => candidate.status !== "rejected");
  if (retained.length > 5) errors.push("retained_limit_exceeded");
  const labels = new Set<string>();
  for (const candidate of draft.candidates) {
    const key = candidate.label.trim().toLocaleLowerCase();
    if (!key) errors.push("missing_label");
    else if (labels.has(key)) errors.push(`duplicate_label:${candidate.label}`);
    labels.add(key);
    if (!candidate.category.trim()) errors.push(`missing_category:${candidate.label}`);
    if (!candidate.reason.trim()) errors.push(`missing_reason:${candidate.label}`);
    if (candidate.confidence < 0 || candidate.confidence > 1) errors.push(`invalid_confidence:${candidate.label}`);
    if (Object.values(candidate.score).some((value) => !Number.isInteger(value) || value < 0 || value > 2)) {
      errors.push(`invalid_score_component:${candidate.label}`);
    }
    const total = scoreHighlight(candidate);
    if (candidate.status !== "rejected" && total < 7) errors.push(`score_below_draft_gate:${candidate.label}`);
    if (candidate.status === "verified" && total < 8) errors.push(`score_below_verified_gate:${candidate.label}`);
    if (candidate.status !== "rejected" && candidate.evidenceRefs.length === 0) errors.push(`missing_evidence:${candidate.label}`);
    if (candidate.evidenceRefs.some((url) => !/^https:\/\//i.test(url))) errors.push(`invalid_evidence_url:${candidate.label}`);
  }
  return { valid: errors.length === 0, errors, retained: retained.length };
}
