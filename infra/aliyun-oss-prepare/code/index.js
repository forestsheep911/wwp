"use strict";

const { createWriteStream } = require("node:fs");
const { stat, unlink } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const OSS = require("ali-oss");

const minimumPartBytes = 100 * 1024;
const defaultPartBytes = 64 * 1024 * 1024;
const maximumPartCount = 10_000;

function requiredString(value, name) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function safeObjectKey(value, prefix) {
  const objectKey = requiredString(value, "objectKey").replace(/^\/+/, "");
  const normalizedPrefix = `${prefix.replace(/^\/+|\/+$/g, "")}/`;
  if (!objectKey.startsWith(normalizedPrefix) || objectKey.includes("..")) {
    throw new Error("objectKey is outside the configured preparation prefix.");
  }
  return objectKey;
}

function parseEvent(event) {
  if (Buffer.isBuffer(event)) event = event.toString("utf8");
  if (typeof event === "string") event = JSON.parse(event);
  if (!event || typeof event !== "object") throw new Error("A JSON event is required.");
  const sourceUrl = requiredString(event.sourceUrl, "sourceUrl");
  const source = new URL(sourceUrl);
  if (source.protocol !== "https:") throw new Error("sourceUrl must use HTTPS.");
  const prefix = process.env.ALIYUN_OSS_OBJECT_PREFIX || "wwpdw/prepared";
  return {
    jobId: requiredString(event.jobId, "jobId"),
    sourceUrl,
    objectKey: safeObjectKey(event.objectKey, prefix),
    title: typeof event.title === "string" ? event.title.slice(0, 300) : "",
    contentType: typeof event.contentType === "string" && event.contentType
      ? event.contentType
      : "video/mp4",
    expectedBytes: parsePositiveInteger(event.expectedBytes, undefined)
  };
}

function contentLengthFromRange(value) {
  const match = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(value || "");
  return match ? parsePositiveInteger(match[1], undefined) : undefined;
}

async function inspectSource(sourceUrl, expectedBytes, fetchImpl = fetch) {
  let contentType;
  try {
    const head = await fetchImpl(sourceUrl, { method: "HEAD", redirect: "follow" });
    if (head.ok) {
      const contentLength = parsePositiveInteger(head.headers.get("content-length"), undefined);
      contentType = head.headers.get("content-type") || undefined;
      if (contentLength) return { contentLength, contentType, rangeSupported: true };
    }
  } catch {
    // Some signed file endpoints reject HEAD. The range probe below is authoritative.
  }

  const probe = await fetchImpl(sourceUrl, {
    headers: { Range: "bytes=0-0" },
    redirect: "follow"
  });
  if (probe.status !== 206 && probe.status !== 200) {
    throw new Error(`Source probe returned HTTP ${probe.status}.`);
  }
  const contentLength = probe.status === 206
    ? contentLengthFromRange(probe.headers.get("content-range"))
    : parsePositiveInteger(probe.headers.get("content-length"), undefined);
  contentType ||= probe.headers.get("content-type") || undefined;
  await probe.body?.cancel();
  const resolvedLength = contentLength || expectedBytes;
  if (!resolvedLength) throw new Error("Source size could not be determined.");
  return {
    contentLength: resolvedLength,
    contentType,
    rangeSupported: probe.status === 206
  };
}

function createOssClient(context) {
  const credentials = context?.credentials || {};
  return new OSS({
    accessKeyId: requiredString(credentials.accessKeyId, "context.credentials.accessKeyId"),
    accessKeySecret: requiredString(credentials.accessKeySecret, "context.credentials.accessKeySecret"),
    stsToken: credentials.securityToken,
    bucket: requiredString(process.env.ALIYUN_OSS_BUCKET, "ALIYUN_OSS_BUCKET"),
    endpoint: process.env.ALIYUN_OSS_ENDPOINT,
    region: requiredString(process.env.ALIYUN_OSS_REGION, "ALIYUN_OSS_REGION"),
    secure: true
  });
}

function responseHeader(result, name) {
  const headers = result?.res?.headers || result?.res?.res?.headers || {};
  return headers[name] || headers[name.toLowerCase()];
}

async function existingObject(client, objectKey) {
  try {
    const result = await client.head(objectKey);
    return {
      contentLength: parsePositiveInteger(responseHeader(result, "content-length"), undefined),
      etag: responseHeader(result, "etag")
    };
  } catch (error) {
    if (error?.status === 404 || error?.statusCode === 404 || error?.code === "NoSuchKey") return undefined;
    throw error;
  }
}

