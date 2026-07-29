import "../apps/api/src/env.js";
import { randomUUID } from "node:crypto";

import { AliyunFcPrepare } from "../apps/api/src/aliyun-fc-prepare.js";
import { createAliyunOssPoc } from "../apps/api/src/aliyun-oss-poc.js";
import { AliyunOssStorage } from "../apps/api/src/aliyun-oss-storage.js";

const poc = createAliyunOssPoc();
if (!poc.status().enabled) {
  throw new Error(poc.status().reason ?? "OSS playback POC is not enabled.");
}

const fc = new AliyunFcPrepare();
const storage = new AliyunOssStorage();
const jobId = randomUUID();
const objectKey = `wwpdw/prepared/smoke-${jobId}.mp4`;
const { url: sourceUrl } = poc.createSignedUrl();
const { taskId } = await fc.invoke({
  jobId,
  objectKey,
  sourceUrl,
  title: "WWPDW FC3 smoke test",
  contentType: "video/mp4"
});

console.log(JSON.stringify({ event: "smoke.invoked", taskId, objectKey }));
const deadline = Date.now() + 5 * 60_000;
let lastStatus = "";
while (Date.now() < deadline) {
  const task = await fc.getTask(taskId);
  if (task.status !== lastStatus) {
    console.log(JSON.stringify({ event: "smoke.status", taskId, status: task.status }));
    lastStatus = task.status;
  }
  if (task.status === "Succeeded") {
    const object = await storage.head(objectKey);
    if (!object?.contentLength) throw new Error("FC task succeeded but the OSS object is missing.");
    console.log(JSON.stringify({
      event: "smoke.verified",
      taskId,
      contentLength: object.contentLength,
      contentType: object.contentType
    }));
    await storage.delete(objectKey);
    console.log(JSON.stringify({ event: "smoke.cleaned", objectKey }));
    process.exit(0);
  }
  if (["Failed", "Stopped", "Invalid", "Expired"].includes(task.status)) {
    throw new Error(`FC smoke task ended with ${task.status}: ${task.error ?? "no detail"}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
}
throw new Error("FC smoke task did not finish within five minutes.");
