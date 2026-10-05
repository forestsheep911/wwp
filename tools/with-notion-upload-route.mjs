import { spawn } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { createClashController, inspectNotionRouteTopology, resolveControllerConnection, withTemporaryNotionRoute } from "./lib/clash-notion-route.mjs";

function usage() {
  console.log(`Usage:
  node tools/with-notion-upload-route.mjs --inspect
  node tools/with-notion-upload-route.mjs --route direct --apply -- <command> [args...]
  node tools/with-notion-upload-route.mjs --route jms-s801 --reason <text> --apply -- <command> [args...]

Options:
  --controller-pipe <path>  Defaults to the Clash Verge named pipe.
  --controller-url <url>    Optional HTTP controller instead of the named pipe.
  --inspect                 Read topology only; never changes a selector.
  --reason <text>           Required audit reason for a temporary jms-s801 batch.
  --apply                   Required before a child command may change selectors.`);
}

export function parseArgs(argv) {
  const separator = argv.indexOf("--");
  const own = separator >= 0 ? argv.slice(0, separator) : argv;
  const command = separator >= 0 ? argv.slice(separator + 1) : [];
  const options = { route: "direct", apply: false, inspect: false, command };
  for (let index = 0; index < own.length; index += 1) {
    const arg = own[index];
    if (arg === "--route") options.route = own[++index];
    else if (arg === "--reason") options.reason = own[++index];
    else if (arg === "--controller-pipe") options.controllerPipe = own[++index];
    else if (arg === "--controller-url") options.controllerUrl = own[++index];
    else if (arg === "--inspect") options.inspect = true;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function runChild(command, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: "inherit", env });
    const forward = (signal) => { if (!child.killed) child.kill(signal); };
    process.once("SIGINT", forward);
    process.once("SIGTERM", forward);
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      process.removeListener("SIGINT", forward);
      process.removeListener("SIGTERM", forward);
      if (signal) reject(new Error(`Upload command terminated by ${signal}`));
      else resolve(code ?? 1);
    });
  });
}

export function childEnvironment(options, baseEnv = process.env) {
  const connection = resolveControllerConnection({ socketPath: options.controllerPipe, controllerUrl: options.controllerUrl }, baseEnv);
  return {
    ...baseEnv,
    CLASH_CONTROLLER_PIPE: connection.socketPath || "",
    CLASH_CONTROLLER_URL: connection.controllerUrl || "",
    CLASH_CONTROLLER_SECRET: connection.secret,
    NOTION_UPLOAD_EXPECTED_ROUTE: options.route,
    NOTION_UPLOAD_ROUTE_REASON: options.reason?.trim() || ""
  };
}

export function validateRunOptions(options) {
  if (!options.apply) throw new Error("--apply is required before changing Clash selectors");
  if (options.command.length === 0) throw new Error("A child command is required after --");
  if (options.route === "jms-s801" && !options.reason?.trim()) {
    throw new Error("--reason <text> is required for a temporary jms-s801 batch");
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { usage(); return; }
  const controller = createClashController({
    socketPath: options.controllerPipe,
    controllerUrl: options.controllerUrl,
    secret: process.env.CLASH_CONTROLLER_SECRET || ""
  });
  if (options.inspect) {
    console.log(JSON.stringify({ controller: controller.endpoint, ...inspectNotionRouteTopology(await controller.proxies()) }, null, 2));
    return;
  }
  validateRunOptions(options);

  let exitCode = 1;
  await withTemporaryNotionRoute(controller, options.route, async ({ topology, saved }) => {
    console.log(`temporary Notion route: ${options.route}`);
    console.log(`saved selectors: Notion=${saved.Notion}; ${topology.jmsSelector}=${saved[topology.jmsSelector]}`);
    if (options.reason) console.log(`temporary route reason: ${options.reason.trim()}`);
    exitCode = await runChild(options.command, childEnvironment(options));
  });
  console.log("Clash selectors restored and verified");
  process.exitCode = exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
  });
}
