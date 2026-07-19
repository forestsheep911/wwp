export function directDownloadName(name?: string) {
  const cleaned = name
    ?.replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `${cleaned}.mp4` : "wwp-video.mp4";
}

export function requiresConfirmedDownload(input: {
  userAgent?: string;
  coarsePointer?: boolean;
}) {
  return Boolean(
    input.coarsePointer
    || /Android|Mobile|WebView|wv\)/i.test(input.userAgent ?? "")
  );
}

export function browserRequiresConfirmedDownload() {
  if (typeof window === "undefined") return false;
  return requiresConfirmedDownload({
    userAgent: window.navigator.userAgent,
    coarsePointer: window.matchMedia("(pointer: coarse)").matches
  });
}

export function triggerDirectDownload(downloadUrl: string, title?: string) {
  const frameName = `wwp_download_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const frame = document.createElement("iframe");
  frame.name = frameName;
  frame.referrerPolicy = "no-referrer";
  frame.style.display = "none";
  frame.setAttribute("aria-hidden", "true");
  document.body.append(frame);

  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = directDownloadName(title);
  link.target = frameName;
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.style.display = "none";
  document.body.append(link);
  link.click();

  window.setTimeout(() => {
    link.remove();
    frame.remove();
  }, 60_000);
}
