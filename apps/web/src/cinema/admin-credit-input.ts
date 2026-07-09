export function parseCreditInputValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return Number.NaN;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function creditInputDisplayValue(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}
