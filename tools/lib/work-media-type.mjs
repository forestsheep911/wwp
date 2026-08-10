export function expectedNotionMediaType(workType) {
  if (workType === "movie") return "Movie";
  if (workType === "series") return "TV Series";
  throw new Error(`Unsupported ledger work type: ${workType ?? "(empty)"}`);
}

export function compareNotionMediaType(workType, actualMediaType) {
  const expected = expectedNotionMediaType(workType);
  const actual = `${actualMediaType ?? ""}`.trim() || null;
  return {
    expected,
    actual,
    matches: actual === expected
  };
}
