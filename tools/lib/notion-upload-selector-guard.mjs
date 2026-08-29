import { createClashController, inspectNotionRouteTopology } from "./clash-notion-route.mjs";

const NOTION_SELECTOR = "Notion";
const DIRECT_MEMBER = "国内直连";

function selector(proxies, name) {
  const value = proxies[name];
  if (!value || value.type !== "Selector") {
    throw new Error(`Required Clash selector is missing: ${name}`);
  }
  return value;
}

export function createNotionUploadSelectorGuard({
  envLookup = (name) => process.env[name],
  controller = createClashController({ secret: process.env.CLASH_CONTROLLER_SECRET || "" })
} = {}) {
  const expectedRoute = String(envLookup("NOTION_UPLOAD_EXPECTED_ROUTE") || "").trim();
  if (expectedRoute && !["direct", "jms-s801"].includes(expectedRoute)) {
    throw new Error(`Unsupported NOTION_UPLOAD_EXPECTED_ROUTE: ${expectedRoute}`);
  }

  return {
    expectedRoute: expectedRoute || null,
    async assert(label = "upload") {
      if (!expectedRoute) return { enabled: false, label };
      const proxies = await controller.proxies();
      const notion = selector(proxies, NOTION_SELECTOR);
      if (expectedRoute === "direct") {
        if (notion.now !== DIRECT_MEMBER) {
          throw new Error(
            `${label} route selector changed: expected ${NOTION_SELECTOR} -> ${DIRECT_MEMBER}, observed ${notion.now ?? "(none)"}`
          );
        }
        return { enabled: true, expectedRoute, chain: [NOTION_SELECTOR, DIRECT_MEMBER] };
      }

      const topology = inspectNotionRouteTopology(proxies, { requireS801: expectedRoute === "jms-s801" });
      if (notion.now !== topology.jmsSelector
        || topology.selectors[topology.jmsSelector] !== topology.s801Member) {
        throw new Error(
          `${label} route selector changed: expected ${NOTION_SELECTOR} -> ${topology.jmsSelector} -> ${topology.s801Member}; `
          + `observed ${NOTION_SELECTOR} -> ${notion.now ?? "(none)"}, ${topology.jmsSelector} -> ${topology.selectors[topology.jmsSelector] ?? "(none)"}`
        );
      }
      return {
        enabled: true,
        expectedRoute,
        chain: [NOTION_SELECTOR, topology.jmsSelector, topology.s801Member]
      };
    }
  };
}
