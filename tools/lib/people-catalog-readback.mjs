function creditIdentityKey(credit) {
  const ids = credit?.externalIds && typeof credit.externalIds === "object"
    ? Object.entries(credit.externalIds).filter(([, value]) => value).map(([key, value]) => `${key}:${value}`).sort()
    : [];
  if (ids.length > 0) return ids.join("|");
  return [credit?.department, credit?.job, credit?.name, credit?.originalName].filter(Boolean).join("|");
}

export function expectedLinkedCreditKeys(result) {
  return new Set((result?.metadata?.work?.credits ?? result?.metadata?.credits ?? [])
    .filter((credit) => credit?.personId)
    .map((credit) => `${creditIdentityKey(credit)}=>${credit.personId}`));
}

export function missingLinkedCreditKeys(expectedResult, actualResult) {
  const expected = expectedLinkedCreditKeys(expectedResult);
  const actual = expectedLinkedCreditKeys(actualResult);
  return [...expected].filter((key) => !actual.has(key));
}

export async function verifyPeopleCatalogReadback({ searchStore, expectedResults, attempts = 3, delayMs = 1500 }) {
  const failures = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    failures.length = 0;
    for (const expected of expectedResults) {
      const actual = await searchStore.getResult(expected.assetKey);
      const missing = missingLinkedCreditKeys(expected, actual);
      if (missing.length > 0) failures.push({ assetKey: expected.assetKey, missing });
    }
    if (failures.length === 0) return { verified: true, attempts: attempt, failures: [] };
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return { verified: false, attempts, failures };
}
