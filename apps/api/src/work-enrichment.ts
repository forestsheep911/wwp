export type EnrichmentCheckStatus = "not_checked" | "partial" | "verified" | "checked_none_found" | "conflict";
export type HighlightReviewStatus = "not_started" | "draft" | "reviewed" | "verified";

export interface WorkEnrichmentInput {
  workId: string;
  metadataStatus: "draft" | "partial" | "verified" | "conflict";
  metadataMissingFields?: string[];
  peopleStatus: EnrichmentCheckStatus;
  keyCreatorsVerified: boolean;
  peopleMissingFields?: string[];
  honorsStatus: EnrichmentCheckStatus;
  honorsMissingFields?: string[];
  highlightStatus?: HighlightReviewStatus;
  highlightHumanLocked?: boolean;
  humanConfirmationReasons?: string[];
}

export type HighlightGateStatus =
  | "blocked_metadata"
  | "blocked_people"
  | "blocked_honors"
  | "ready"
  | "draft"
  | "reviewed"
  | "verified";

export interface WorkEnrichmentAssessment {
  workId: string;
  baseMetadata: WorkEnrichmentInput["metadataStatus"];
  people: {
    status: EnrichmentCheckStatus;
    keyCreatorsVerified: boolean;
    readyForHighlights: boolean;
  };
  honors: {
    status: EnrichmentCheckStatus;
    readyForHighlights: boolean;
  };
  highlights: {
    status: HighlightGateStatus;
    blockedBy: Array<"metadata" | "people" | "honors">;
    missingFields: string[];
    nextAction: string;
    humanLocked: boolean;
  };
  needsHumanConfirmation: boolean;
  humanConfirmationReasons: string[];
  sequence: ["base-metadata", "people", "honors", "highlights"];
}

export function assessWorkEnrichment(input: WorkEnrichmentInput): WorkEnrichmentAssessment {
  const peopleReady = input.peopleStatus === "verified"
    || (input.peopleStatus === "partial" && input.keyCreatorsVerified);
  const honorsReady = input.honorsStatus === "verified" || input.honorsStatus === "checked_none_found";
  const blockedBy: WorkEnrichmentAssessment["highlights"]["blockedBy"] = [];
  if (input.metadataStatus !== "verified") blockedBy.push("metadata");
  if (!peopleReady) blockedBy.push("people");
  if (!honorsReady) blockedBy.push("honors");

  let highlightGate: HighlightGateStatus;
  if (blockedBy.includes("metadata")) highlightGate = "blocked_metadata";
  else if (blockedBy.includes("people")) highlightGate = "blocked_people";
  else if (blockedBy.includes("honors")) highlightGate = "blocked_honors";
  else highlightGate = input.highlightStatus && input.highlightStatus !== "not_started"
    ? input.highlightStatus
    : "ready";

  const missingFields = [
    ...(blockedBy.includes("metadata") ? (input.metadataMissingFields?.length ? input.metadataMissingFields : ["base_metadata_verification"]) : []),
    ...(blockedBy.includes("people") ? (input.peopleMissingFields?.length ? input.peopleMissingFields : ["key_creator_verification"]) : []),
    ...(blockedBy.includes("honors") ? (input.honorsMissingFields?.length ? input.honorsMissingFields : ["honor_source_check"]) : [])
  ];
  const nextAction = blockedBy.includes("metadata")
    ? "complete_base_metadata"
    : blockedBy.includes("people")
      ? "verify_key_creators"
      : blockedBy.includes("honors")
        ? "verify_honors_or_record_checked_none_found"
        : input.highlightHumanLocked
          ? "preserve_human_locked_highlights"
          : highlightGate === "ready"
            ? "generate_highlight_draft"
            : "continue_highlight_review";
  const humanConfirmationReasons = [...new Set(input.humanConfirmationReasons?.filter(Boolean) ?? [])];

  return {
    workId: input.workId,
    baseMetadata: input.metadataStatus,
    people: {
      status: input.peopleStatus,
      keyCreatorsVerified: input.keyCreatorsVerified,
      readyForHighlights: peopleReady
    },
    honors: {
      status: input.honorsStatus,
      readyForHighlights: honorsReady
    },
    highlights: {
      status: highlightGate,
      blockedBy,
      missingFields,
      nextAction,
      humanLocked: input.highlightHumanLocked === true
    },
    needsHumanConfirmation: humanConfirmationReasons.length > 0,
    humanConfirmationReasons,
    sequence: ["base-metadata", "people", "honors", "highlights"]
  };
}
