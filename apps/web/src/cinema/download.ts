export function triggerDirectDownload(downloadUrl: string, pendingWindow?: Window | null) {
  if (pendingWindow && !pendingWindow.closed) {
    pendingWindow.location.href = downloadUrl;
    return;
  }

  const frame = document.createElement("iframe");
  frame.src = downloadUrl;
  frame.referrerPolicy = "no-referrer";
  frame.style.display = "none";
  frame.setAttribute("aria-hidden", "true");
  document.body.append(frame);
  window.setTimeout(() => frame.remove(), 60_000);
}
