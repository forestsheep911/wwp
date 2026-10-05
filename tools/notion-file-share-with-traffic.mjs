#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveControllerConnection } from "./lib/clash-notion-route.mjs";
import { config as loadDotenv } from "dotenv";
import { resolveSecretReferences } from "./lib/project-secrets.mjs";
import { createVpnTrafficMonitor } from "./lib/vpn-traffic-monitor.mjs";

export function uploadedBytesFromState(state) {
  const fileBytes = Number(state?.file?.bytes ?? 0);
  const partBytes = Number(state?.plan?.partBytes ?? 0);
  const sentParts = state?.upload?.sentParts ?? [];
  if (!Number.isSafeInteger(fileBytes) || fileBytes <= 0 || !Number.isSafeInteger(partBytes) || partBytes <= 0) return 0;
  return [...new Set(sentParts.map(Number))].reduce((total, part) => {
    if (!Number.isInteger(part) || part < 1) return total;
    return total + Math.max(0, Math.min(partBytes, fileBytes - ((part - 1) * partBytes)));
  }, 0);
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? "" : "";
}

export function trafficReportPath(statePath, now = new Date()) {
  const primary = `${statePath}.vpn-traffic.json`;
  return fs.existsSync(primary)
    ? `${statePath}.${now.toISOString().replaceAll(/[:.]/gu, "-")}.vpn-traffic.json`
    : primary;
}

async function main() {
  const separator = process.argv.indexOf("--");
  const childArgs = separator >= 0 ? process.argv.slice(separator + 1) : [];
  if (!childArgs.length) throw new Error("Pass the global uploader command after --.");

  const statePath = path.resolve(optionValue(childArgs, "--state"));
  const filePath = path.resolve(optionValue(childArgs, "--file"));
  if (!optionValue(childArgs, "--state") || !optionValue(childArgs, "--file")) {
    throw new Error("The wrapped uploader requires explicit --state and --file paths.");
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error(`Upload file not found: ${filePath}`);
  const existingState = fs.existsSync(statePath)
    ? JSON.parse(fs.readFileSync(statePath, "utf8"))
    : null;
  let creditedBytes = uploadedBytesFromState(existingState);
  const remainingBytes = Math.max(0, fs.statSync(filePath).size - creditedBytes);

  loadDotenv({ quiet: true });
  const trafficEnv = {
    VPN_TRAFFIC_CHECK_LABEL: process.env.VPN_TRAFFIC_CHECK_LABEL,
    VPN_TRAFFIC_CHECK_LABEL_2: process.env.VPN_TRAFFIC_CHECK_LABEL_2,
    VPN_TRAFFIC_CHECK_INTERVAL_SECONDS: process.env.VPN_TRAFFIC_CHECK_INTERVAL_SECONDS,
    NOTION_UPLOAD_EXPECTED_ROUTE: process.env.NOTION_UPLOAD_EXPECTED_ROUTE
  };
  const missingTrafficRefs = [];
  for (const name of ["VPN_TRAFFIC_CHECK_URL", "VPN_TRAFFIC_CHECK_URL_2"]) {
    if (process.env[name]) {
      trafficEnv[name] = process.env[name];
      continue;
    }
    const reference = process.env[`${name}__KEY_VAULT`];
    if (!reference) continue;
    const isolated = { [`${name}__KEY_VAULT`]: reference };
    try {
      resolveSecretReferences(isolated);
      trafficEnv[name] = isolated[name];
    } catch {
      missingTrafficRefs.push(name);
    }
  }
  if (missingTrafficRefs.length) {
    console.warn(`VPN traffic monitor unavailable for configured counter(s): ${missingTrafficRefs.join(", ")}; DIRECT route proof remains mandatory.`);
  }
  const trafficMonitor = createVpnTrafficMonitor({
    envLookup: (name) => trafficEnv[name],
    reportPath: trafficReportPath(statePath)
  });
  await trafficMonitor.start({
    totalUploadBytes: remainingBytes,
    uploader: "global-notion-file-sharing",
    statePath,
    resumeBytes: creditedBytes,
    resumeParts: existingState?.upload?.sentParts?.length ?? 0
  });

  const syncProgress = async () => {
    if (!fs.existsSync(statePath)) return;
    let state;
    try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); }
    catch { return; }
    const acceptedBytes = uploadedBytesFromState(state);
    if (acceptedBytes > creditedBytes) {
      const delta = acceptedBytes - creditedBytes;
      creditedBytes = acceptedBytes;
      await trafficMonitor.noteUploaded(delta, {
        uploader: "global-notion-file-sharing",
        sentParts: state.upload?.sentParts?.length ?? 0,
        partCount: state.plan?.partCount ?? null
      });
    }
  };

  const [executable, ...args] = childArgs;
  const connection = resolveControllerConnection({
    socketPath: optionValue(childArgs, "--clash-pipe"), controllerUrl: optionValue(childArgs, "--clash-url")
  });
  const child = spawn(executable, args, { stdio: "inherit", windowsHide: true, env: {
    ...process.env, CLASH_CONTROLLER_PIPE: connection.socketPath || "",
    CLASH_CONTROLLER_URL: connection.controllerUrl || "", CLASH_CONTROLLER_SECRET: connection.secret
  } });
  const timer = setInterval(() => { void syncProgress().catch((error) => console.error(`traffic progress monitor: ${error.message}`)); }, 30_000);
  const exit = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code: code ?? (signal ? 1 : 0), signal }));
  }).finally(() => clearInterval(timer));

  await syncProgress();
  await trafficMonitor.finish({
    uploader: "global-notion-file-sharing",
    sentBytes: creditedBytes,
    exitCode: exit.code,
    signal: exit.signal ?? null
  });
  process.exitCode = exit.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
