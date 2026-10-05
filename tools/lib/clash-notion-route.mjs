import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

const DEFAULT_PIPE = "\\\\.\\pipe\\verge-mihomo";
const NOTION_SELECTOR = "Notion";
const DIRECT_MEMBER = "国内直连";
const JMS_SELECTOR = "JMS London 节点";

function runningControllerPipe(configuredPipe, options) {
  if (process.platform !== "win32" && options.pipeNames == null) return configuredPipe;
  const names = options.pipeNames ?? fs.readdirSync("\\\\.\\pipe\\");
  if (names.includes(path.win32.basename(configuredPipe))) return configuredPipe;
  const candidates = names.filter((name) => /^verge-mihomo(?:-|$)/u.test(name));
  if (candidates.length !== 1) {
    throw new Error(`Clash configured controller pipe is absent; discovered ${candidates.length} running core pipes. Specify CLASH_CONTROLLER_PIPE after identifying the active core.`);
  }
  return `\\\\.\\pipe\\${candidates[0]}`;
}

export function resolveControllerConnection(options = {}, env = process.env) {
  const explicitPipe = options.socketPath || (!options.controllerUrl && !env.CLASH_CONTROLLER_URL ? env.CLASH_CONTROLLER_PIPE : "");
  const explicitUrl = options.controllerUrl || (!options.socketPath ? env.CLASH_CONTROLLER_URL : "");
  if (explicitPipe || explicitUrl) {
    return { socketPath: explicitUrl ? undefined : explicitPipe, controllerUrl: explicitUrl || undefined,
      secret: options.secret || env.CLASH_CONTROLLER_SECRET || "", source: "explicit" };
  }
  const configPath = env.CLASH_CONTROLLER_CONFIG || (env.APPDATA
    ? path.join(env.APPDATA, "io.github.clash-verge-rev.clash-verge-rev", "clash-verge.yaml") : "");
  if (configPath && fs.existsSync(configPath)) {
    let config;
    try { config = YAML.parse(fs.readFileSync(configPath, "utf8")); }
    catch { throw new Error("Cannot parse active Clash controller configuration; configuration contents are withheld"); }
    const socketPath = config?.["external-controller-pipe"];
    const address = config?.["external-controller"];
    if (socketPath || address) {
      if (address && !socketPath && !/^(?:127\.0\.0\.1|localhost|\[::1\]):\d+$/u.test(address)) {
        throw new Error("Discovered Clash HTTP controller must be loopback-only");
      }
      return { socketPath: socketPath ? runningControllerPipe(socketPath, options) : undefined,
        controllerUrl: socketPath ? undefined : `http://${address}`,
        secret: options.secret || env.CLASH_CONTROLLER_SECRET || config.secret || "",
        source: "active_generated_config" };
    }
    throw new Error("Active Clash generated configuration contains no controller endpoint");
  }
  return { socketPath: runningControllerPipe(DEFAULT_PIPE, options), secret: options.secret || env.CLASH_CONTROLLER_SECRET || "", source: "runtime_discovery" };
}

export function resolveControllerPipe(options = {}, env = process.env) {
  return resolveControllerConnection(options, env).socketPath;
}

function requestJson({ socketPath, controllerUrl, secret }, method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? "" : JSON.stringify(body);
    const url = controllerUrl ? new URL(pathname, controllerUrl) : null;
    const request = http.request({
      ...(url
        ? { hostname: url.hostname, port: url.port, path: url.pathname + url.search }
        : { socketPath: resolveControllerPipe({ socketPath }), path: pathname }),
      method,
      headers: {
        Accept: "application/json",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
        ...(secret ? { Authorization: `Bearer ${secret}` } : {})
      }
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`Clash controller ${method} ${pathname} returned HTTP ${response.statusCode}`));
          return;
        }
        if (!text.trim()) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`Clash controller ${method} ${pathname} returned invalid JSON`));
        }
      });
    });
    request.on("error", reject);
    request.setTimeout(5000, () => request.destroy(new Error("Clash controller request timed out")));
    if (payload) request.write(payload);
    request.end();
  });
}

export function createClashController(options = {}) {
  const connection = resolveControllerConnection(options);
  return {
    endpoint: { source: connection.source, socketPath: connection.socketPath, controllerUrl: connection.controllerUrl },
    async proxies() {
      const payload = await requestJson(connection, "GET", "/proxies");
      return payload?.proxies ?? {};
    },
    async select(group, member) {
      await requestJson(connection, "PUT", `/proxies/${encodeURIComponent(group)}`, { name: member });
    }
  };
}

