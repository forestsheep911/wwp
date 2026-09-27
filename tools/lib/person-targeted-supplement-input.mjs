const STABLE_SOURCES = ["tmdb", "imdb", "douban", "wikidata"];

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
  const externalIds = { ...(evidence.externalIds ?? {}) };
  const sourceRefs = [...evidence.sourceRefs];
  for (const [source, id] of Object.entries(credit.externalIds ?? {})) {
    if (externalIds[source] && externalIds[source] !== id) {
      throw new Error(`credit ${credit.name} ${source} ID conflicts with reviewed evidence`);
    }
    externalIds[source] = id;
    const ref = credit.identityRefs?.find((item) => item.source === source && item.id === id);
    if (ref && !sourceRefs.some((item) => item.source === source && item.id === id)) {
      sourceRefs.push({ ...ref, observedAt });
    }
  }
  evidence.externalIds = externalIds;
  evidence.sourceRefs = sourceRefs;
  evidence.observedAt ??= observedAt;
  for (const name of evidence.names) name.observedAt ??= evidence.observedAt;
  for (const sourceRef of evidence.sourceRefs) sourceRef.observedAt ??= evidence.observedAt;
  return evidence;
}

export function mergeCreditIdentityEvidence(evidence, credit) {
  if (!evidence) return evidence;
  const externalIds = { ...(evidence.externalIds ?? {}) };
  const sourceRefs = [...(evidence.sourceRefs ?? [])];
  for (const [source, id] of Object.entries(credit.externalIds ?? {})) {
    if (externalIds[source] && externalIds[source] !== id) {
      throw new Error(`credit ${credit.name} ${source} ID conflicts with Wikidata evidence`);
    }
    externalIds[source] = id;
    const ref = credit.identityRefs?.find((item) => item.source === source && item.id === id);
    if (ref && !sourceRefs.some((item) => item.source === source && item.id === id)) {
      sourceRefs.push({ ...ref, observedAt: evidence.observedAt });
    }
  }
  return { ...evidence, externalIds, sourceRefs };
}

function validateCredit(work, credit) {
  if (!credit?.name || !credit.department) {
    throw new Error("each credit requires name and department");
  }
  if (credit.legacyAliases !== undefined) {
    if (!Array.isArray(credit.legacyAliases) || credit.legacyAliases.some((value) => typeof value !== "string" || !value.trim())) {
      throw new Error(`credit ${credit.name} legacyAliases must be a list of non-empty strings`);
    }
    credit.legacyAliases = [...new Set(credit.legacyAliases.map((value) => value.trim()))];
  }
  const ids = normalizedIds(credit.externalIds);
  if (!STABLE_SOURCES.some((source) => ids[source])) {
    throw new Error(`credit ${credit.name} requires a stable Wikidata, TMDB, IMDb, or Douban person ID`);
  }
  credit.externalIds = ids;
  if (credit.identityRefs !== undefined) {
    if (!Array.isArray(credit.identityRefs) || credit.identityRefs.some((ref) => (
      !STABLE_SOURCES.includes(ref?.source)
      || !ref.id
      || ref.id !== ids[ref.source]
      || typeof ref.url !== "string"
      || !/^https:\/\//i.test(ref.url)
    ))) {
      throw new Error(`credit ${credit.name} identityRefs must cite matching stable IDs with HTTPS URLs`);
    }
  }
  if (ids.wikidata && !/^Q\d+$/i.test(ids.wikidata)) {
    throw new Error(`credit ${credit.name} has an invalid Wikidata QID`);
  }
  if (ids.douban && !/^\d{4,12}$/.test(ids.douban)) {
    throw new Error(`credit ${credit.name} has an invalid Douban person ID`);
  }
  if (ids.wikidata) return;

  const source = ids.imdb ? "imdb" : ids.tmdb ? "tmdb" : "douban";
  const evidence = credit.reviewedEvidence;
  if (!evidence || !Array.isArray(evidence.names) || evidence.names.length < 1) {
    throw new Error(`credit ${credit.name} requires reviewedEvidence.names without Wikidata`);
  }
  if (!Array.isArray(evidence.sourceRefs) || evidence.sourceRefs.length < 1) {
    throw new Error(`credit ${credit.name} requires reviewedEvidence.sourceRefs without Wikidata`);
  }
  if (evidence.names.some((name) => !name || typeof name.value !== "string" || !name.value.trim())) {
    throw new Error(`credit ${credit.name} reviewedEvidence.names requires a non-empty value field`);
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
