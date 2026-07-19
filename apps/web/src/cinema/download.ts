export function directDownloadName(name?: string) {
  const cleaned = name
    ?.replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `${cleaned}.mp4` : "wwp-video.mp4";
}