function selector(proxies, name) {
  const value = proxies[name];
  if (!value || value.type !== "Selector" || !Array.isArray(value.all)) {
    throw new Error(`Required Clash selector is missing: ${name}`);
  }
  return { ...value, name };
}

function requireMember(group, member) {
  if (!group.all.includes(member)) {
    throw new Error(`Clash selector ${group.name} does not contain ${member}`);
  }
}

export function inspectNotionRouteTopology(proxies, { requireS801 = false } = {}) {
  const notion = selector(proxies, NOTION_SELECTOR);
  requireMember(notion, DIRECT_MEMBER);
  const jmsValue = proxies[JMS_SELECTOR];
  const jms = jmsValue?.type === "Selector" && Array.isArray(jmsValue.all)
    ? { ...jmsValue, name: JMS_SELECTOR }
    : null;
  if (requireS801) {
    requireMember(notion, JMS_SELECTOR);
    if (!jms) throw new Error(`Required Clash selector is missing: ${JMS_SELECTOR}`);
  }
  const s801Members = jms?.all.filter((name) => /(?:^|\s)s801(?:\s|$|-)/iu.test(name)) ?? [];
  if (requireS801 && s801Members.length !== 1) {
    throw new Error(`Expected exactly one s801 member in ${JMS_SELECTOR}; found ${s801Members.length}`);
  }
  return {
    selectors: {
      [NOTION_SELECTOR]: notion.now,
      ...(jms ? { [JMS_SELECTOR]: jms.now } : {})
    },
    directMember: DIRECT_MEMBER,
    jmsSelector: JMS_SELECTOR,
    s801Member: s801Members.length === 1 ? s801Members[0] : null,
    s801CandidateCount: s801Members.length
  };
}

async function verifySelections(controller, expected) {
  const proxies = await controller.proxies();
  for (const [group, member] of Object.entries(expected)) {
    const current = selector(proxies, group).now;
    if (current !== member) {
      throw new Error(`Clash selector readback failed for ${group}: expected ${member}, observed ${current ?? "(none)"}`);
    }
  }
}

async function selectAndVerify(controller, group, member) {
  const current = selector(await controller.proxies(), group);
  requireMember(current, member);
  if (current.now !== member) await controller.select(group, member);
  await verifySelections(controller, { [group]: member });
}

export async function withTemporaryNotionRoute(controller, route, callback) {
  if (!["direct", "jms-s801"].includes(route)) {
    throw new Error(`Unsupported temporary Notion route: ${route}`);
  }
  const topology = inspectNotionRouteTopology(await controller.proxies(), { requireS801: route === "jms-s801" });
  const saved = { ...topology.selectors };
  let mutationStarted = false;
  const changedGroups = new Set();
  let callbackError;
  try {
    if (route === "jms-s801") {
      mutationStarted = true;
      if (saved[JMS_SELECTOR] !== topology.s801Member) changedGroups.add(JMS_SELECTOR);
      await selectAndVerify(controller, JMS_SELECTOR, topology.s801Member);
      if (saved[NOTION_SELECTOR] !== JMS_SELECTOR) changedGroups.add(NOTION_SELECTOR);
      await selectAndVerify(controller, NOTION_SELECTOR, JMS_SELECTOR);
      await verifySelections(controller, {
        [NOTION_SELECTOR]: JMS_SELECTOR,
        [JMS_SELECTOR]: topology.s801Member
      });
    } else {
      mutationStarted = true;
      if (saved[NOTION_SELECTOR] !== DIRECT_MEMBER) changedGroups.add(NOTION_SELECTOR);
      await selectAndVerify(controller, NOTION_SELECTOR, DIRECT_MEMBER);
    }
    return await callback({ route, topology, saved });
  } catch (error) {
    callbackError = error;
    throw error;
  } finally {
    if (mutationStarted) {
      const restoreErrors = [];
      for (const [group, member] of [
        [NOTION_SELECTOR, saved[NOTION_SELECTOR]],
        [JMS_SELECTOR, saved[JMS_SELECTOR]]
      ]) {
        if (!changedGroups.has(group)) continue;
        try {
          await selectAndVerify(controller, group, member);
        } catch (error) {
          restoreErrors.push(error);
        }
      }
      if (restoreErrors.length) {
        const restoration = new AggregateError(restoreErrors, "Failed to restore Clash selector state");
        if (!callbackError) throw restoration;
        callbackError.cause = restoration;
      }
      if (restoreErrors.length === 0) await verifySelections(controller, saved);
    }
  }
}

export const clashNotionRouteDefaults = Object.freeze({
  pipe: DEFAULT_PIPE,
  notionSelector: NOTION_SELECTOR,
  directMember: DIRECT_MEMBER,
  jmsSelector: JMS_SELECTOR
});
