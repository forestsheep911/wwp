export function remapReportToExistingPeople(report, conflictArtifact) {
  const conflicts = conflictArtifact?.conflicts ?? [];
  const grouped = new Map();
  for (const conflict of conflicts) {
    const entries = grouped.get(conflict.incomingPersonId) ?? [];
    entries.push(conflict);
    grouped.set(conflict.incomingPersonId, entries);
  }

  const remaps = [];
  for (const [incomingPersonId, entries] of grouped) {
    const existingIds = new Set(entries.map((entry) => entry.existingPersonId));
    const pageIds = new Set(entries.map((entry) => entry.pageId));
    const externalIds = new Set(entries.flatMap((entry) => entry.externalIds ?? []));
    const incomingProfile = (report.proposedProfiles ?? []).find((profile) => profile.personId === incomingPersonId);
    const hasReviewedWorkCredit = (incomingProfile?.sourceRefs ?? []).some((sourceRef) => (
      sourceRef?.source === "imdb-work-credit"
      && /^https:\/\/www\.imdb\.com\/title\/tt\d+\/fullcredits\/?$/iu.test(String(sourceRef.url ?? ""))
    ));
    const singleReviewedImdbIdentity = externalIds.size === 1
      && [...externalIds][0].startsWith("imdb:")
      && hasReviewedWorkCredit;
    if (existingIds.size !== 1 || pageIds.size !== 1 || (externalIds.size < 2 && !singleReviewedImdbIdentity)) {
      throw new Error(`Cannot safely remap ${incomingPersonId}: expected one existing person/page and at least two matching stable IDs, or one exact IMDb ID with reviewed work-credit evidence.`);
    }
    const incomingExternalIds = entries[0]?.incomingExternalIds;
    const existingExternalIds = entries[0]?.existingExternalIds;
    if (!incomingExternalIds || !existingExternalIds) {
      throw new Error(`Cannot safely remap ${incomingPersonId}: conflict evidence must include complete incoming and existing external IDs.`);
    }
    for (const provider of Object.keys(incomingExternalIds)) {
      if (!(provider in existingExternalIds)) continue;
      if (normalizeExternalId(incomingExternalIds[provider]) !== normalizeExternalId(existingExternalIds[provider])) {
        throw new Error(`Cannot safely remap ${incomingPersonId}: contrary ${provider} IDs were found.`);
      }
    }
    remaps.push({
      incomingPersonId,
      existingPersonId: [...existingIds][0],
      pageId: [...pageIds][0],
      externalIds: [...externalIds].sort()
    });
  }

  const idMap = new Map(remaps.map((entry) => [entry.incomingPersonId, entry.existingPersonId]));
  const output = structuredClone(report);
  for (const profile of output.proposedProfiles ?? []) {
    profile.personId = idMap.get(profile.personId) ?? profile.personId;
  }
  for (const work of output.proposedCredits ?? []) {
    for (const credit of work.credits ?? []) {
      if (credit.personId) credit.personId = idMap.get(credit.personId) ?? credit.personId;
    }
  }
  const personIds = (output.proposedProfiles ?? []).map((profile) => profile.personId);
  if (new Set(personIds).size !== personIds.length) {
    throw new Error("Identity remapping would create duplicate profiles in the report.");
  }
  output.generatedAt = new Date().toISOString();
  output.identityRemaps = remaps;
  return output;
}

function normalizeExternalId(value) {
  return String(value ?? "").trim().toLowerCase();
}
