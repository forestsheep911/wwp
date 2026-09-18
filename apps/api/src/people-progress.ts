import type { PersonCatalogState, SearchResult } from "@wwpdw/shared";
import { auditPeopleRepairCandidates } from "./people-repair-audit.js";
import { auditPeopleWorkCoverage } from "./people-work-coverage-audit.js";
import { PERSON_QUALITY_POLICY_VERSION } from "./person-quality-score.js";

export interface PeopleProgress {
  scope: "indexed_works";
  workCount: number;
  worksWithoutCredits: number;
  worksFullyLinked: number;
  knownCreditCount: number;
  linkedCreditCount: number;
  profileCount: number;
  qualityReadyCount: number;
  repairPriorities: { P0: number; P1: number; P2: number };
  qualityPolicyVersion: string;
  personCatalogUpdatedAt?: string;
}

export function buildPeopleProgress(results: SearchResult[], state: PersonCatalogState): PeopleProgress {
  // A personId without a published profile is not a completed relationship.
  const materializedResults = results.map((result) => {
    const metadata = result.metadata;
    if (!metadata) return result;
    const credits = metadata.work?.credits ?? metadata.credits;
    if (!credits?.some((credit) => credit.personId && !state.people[credit.personId])) return result;
    const materializedCredits = credits.map((credit) => credit.personId && !state.people[credit.personId]
      ? { ...credit, personId: undefined }
      : credit);
    return {
      ...result,
      metadata: {
        ...metadata,
        ...(metadata.work?.credits ? { work: { ...metadata.work, credits: materializedCredits } } : { credits: materializedCredits })
      }
    };
  });
  const coverage = auditPeopleWorkCoverage(materializedResults, 1);
  const repair = auditPeopleRepairCandidates(state, 1);
  const actionableIds = new Set(repair.candidates
    .filter((candidate) => candidate.priority !== "P3")
    .map((candidate) => candidate.personId));
  const profiles = Object.values(state.people).map((entry) => entry.profile);

  return {
    scope: "indexed_works",
    workCount: coverage.totalWorks,
    worksWithoutCredits: coverage.summary.missing_credits,
    worksFullyLinked: coverage.summary.fully_linked,
    knownCreditCount: coverage.works.reduce((sum, work) => sum + work.creditCount, 0),
    linkedCreditCount: coverage.works.reduce((sum, work) => sum + work.linkedCreditCount, 0),
    profileCount: profiles.length,
    qualityReadyCount: profiles.filter((profile) => !actionableIds.has(profile.personId)).length,
    repairPriorities: { P0: repair.summary.P0, P1: repair.summary.P1, P2: repair.summary.P2 },
    qualityPolicyVersion: PERSON_QUALITY_POLICY_VERSION,
    ...(state.generatedAt ? { personCatalogUpdatedAt: state.generatedAt } : {})
  };
}
