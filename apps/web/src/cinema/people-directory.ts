export function normalizePersonDirectoryQuery(value: string) {
  return value.normalize("NFKD").replace(/[\p{P}\p{S}\s]+/gu, "").toLocaleLowerCase("und");
}
