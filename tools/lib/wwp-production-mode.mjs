export const PRODUCTION_MODES = Object.freeze({
  FILM_ONLY: "film-only",
  PEOPLE_ONLY: "people-only",
  FILM_AND_CURRENT_PEOPLE: "film-and-current-people"
});

const MODE_ALIASES = new Map([
  ["film", PRODUCTION_MODES.FILM_ONLY],
  ["film_only", PRODUCTION_MODES.FILM_ONLY],
  [PRODUCTION_MODES.FILM_ONLY, PRODUCTION_MODES.FILM_ONLY],
  ["people", PRODUCTION_MODES.PEOPLE_ONLY],
  ["people_only", PRODUCTION_MODES.PEOPLE_ONLY],
  [PRODUCTION_MODES.PEOPLE_ONLY, PRODUCTION_MODES.PEOPLE_ONLY],
  ["film_with_people", PRODUCTION_MODES.FILM_AND_CURRENT_PEOPLE],
  ["film-and-people", PRODUCTION_MODES.FILM_AND_CURRENT_PEOPLE],
  ["film_and_current_people", PRODUCTION_MODES.FILM_AND_CURRENT_PEOPLE],
  [PRODUCTION_MODES.FILM_AND_CURRENT_PEOPLE, PRODUCTION_MODES.FILM_AND_CURRENT_PEOPLE]
]);

export function normalizeProductionMode(value = PRODUCTION_MODES.FILM_AND_CURRENT_PEOPLE) {
  const normalized = MODE_ALIASES.get(String(value).trim().toLowerCase());
  if (!normalized) {
    throw new Error(`--mode must be one of: ${Object.values(PRODUCTION_MODES).join(", ")}`);
  }
  return normalized;
}

export function buildProductionModePlan(mode, currentWorkIds = []) {
  const normalized = normalizeProductionMode(mode);
  const exactWorkIds = [...new Set(currentWorkIds.filter(Boolean).map(String))];
  if (normalized === PRODUCTION_MODES.FILM_ONLY) {
    return {
      mode: normalized,
      sequence: ["film"],
      film: { enabled: true },
      people: { enabled: false, status: "disabled_by_mode", scope: "none", workIds: [] }
    };
  }
  if (normalized === PRODUCTION_MODES.PEOPLE_ONLY) {
    return {
      mode: normalized,
      sequence: ["people"],
      film: { enabled: false },
      people: { enabled: true, status: "eligible", scope: "saved_people_campaign", workIds: [] }
    };
  }
  return {
    mode: normalized,
    sequence: ["film", "people"],
    film: { enabled: true },
    people: {
      enabled: true,
      status: exactWorkIds.length ? "eligible_after_film_checkpoint" : "not_scheduled_no_current_work",
      scope: "current_film_batch",
      workIds: exactWorkIds
    }
  };
}
