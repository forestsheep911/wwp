export async function runHomeNotionSyncCycle<T>(input: {
  runMetadataSync: () => Promise<void>;
  runPeopleSync: () => Promise<T>;
}) {
  const errors: unknown[] = [];
  let peopleResult: T | undefined;
  try {
    await input.runMetadataSync();
  } catch (error) {
    errors.push(error);
  }
  try {
    peopleResult = await input.runPeopleSync();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) throw new AggregateError(errors, "One or more home Notion sync lanes failed.");
  return { peopleResult: peopleResult as T };
}
