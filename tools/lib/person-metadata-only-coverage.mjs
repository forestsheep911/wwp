export function buildMetadataOnlyPeopleCoverage(catalog, { workId, sourcePageId, expectedCreditCount }) {
  const credits = catalog.creditsByWorkId?.[workId] ?? [];
  const linkedCreditCount = credits.filter((credit) => {
    const person = catalog.people?.[credit.personId];
    const reverse = catalog.creditsByPersonId?.[credit.personId] ?? [];
    return Boolean(person) && reverse.some((entry) => entry.workId === workId);
  }).length;
  const expected = Number(expectedCreditCount);
  if (!Number.isInteger(expected) || expected < 1) throw new Error("--expected-credit-count must be a positive integer.");
  if (credits.length !== expected) {
    throw new Error(`Expected ${expected} catalog credits for ${workId}; found ${credits.length}.`);
  }
  if (linkedCreditCount !== expected) {
    throw new Error(`Expected ${expected} bidirectionally linked credits for ${workId}; found ${linkedCreditCount}.`);
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "metadata-only-catalog-readback",
    works: [{
      workId,
      sourcePageId,
      status: "fully_linked",
      creditCount: expected,
      linkedCreditCount,
      unlinkedCreditCount: 0
    }],
    candidates: []
  };
}
