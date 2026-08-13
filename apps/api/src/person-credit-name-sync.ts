import type { MovieCreditEntry, PersonCatalogState, SearchResult } from "@wwpdw/shared";
import { normalizePersonNameSearchKey, selectPersonDisplayNames } from "@wwpdw/shared";
import { rebuildDerivedPersonIndexes } from "@wwpdw/cache-store";

export function planPersonCreditNameSync(
  currentCatalog: PersonCatalogState,
  searchResults: SearchResult[],
  generatedAt = new Date().toISOString(),
  personIds?: Set<string>
) {
  const nextCatalog = structuredClone(currentCatalog);
  const affectedWorkIds = new Set<string>();
  const replacementsByWorkId = new Map<string, Map<string, string>>();

  for (const [workId, credits] of Object.entries(nextCatalog.creditsByWorkId)) {
    for (const credit of credits) {
      if (personIds && !personIds.has(credit.personId)) continue;
      const profile = nextCatalog.people[credit.personId]?.profile;
      const name = profile ? selectPersonDisplayNames(profile.names).primary?.trim() : undefined;
      if (!name || name === credit.name) continue;
      const replacements = replacementsByWorkId.get(workId) ?? new Map<string, string>();
      replacements.set(normalizePersonNameSearchKey(credit.name), name);
      replacementsByWorkId.set(workId, replacements);
      credit.name = name;
      affectedWorkIds.add(workId);
    }
  }

  if (affectedWorkIds.size > 0) {
    rebuildDerivedPersonIndexes(nextCatalog);
    nextCatalog.generatedAt = generatedAt;
  }

  const originalResults: SearchResult[] = [];
  const updatedResults: SearchResult[] = [];
  for (const original of searchResults) {
    const workId = original.metadata?.work?.workId;
    if (!workId || !affectedWorkIds.has(workId) || !original.metadata?.work) continue;
    const updated = structuredClone(original);
    const canonicalByPersonId = new Map(
      (nextCatalog.creditsByWorkId[workId] ?? []).map((credit) => [credit.personId, credit.name])
    );
    const replaceCredit = (credit: MovieCreditEntry) => credit.personId && canonicalByPersonId.has(credit.personId)
      ? { ...credit, name: canonicalByPersonId.get(credit.personId)! }
      : credit;
    const replacements = replacementsByWorkId.get(workId) ?? new Map<string, string>();
    updated.metadata = {
      ...updated.metadata!,
      credits: updated.metadata?.credits?.map(replaceCredit),
      directors: replaceNames(updated.metadata?.directors, replacements),
      people: replaceNames(updated.metadata?.people, replacements),
      display: replaceDisplay(updated.metadata?.display, replacements),
      work: {
        ...updated.metadata!.work!,
        credits: updated.metadata?.work?.credits?.map(replaceCredit),
        display: replaceDisplay(updated.metadata?.work?.display, replacements),
        updatedAt: generatedAt
      }
    };
    if (JSON.stringify(updated) !== JSON.stringify(original)) {
      originalResults.push(structuredClone(original));
      updatedResults.push(updated);
    }
  }

  return {
    nextCatalog,
    originalResults,
    updatedResults,
    summary: {
      affectedWorkCount: affectedWorkIds.size,
      searchIndexWrites: updatedResults.length,
      catalogChanged: affectedWorkIds.size > 0
    }
  };
}

export async function applyPersonCreditNameSync(input: {
  plan: ReturnType<typeof planPersonCreditNameSync>;
  searchStore: { upsertResults(results: SearchResult[], indexedAt?: string): Promise<unknown> };
  personStore: { replaceState(state: PersonCatalogState): Promise<void> };
  indexedAt?: string;
}) {
  if (!input.plan.summary.catalogChanged && input.plan.updatedResults.length === 0) return;
  let searchWritten = false;
  try {
    if (input.plan.updatedResults.length > 0) {
      await input.searchStore.upsertResults(input.plan.updatedResults, input.indexedAt);
      searchWritten = true;
    }
    if (input.plan.summary.catalogChanged) await input.personStore.replaceState(input.plan.nextCatalog);
  } catch (error) {
    if (searchWritten) {
      try {
        await input.searchStore.upsertResults(input.plan.originalResults, input.indexedAt);
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "People credit-name sync failed and search-index rollback also failed.");
      }
    }
    throw error;
  }
}

function replaceNames(values: string[] | undefined, replacements: Map<string, string>) {
  return values?.map((value) => replacements.get(normalizePersonNameSearchKey(value)) ?? value);
}

function replaceDisplay<T extends { directorLine?: string; castLine?: string } | undefined>(
  display: T,
  replacements: Map<string, string>
): T {
  if (!display) return display;
  return {
    ...display,
    directorLine: replaceLine(display.directorLine, replacements),
    castLine: replaceLine(display.castLine, replacements)
  } as T;
}

function replaceLine(value: string | undefined, replacements: Map<string, string>) {
  if (!value) return value;
  return value.split(/\s*[/、|]\s*/u)
    .map((name) => replacements.get(normalizePersonNameSearchKey(name)) ?? name)
    .join(" / ");
}