async function downloadPart(fetchImpl, sourceUrl, start, endInclusive, tempPath) {
  const response = await fetchImpl(sourceUrl, {
    headers: { Range: `bytes=${start}-${endInclusive}` },
    redirect: "follow"
  });
  if (response.status !== 206 || !response.body) {
    await response.body?.cancel();
    throw new Error(`Source range ${start}-${endInclusive} returned HTTP ${response.status}.`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath, { flags: "wx" }));
  const downloaded = (await stat(tempPath)).size;
  const expected = endInclusive - start + 1;
  if (downloaded !== expected) {
    throw new Error(`Source range ${start}-${endInclusive} returned ${downloaded} of ${expected} bytes.`);
  }
}

async function copyToOss(input, sourceInfo, client, fetchImpl = fetch) {
  const existing = await existingObject(client, input.objectKey);
  if (existing?.contentLength === sourceInfo.contentLength) {
    return { alreadyReady: true, ...existing };
  }
  if (!sourceInfo.rangeSupported) {
    throw new Error("Source does not support byte ranges; large-file preparation cannot continue safely.");
  }

  const configuredPartBytes = Math.max(
    minimumPartBytes,
    parsePositiveInteger(process.env.OSS_MULTIPART_PART_BYTES, defaultPartBytes)
  );
  const partBytes = Math.max(
    configuredPartBytes,
    Math.ceil(sourceInfo.contentLength / maximumPartCount)
  );
  const init = await client.initMultipartUpload(input.objectKey, {
    mime: sourceInfo.contentType || input.contentType,
    meta: {
      "wwpdw-job-id": input.jobId,
      "wwpdw-source-size": String(sourceInfo.contentLength)
    }
  });
  const parts = [];
  let completed = false;

  try {
    for (let start = 0, partNo = 1; start < sourceInfo.contentLength; start += partBytes, partNo += 1) {
      const endInclusive = Math.min(sourceInfo.contentLength - 1, start + partBytes - 1);
      const tempPath = path.join(tmpdir(), `wwpdw-${input.jobId}-${partNo}.part`);
      try {
        await downloadPart(fetchImpl, input.sourceUrl, start, endInclusive, tempPath);
        const length = endInclusive - start + 1;
        const uploaded = await client.uploadPart(
          input.objectKey,
          init.uploadId,
          partNo,
          tempPath,
          0,
          length
        );
        parts.push({ number: partNo, etag: uploaded.etag });
        console.log(JSON.stringify({
          event: "oss_prepare.part_complete",
          jobId: input.jobId,
          part: partNo,
          progress: Math.round(((endInclusive + 1) / sourceInfo.contentLength) * 100)
        }));
      } finally {
        await unlink(tempPath).catch(() => undefined);
      }
    }
    const result = await client.completeMultipartUpload(input.objectKey, init.uploadId, parts, {
      headers: {
        "Content-Disposition": "inline",
        "Content-Type": sourceInfo.contentType || input.contentType
      }
    });
    completed = true;
    const finalObject = await existingObject(client, input.objectKey);
    if (finalObject?.contentLength !== sourceInfo.contentLength) {
      throw new Error("OSS object size does not match the source after multipart completion.");
    }
    return { alreadyReady: false, etag: result.etag, ...finalObject };
  } finally {
    if (!completed) {
      await client.abortMultipartUpload(input.objectKey, init.uploadId).catch(() => undefined);
    }
  }
}

async function prepare(event, context, dependencies = {}) {
  const input = parseEvent(event);
  const fetchImpl = dependencies.fetch || fetch;
  const client = dependencies.client || createOssClient(context);
  console.log(JSON.stringify({
    event: "oss_prepare.started",
    jobId: input.jobId,
    objectKey: input.objectKey
  }));
  const sourceInfo = await inspectSource(input.sourceUrl, input.expectedBytes, fetchImpl);
  const copied = await copyToOss(input, sourceInfo, client, fetchImpl);
  const output = {
    ok: true,
    jobId: input.jobId,
    objectKey: input.objectKey,
    contentLength: sourceInfo.contentLength,
    contentType: sourceInfo.contentType || input.contentType,
    etag: copied.etag,
    alreadyReady: copied.alreadyReady
  };
  console.log(JSON.stringify({ event: "oss_prepare.completed", ...output }));
  return output;
}

exports.handler = async function handler(event, context) {
  return prepare(event, context);
};

exports.__test = {
  contentLengthFromRange,
  copyToOss,
  inspectSource,
  parseEvent,
  prepare,
  safeObjectKey
};
