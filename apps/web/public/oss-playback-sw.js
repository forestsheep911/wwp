const virtualMediaPath = "/api/admin/oss-playback-poc/media";
const signedUrlPath = "/api/admin/oss-playback-poc/signed-url";
const preparationMediaPattern = /^\/api\/admin\/oss-preparations\/([^/]+)\/media$/;
const publicMediaPattern = /^\/api\/oss-playback\/([^/]+)\/media$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function notifyClients(payload) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const client of clients) {
    client.postMessage({ source: "wwpdw-oss-playback-poc", ...payload });
  }
}

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  const preparationMatch = requestUrl.pathname.match(preparationMediaPattern);
  const publicMatch = requestUrl.pathname.match(publicMediaPattern);
  if (
    event.request.method !== "GET"
    || requestUrl.origin !== self.location.origin
    || (requestUrl.pathname !== virtualMediaPath && !preparationMatch && !publicMatch)
  ) {
    return;
  }

  event.respondWith((async () => {
    const range = event.request.headers.get("range");
    const currentSignedUrlPath = preparationMatch
      ? `/api/admin/oss-preparations/${preparationMatch[1]}/signed-url`
      : publicMatch
        ? `/api/oss-playback/${publicMatch[1]}/signed-url`
        : signedUrlPath;
    try {
      const signedResponse = await fetch(currentSignedUrlPath, {
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (!signedResponse.ok) {
        throw new Error(`签名接口返回 ${signedResponse.status}`);
      }
      const { url } = await signedResponse.json();
      if (typeof url !== "string" || !url.startsWith("https://")) {
        throw new Error("签名接口没有返回有效的 HTTPS 地址");
      }

      const upstreamHeaders = new Headers();
      if (range) upstreamHeaders.set("Range", range);
      const upstream = await fetch(url, {
        cache: "no-store",
        headers: upstreamHeaders,
        mode: "cors"
      });
      const originalDisposition = upstream.headers.get("content-disposition");
      const originalForceDownload = upstream.headers.get("x-oss-force-download");
      const contentRange = upstream.headers.get("content-range");
      await notifyClients({
        contentRange,
        forceDownload: originalForceDownload,
        phase: "upstream",
        range,
        status: upstream.status
      });

      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.delete("content-disposition");
      responseHeaders.delete("x-oss-force-download");
      responseHeaders.set("accept-ranges", "bytes");
      responseHeaders.set("cache-control", "no-store");
      responseHeaders.set("content-type", "video/mp4");

      if (!upstream.ok) {
        await notifyClients({
          error: `国内线路返回 ${upstream.status}`,
          originalDisposition,
          phase: "error"
        });
      }
      return new Response(upstream.body, {
        headers: responseHeaders,
        status: upstream.status,
        statusText: upstream.statusText
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "国内线路播放适配失败";
      await notifyClients({ error: message, phase: "error", range });
      return new Response(message, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8"
        },
        status: 502
      });
    }
  })());
});
