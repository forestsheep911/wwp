export function notionVideoName(video = {}) {
  if (video.name) return video.name;
  const url = video.file?.url ?? video.external?.url ?? "";
  if (!url) return "";
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "");
  } catch {
    return url;
  }
}

export function assertPreparedMovieTargetIsEmpty(target) {
  const videoNames = Array.isArray(target?.videoNames) ? target.videoNames.filter(Boolean) : [];
  const videoCount = Number.isInteger(target?.videoCount) ? target.videoCount : videoNames.length;
  if (videoCount === 0) return;
  throw new Error(
    `Target spec page already contains ${videoCount} video block(s): ${videoNames.join(", ") || "(unnamed Notion media)"}. `
    + "Stop before encoding or choose a distinct spec title."
  );
}

export function selectExplicitChildTarget(candidates, targetPageId, rootLabel = "requested work page") {
  const normalizedTargetId = String(targetPageId ?? "").replaceAll("-", "").toLowerCase();
  const target = candidates.find((candidate) =>
    String(candidate.id ?? "").replaceAll("-", "").toLowerCase() === normalizedTargetId
  );
  if (target) return target;
  throw new Error(
    `Explicit target page ${targetPageId} is not a spec child of the ${rootLabel}. `
    + "Refusing a cross-work upload."
  );
}
