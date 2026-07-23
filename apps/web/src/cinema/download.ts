export function directDownloadName(name?: string) {
  const cleaned = name
    ?.replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `${cleaned}.mp4` : "wwp-video.mp4";
}

function isNotionFileUrl(url: URL) {
  return url.hostname.toLowerCase() === "file.notion.so";
}

function isNotionSignedUrl(url: URL) {
  return /(^|\.)notion\.site$/i.test(url.hostname) && url.pathname.startsWith("/signed/");
}

function isGenericDownloadName(value: string | null) {
  return !value || /^(?:video|file|audio|pdf)(?:\.mp4)?$/i.test(value);
}

export function directDownloadUrl(downloadUrl: string, name?: string) {
  try {
    const url = new URL(downloadUrl);
    if (isNotionFileUrl(url)) {
      url.searchParams.set("download", "true");
      if (!url.searchParams.get("downloadName")) {
        url.searchParams.set("downloadName", directDownloadName(name));
      }
    } else if (isNotionSignedUrl(url)) {
      url.searchParams.set("download", "true");
      if (name && isGenericDownloadName(url.searchParams.get("name"))) {
        url.searchParams.set("name", directDownloadName(name));
      }
    }
    return url.toString();
  } catch {
    return downloadUrl;
  }
}

export function directPlaybackUrl(downloadUrl: string) {
  try {
    const url = new URL(downloadUrl);
    if (isNotionFileUrl(url) || isNotionSignedUrl(url)) {
      url.searchParams.delete("download");
      url.searchParams.delete("downloadName");
    }
    return url.toString();
  } catch {
    return downloadUrl;
  }
}

export function triggerDirectDownload(downloadUrl: string, name?: string) {
  if (typeof window === "undefined") return;

  window.open(directDownloadUrl(downloadUrl, name), "_blank", "noopener,noreferrer");
}
