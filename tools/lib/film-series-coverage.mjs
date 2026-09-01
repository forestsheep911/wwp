import path from "node:path";

const EPISODIC_SPEC = /(?:GB|MB)?\s*\/\s*集|每集/iu;
const SPECIAL_SPEC = /(?:特别篇|特典|花絮|剧场|评论|导评|commentary|\bOVA\b|\bSP\b)/iu;
const SAMPLE_FILE = /(?:^|[._\- ])(?:sample|smoke)(?:[._\- ]|$)/iu;

export function episodeNumberFromVariant(row) {
  const values = [row.spec_key, row.output_path, row.expected_filename].filter(Boolean);
  for (const value of values) {
    const normalized = String(value).replaceAll("\\", "/");
    const seasonEpisode = normalized.match(/(?:^|[^A-Za-z0-9])S\d{1,3}E(\d{1,4})(?:[^0-9]|$)/iu);
    if (seasonEpisode) return Number(seasonEpisode[1]);
    const explicitEpisode = normalized.match(/(?:^|[^A-Za-z0-9])episode[-_ ]?(\d{1,4})(?:[^0-9]|$)/iu);
    if (explicitEpisode) return Number(explicitEpisode[1]);
  }
  return null;
}

function ordered(values) {
  return [...values].sort((left, right) => left - right);
}

function isSample(row) {
  return SAMPLE_FILE.test(path.basename(String(row.output_path ?? row.expected_filename ?? "")));
}

export function normalizeSeriesSpecTitle(value) {
  return String(value ?? "")
    .replace(/\s*\/\s*(?:Episode|EP)\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?\s*$/iu, "")
    .replace(/\s*\/\s*第?\s*\d{1,4}(?:\s*[-–]\s*\d{1,4})?\s*集\s*$/u, "")
    .trim()
    // Historical entries used both orders for dubbed-track labels. Treat
    // those labels as one specification so coverage does not split a season.
    .replace(/刘杰台配/gu, "台配刘杰")
    .replace(/姜瑰瑾台配/gu, "台配姜瑰瑾");
}

export function analyzeSeriesVariantCoverage(rows) {
  const works = new Map();
  for (const row of rows) {
    const episodeNumber = episodeNumberFromVariant(row);
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1) continue;
    const work = works.get(row.work_id) ?? {
      workId: row.work_id,
      canonicalTitle: row.canonical_title,
      groups: new Map()
    };
    const specTitle = normalizeSeriesSpecTitle(row.display_title);
    if (!specTitle) continue;
    const group = work.groups.get(specTitle) ?? {
      specTitle,
      decidedEpisodes: new Set(),
      syncReadyEpisodes: new Set(),
      deferredEpisodes: new Set(),
      cancelledEpisodes: new Set(),
      sourceIds: new Set(),
      sourceMissing: true,
      allSyncReadyRowsAreSamples: true
    };
    group.decidedEpisodes.add(episodeNumber);
    if (row.publication_state === "sync_ready") {
      group.syncReadyEpisodes.add(episodeNumber);
      if (!isSample(row)) group.allSyncReadyRowsAreSamples = false;
    }
    if (row.production_state === "deferred") group.deferredEpisodes.add(episodeNumber);
    if (row.production_state === "rejected" || row.publication_state === "cancelled") {
      group.cancelledEpisodes.add(episodeNumber);
    }
    if (row.source_id != null) group.sourceIds.add(row.source_id);
    if (row.source_missing === 0) group.sourceMissing = false;
    work.groups.set(specTitle, group);
    works.set(row.work_id, work);
  }

  const gaps = [];
  for (const work of works.values()) {
    const groups = [...work.groups.values()];
    const baseline = groups
      .filter((group) => group.syncReadyEpisodes.size >= 2 && !group.allSyncReadyRowsAreSamples)
      .sort((left, right) => right.syncReadyEpisodes.size - left.syncReadyEpisodes.size
        || right.decidedEpisodes.size - left.decidedEpisodes.size
        || left.specTitle.localeCompare(right.specTitle))[0];
    if (!baseline) continue;

    for (const group of groups) {
      if (group === baseline || group.syncReadyEpisodes.size === 0 || group.allSyncReadyRowsAreSamples) continue;
      if (SPECIAL_SPEC.test(group.specTitle)) continue;
      if (group.syncReadyEpisodes.size < 2 && !EPISODIC_SPEC.test(group.specTitle)) continue;
      const missingEpisodes = ordered([...baseline.syncReadyEpisodes]
        .filter((episode) => !group.decidedEpisodes.has(episode)));
      if (missingEpisodes.length === 0) continue;
      const outsideBaseline = [...group.syncReadyEpisodes]
        .filter((episode) => !baseline.syncReadyEpisodes.has(episode));
      if (outsideBaseline.length > 0) continue;
      gaps.push({
        candidate_type: "series_spec_coverage_gap",
        work_id: work.workId,
        canonical_title: work.canonicalTitle,
        reference_spec_title: baseline.specTitle,
        spec_title: group.specTitle,
        expected_episodes: ordered(baseline.syncReadyEpisodes),
        completed_episodes: ordered(group.syncReadyEpisodes),
        deferred_episodes: ordered(group.deferredEpisodes),
        cancelled_episodes: ordered(group.cancelledEpisodes),
        missing_episodes: missingEpisodes,
        source_ids: ordered(group.sourceIds),
        all_sources_missing: group.sourceMissing
      });
    }
  }
  return gaps.sort((left, right) => right.missing_episodes.length - left.missing_episodes.length
    || String(left.canonical_title).localeCompare(String(right.canonical_title))
    || String(left.spec_title).localeCompare(String(right.spec_title)));
}
