const serviceWorkerPath = "/oss-playback-sw.js?v=3";

function waitForController(timeoutMs = 10_000) {
  if (navigator.serviceWorker.controller) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      reject(new Error("播放适配器启动超时，请刷新页面后重试。"));
    }, timeoutMs);
    function onControllerChange() {
      window.clearTimeout(timer);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve();
    }
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
  });
}

export async function ensureOssPlaybackServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("当前浏览器不支持播放适配器。");
  }
  await navigator.serviceWorker.register(serviceWorkerPath, { scope: "/" });
  await navigator.serviceWorker.ready;
  await waitForController();
}
