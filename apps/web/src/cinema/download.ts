function safeDownloadName(name?: string) {
  const cleaned = name
    ?.replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned ? `${cleaned}.mp4` : "wwp-video.mp4";
}

function escapeHtmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function startDownloadInDocument(targetDocument: Document, downloadUrl: string, filename: string) {
  const frameName = `wwp_download_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const frame = targetDocument.createElement("iframe");
  frame.name = frameName;
  frame.referrerPolicy = "no-referrer";
  frame.style.display = "none";
  frame.setAttribute("aria-hidden", "true");
  targetDocument.body.append(frame);

  const manualLink = targetDocument.getElementById("download-link");
  if (manualLink?.tagName.toLowerCase() === "a") {
    const anchor = manualLink as HTMLAnchorElement;
    anchor.href = downloadUrl;
    anchor.download = filename;
    anchor.target = frameName;
  }

  const link = targetDocument.createElement("a");
  link.href = downloadUrl;
  link.download = filename;
  link.target = frameName;
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.style.display = "none";
  targetDocument.body.append(link);
  link.click();

  window.setTimeout(() => {
    link.remove();
    frame.remove();
  }, 60_000);
}

export function triggerDirectDownload(downloadUrl: string, pendingWindow?: Window | null, title?: string) {
  const filename = safeDownloadName(title);

  if (pendingWindow && !pendingWindow.closed) {
    const escapedDownloadUrl = escapeHtmlAttribute(downloadUrl);
    const escapedFilename = escapeHtmlAttribute(filename);

    pendingWindow.document.open();
    pendingWindow.document.write(`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <title>正在准备下载</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #020617; color: #e2e8f0; }
      main { width: min(28rem, calc(100vw - 2rem)); border: 1px solid #1e293b; border-radius: 12px; background: #0f172a; padding: 24px; box-shadow: 0 24px 80px rgba(0,0,0,.45); }
      h1 { margin: 0 0 8px; font-size: 18px; }
      p { margin: 0 0 16px; color: #94a3b8; line-height: 1.7; }
      a { color: #6ee7b7; font-weight: 700; text-decoration: none; }
      a:hover { color: #a7f3d0; }
    </style>
  </head>
  <body>
    <main>
      <h1>正在准备下载</h1>
      <p>如果浏览器没有自动开始下载，请使用下面的链接。</p>
      <a id="download-link" href="${escapedDownloadUrl}" download="${escapedFilename}" rel="noopener noreferrer" referrerpolicy="no-referrer">手动下载</a>
    </main>
  </body>
</html>`);
    pendingWindow.document.close();
    startDownloadInDocument(pendingWindow.document, downloadUrl, filename);
    return;
  }

  startDownloadInDocument(document, downloadUrl, filename);
}
