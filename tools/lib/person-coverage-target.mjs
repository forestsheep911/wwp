export function describePeopleCoverageTargets(results, workIds = []) {
  const selected = new Set(workIds);
  if (selected.size === 0) return [];
  return results.flatMap((result) => {
    const work = result.metadata?.work;
    if (!work?.workId || !selected.has(work.workId)) return [];
    const credits = work.credits ?? result.metadata?.credits ?? [];
    return [{
      workId: work.workId,
      title: work.display?.title ?? work.titles?.find((entry) => entry.kind === "primary")?.title ?? result.title,
      assetKey: result.assetKey,
      sourcePageId: result.sourcePageId,
      sourceWorkExternalIds: work.externalIds ?? result.metadata?.externalIds ?? {},
      creditCount: credits.length,
      linkedCreditCount: credits.filter((credit) => credit.personId).length,
      unlinkedCredits: credits.filter((credit) => !credit.personId).map((credit) => ({
        name: credit.name,
        ...(credit.originalName ? { originalName: credit.originalName } : {}),
        department: credit.department,
        ...(credit.job ? { job: credit.job } : {}),
        ...(credit.character ? { character: credit.character } : {}),
        ...(credit.externalIds ? { externalIds: credit.externalIds } : {})
      }))
    }];
  });
}
