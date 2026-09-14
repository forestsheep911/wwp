const STABLE_SOURCES = ["tmdb", "imdb", "wikidata"];

export function validateTargetedSupplementInput(value) {
  if (!value?.work?.workId || !value.work.title || !value.work.sourceWorkExternalIds) {
    throw new Error("input.work requires workId, title, and sourceWorkExternalIds");
  }
  if (!Array.isArray(value.credits) || value.credits.length < 1 || value.credits.length > 20) {
    throw new Error("input.credits must contain 1-20 credits");
  }
  for (const credit of value.credits) validateCredit(value.work, credit);
  return value;
}

export function reviewedEvidenceForCredit(credit, observedAt = new Date().toISOString()) {
  if (credit.externalIds.wikidata) return undefined;
  const evidence = structuredClone(credit.reviewedEvidence);
  evidence.observedAt ??= observedAt;
  for (const name of evidence.names) name.observedAt ??= evidence.observedAt;
  for (const sourceRef of evidence.sourceRefs) sourceRef.observedAt ??= evidence.observedAt;
  return evidence;
}

function validateCredit(work, credit) {
  if (!credit?.name || !credit.department) {
    throw new Error("each credit requires name and department");
  }
  const ids = normalizedIds(credit.externalIds);
  if (!STABLE_SOURCES.some((source) => ids[source])) {
    throw new Error(`credit ${credit.name} requires a stable Wikidata, TMDB, or IMDb ID`);
  }
  credit.externalIds = ids;
  if (ids.wikidata && !/^Q\d+$/i.test(ids.wikidata)) {
    throw new Error(`credit ${credit.name} has an invalid Wikidata QID`);
  }
  if (ids.wikidata) return;

  const source = ids.imdb ? "imdb" : "tmdb";
  const evidence = credit.reviewedEvidence;
  if (!evidence || !Array.isArray(evidence.names) || evidence.names.length < 1) {
    throw new Error(`credit ${credit.name} requires reviewedEvidence.names without Wikidata`);
  }
  if (!Array.isArray(evidence.sourceRefs) || evidence.sourceRefs.length < 1) {
    throw new Error(`credit ${credit.name} requires reviewedEvidence.sourceRefs without Wikidata`);
  }
  const evidenceIds = normalizedIds(evidence.externalIds);
  if (evidenceIds[source] !== ids[source]) {
    throw new Error(`credit ${credit.name} reviewedEvidence must repeat its ${source} ID`);
  }
  const hasIdentityRef = evidence.sourceRefs.some((ref) => (
    ref?.source === source && String(ref.id ?? "").trim().toLowerCase() === ids[source].toLowerCase()
  ));
  if (!hasIdentityRef) {
    throw new Error(`credit ${credit.name} requires a ${source} identity source reference`);
  }
  if (String(work.sourceWorkExternalIds?.[source] ?? "").trim() === "") {
    throw new Error(`work ${work.workId} requires a ${source} ID for ${credit.name}`);
  }
  if (!credit.workCreditUrl || !/^https:\/\//i.test(credit.workCreditUrl)) {
    throw new Error(`credit ${credit.name} requires an HTTPS workCreditUrl without Wikidata`);
  }
}

function normalizedIds(value) {
  return Object.fromEntries(STABLE_SOURCES.flatMap((source) => {
    const id = String(value?.[source] ?? "").trim();
    return id ? [[source, id]] : [];
  }));
}
