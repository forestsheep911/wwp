export function assertEpisodeTargetIsEmpty(target) {
  const count = Number(target?.videoCount ?? 0);
  if (!Number.isInteger(count) || count < 0) throw new Error("episode target videoCount must be a non-negative integer");
  if (count === 0) return;
  throw new Error(
    `Episode target ${target.id ?? "(unknown)"} already contains ${count} video block(s). `
    + "Stop before upload; unnamed Notion video blocks cannot be safely deduplicated."
  );
}
