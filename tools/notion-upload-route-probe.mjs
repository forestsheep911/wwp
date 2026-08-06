#!/usr/bin/env node
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import dns from "node:dns";
import https from "node:https";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@notionhq/client";
import nodeFetch from "node-fetch";

const DEFAULT_PART_MIB = 20;
const CLASH_PIPE = "\\\\.\\pipe\\verge-mihomo";

function loadDotEnv() {
  if (!fs.existsSync(".env")) return;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
}

function parseArgs(argv) {
  const options = {
    file: "",
    parts: 3,
    partMiB: DEFAULT_PART_MIB,
    slowSeconds: 0,
    maxRestarts: 0,
    report: ".local-data/notion-upload-route-probe.json",
    complete: false,
    noResolveOverride: false,
    resolveIp: "",
    localAddress: ""
  };
  const valueArgs = new Set([
    "--file", "--parts", "--part-mib", "--slow-seconds", "--max-restarts", "--report", "--resolve-ip", "--local-address"
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (valueArgs.has(arg)) {
      const value = argv[++index];
      if (value == null) throw new Error(`${arg} requires a value`);
      if (arg === "--file") options.file = path.resolve(value);
      else if (arg === "--parts") options.parts = Number(value);
      else if (arg === "--part-mib") options.partMiB = Number(value);
      else if (arg === "--slow-seconds") options.slowSeconds = Number(value);
      else if (arg === "--max-restarts") options.maxRestarts = Number(value);
      else if (arg === "--report") options.report = path.resolve(value);
      else if (arg === "--resolve-ip") options.resolveIp = value;
      else if (arg === "--local-address") options.localAddress = value;
    } else if (arg === "--complete") {
      options.complete = true;
    } else if (arg === "--no-resolve-override") {
      options.noResolveOverride = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node tools/notion-upload-route-probe.mjs --file <path> [options]

Options:
  --parts <n>          Number of sequential parts to send (default: 3)
  --part-mib <n>       Part size in MiB (default: 20)
  --slow-seconds <n>   Close this process's Notion connection when an attempt exceeds n seconds
  --max-restarts <n>   Maximum connection restarts per part
  --no-resolve-override
                        Keep api.notion.com as a hostname so Clash domain rules can match
  --resolve-ip <ip>     Override api.notion.com DNS for a direct-route probe
  --local-address <ip>  Bind the direct probe to a physical local interface
  --complete           Complete the unattached FileUpload after all parts are sent
  --report <path>      JSON report path
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!options.file) throw new Error("--file is required");
  for (const [name, value] of Object.entries({
    parts: options.parts,
    partMiB: options.partMiB,
    slowSeconds: options.slowSeconds,
    maxRestarts: options.maxRestarts
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be zero or a positive number`);
  }
  if (options.parts < 1 || options.partMiB < 1) throw new Error("--parts and --part-mib must be positive");
  return options;
}

function installNotionDnsOverride(ip) {
  if (!ip) return;
  const originalLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return originalLookup(hostname, options, callback);
    if (typeof options === "function") return options(null, ip, 4);
    if (options?.all) return callback(null, [{ address: ip, family: 4 }]);
    return callback(null, ip, 4);
  };
}

async function clashRequest(method, requestPath) {
  return await new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: CLASH_PIPE,
      path: encodeURI(requestPath),
      method,
      headers: {
        Authorization: "Bearer set-your-secret",
        Connection: "close"
      }
    }, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("error", reject);
    request.end();
  });
}

async function notionConnections(startedAfter) {
  const response = await clashRequest("GET", "/connections");
  if (response.status !== 200) throw new Error(`Clash connections query failed: HTTP ${response.status}`);
  const payload = JSON.parse(response.body);
  return (payload.connections ?? []).filter(connection => {
    const metadata = connection.metadata ?? {};
    const startedAt = Date.parse(connection.start ?? "");
    const isNotionTarget = metadata.host === "api.notion.com"
      || metadata.destinationIP === process.env.NOTION_API_RESOLVE_IP;
    return isNotionTarget
      && String(metadata.process ?? "").toLowerCase() === "node.exe"
      && (!Number.isFinite(startedAt) || startedAt >= startedAfter - 2000);
  });
}

async function closeNotionConnections(startedAfter) {
  const connections = await notionConnections(startedAfter);
  const closed = [];
  for (const connection of connections) {
    const response = await clashRequest("DELETE", `/connections/${connection.id}`);
    if (response.status === 204) {
      closed.push({
        id: connection.id,
        chains: connection.chains ?? [],
        uploadedBytes: connection.upload ?? 0,
        destination: connection.metadata?.remoteDestination ?? connection.metadata?.destinationIP ?? ""
      });
    }
  }
  return closed;
}

async function connectionSnapshot(startedAfter) {
  const connections = await notionConnections(startedAfter);
  return connections.map(connection => ({
    id: connection.id,
    chains: connection.chains ?? [],
    uploadedBytes: connection.upload ?? 0,
    destination: connection.metadata?.remoteDestination ?? connection.metadata?.destinationIP ?? ""
  }));
}

async function readChunk(filePath, offset, length) {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const result = await handle.read(buffer, 0, length, offset);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

async function sendAttempt(notion, uploadId, fileName, part, data, slowSeconds, allowRestart) {
  const startedAt = Date.now();
  let restartTimer;
  let closed = [];
  if (allowRestart && slowSeconds > 0) {
    restartTimer = setTimeout(async () => {
      try {
        closed = await closeNotionConnections(startedAt);
      } catch (error) {
        closed = [{ error: error.message }];
      }
    }, slowSeconds * 1000);
  }
  let error = "";
  try {
    await notion.fileUploads.send({
      file_upload_id: uploadId,
      part_number: String(part),
      file: {
        filename: fileName,
        data: new Blob([data], { type: "video/mp4" })
      }
    });
  } catch (caught) {
    error = caught?.message ?? String(caught);
  } finally {
    if (restartTimer) clearTimeout(restartTimer);
  }
  const seconds = (Date.now() - startedAt) / 1000;
  return {
    seconds: Number(seconds.toFixed(3)),
    mibPerSecond: Number(((data.length / 1024 / 1024) / seconds).toFixed(3)),
    connections: await connectionSnapshot(startedAt).catch(() => []),
    closed,
    error
  };
}

async function main() {
  loadDotEnv();
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN;
  if (!token) throw new Error("NOTION_WRITE_TOKEN or NOTION_TOKEN is required");
  if (!fs.existsSync(options.file)) throw new Error(`File not found: ${options.file}`);
  const resolveIp = options.noResolveOverride ? "" : (options.resolveIp || process.env.NOTION_API_RESOLVE_IP || "");
  if (resolveIp) installNotionDnsOverride(resolveIp);

  const stat = fs.statSync(options.file);
  const partBytes = Math.floor(options.partMiB) * 1024 * 1024;
  const availableParts = Math.ceil(stat.size / partBytes);
  const partCount = Math.min(options.parts, availableParts);
  const filename = `notion-route-probe-${new Date().toISOString().replaceAll(/[:.]/gu, "-")}.mp4`;
  const notionOptions = { auth: token, timeoutMs: 600000 };
  if (options.localAddress) {
    notionOptions.fetch = nodeFetch;
    notionOptions.agent = new https.Agent({ keepAlive: true, localAddress: options.localAddress });
  }
  const notion = new Client(notionOptions);
  const upload = await notion.fileUploads.create({
    mode: "multi_part",
    filename,
    content_type: "video/mp4",
    number_of_parts: partCount
  });

  const report = {
    generatedAt: new Date().toISOString(),
    file: options.file,
    sourceBytes: stat.size,
    filename,
    fileUploadId: upload.id,
    expiryTime: upload.expiry_time,
    partMiB: options.partMiB,
    partCount,
    slowSeconds: options.slowSeconds,
    maxRestarts: options.maxRestarts,
    resolveOverride: resolveIp || null,
    localAddress: options.localAddress || null,
    attempts: [],
    status: "pending"
  };
  fs.mkdirSync(path.dirname(options.report), { recursive: true });

  for (let part = 1; part <= partCount; part += 1) {
    const offset = (part - 1) * partBytes;
    const length = Math.min(partBytes, stat.size - offset);
    const data = await readChunk(options.file, offset, length);
    let sent = false;
    for (let attempt = 1; attempt <= options.maxRestarts + 1; attempt += 1) {
      const result = await sendAttempt(
        notion,
        upload.id,
        filename,
        part,
        data,
        options.slowSeconds,
        attempt <= options.maxRestarts
      );
      report.attempts.push({ part, attempt, bytes: data.length, ...result });
      fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
      console.log(JSON.stringify(report.attempts.at(-1)));
      if (!result.error) {
        sent = true;
        break;
      }
      const state = await notion.fileUploads.retrieve({ file_upload_id: upload.id });
      if ((state.number_of_parts?.sent ?? 0) >= part) {
        report.attempts.at(-1).acceptedDespiteClientError = true;
        sent = true;
        break;
      }
      await sleep(1000);
    }
    if (!sent) throw new Error(`Part ${part} did not complete after ${options.maxRestarts + 1} attempts`);
    await sleep(250);
  }

  if (options.complete) {
    await notion.fileUploads.complete({ file_upload_id: upload.id });
    report.status = "uploaded_unattached";
  } else {
    report.status = "parts_sent_not_completed";
  }
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    report: options.report,
    status: report.status,
    attempts: report.attempts.length,
    expiryTime: report.expiryTime
  }));
}

main().catch(error => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
