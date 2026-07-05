import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import { Client } from "@notionhq/client";
import { HttpsProxyAgent } from "https-proxy-agent";
import nodeFetch from "node-fetch";

function parseArgs() {
  const options = {
    manifestPath: "",
    prefix: "【敬请期待】",
    reportPath: ".local-data/notion-title-prefix-cleanup.json",
    apply: false,
    resolveIp: ""
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? args[++index];
    if (name === "--manifest") options.manifestPath = value();
    else if (name === "--prefix") options.prefix = value();
    else if (name === "--report") options.reportPath = value();
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && !options.manifestPath) {
      options.manifestPath = arg;
    } else if (!arg.startsWith("-") && options.reportPath === ".local-data/notion-title-prefix-cleanup.json") {
      options.reportPath = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.manifestPath) throw new Error("Set --manifest.");
  if (!options.prefix) throw new Error("--prefix must be non-empty.");
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-title-prefix-cleanup.mjs --manifest .local-data/pages.json
  node tools/notion-title-prefix-cleanup.mjs --manifest .local-data/pages.json --prefix "【敬请期待】" --apply

The manifest may be an array or an object with an items array. Each item needs a
pageId. This tool only strips the configured prefix from Notion page titles; it
does not create Media Assets rows.
`);
}

function dotenv(name) {
  if (fs.existsSync(".env")) {
    for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match?.[1] === name) return match[2].trim();
    }
  }
  return process.env[name];
}

function installNotionDnsOverride(resolveIp) {
  const notionApiIp = resolveIp || dotenv("NOTION_API_RESOLVE_IP");
  if (!notionApiIp) return;
  const originalLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") return options(null, notionApiIp, 4);
      if (options?.all) return callback(null, [{ address: notionApiIp, family: 4 }]);
      return callback(null, notionApiIp, 4);
    }
    return originalLookup(hostname, options, callback);
  };
  console.log(`dns override: api.notion.com -> ${notionApiIp}`);
}

function createNotionClient(token) {
  const proxyUrl = dotenv("NOTION_PROXY_URL") || dotenv("HTTPS_PROXY") || dotenv("HTTP_PROXY");
  const options = { auth: token, timeoutMs: Number(dotenv("NOTION_REQUEST_TIMEOUT_MS") || 30000) };
  if (proxyUrl) {
    options.fetch = nodeFetch;
    options.agent = new HttpsProxyAgent(proxyUrl);
    console.log(`proxy: ${proxyUrl}`);
  }
  return new Client(options);
}

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? "").join("").trim();
}

function titlePropertyEntry(page) {
  return Object.entries(page.properties ?? {}).find(([, property]) => property.type === "title");
}

function cleanText(value = "") {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function richText(value) {
  const content = cleanText(String(value ?? ""));
  return content ? [{ text: { content: content.slice(0, 2000) } }] : [];
}

function normalizeManifest(manifest) {
  const items = Array.isArray(manifest) ? manifest : manifest.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("Manifest must be an array or an object with a non-empty items array.");
  }
  return items.map((item, index) => {
    if (!item.pageId) throw new Error(`Manifest item ${index + 1} is missing pageId.`);
    return {
      label: item.label || item.pageId,
      pageId: item.pageId,
      expectedTitleContains: Array.isArray(item.expectedTitleContains)
        ? item.expectedTitleContains
        : item.expectedTitleContains
          ? [item.expectedTitleContains]
          : []
    };
  });
}

function titleContainsExpected(title, expectedTitleContains) {
  const normalizedTitle = cleanText(title).toLowerCase();
  return expectedTitleContains.every((expected) => normalizedTitle.includes(cleanText(String(expected)).toLowerCase()));
}

async function processItem(notion, item, options) {
  const page = await notion.pages.retrieve({ page_id: item.pageId });
  const [titlePropertyName, titleProperty] = titlePropertyEntry(page) ?? [];
  if (!titlePropertyName) {
    return { label: item.label, pageId: item.pageId, action: "skip_no_title_property" };
  }

  const currentTitle = plainText(titleProperty.title);
  if (!titleContainsExpected(currentTitle, item.expectedTitleContains)) {
    return {
      label: item.label,
      pageId: item.pageId,
      action: "skip_title_mismatch",
      currentTitle,
      expectedTitleContains: item.expectedTitleContains
    };
  }

  if (!currentTitle.startsWith(options.prefix)) {
    return { label: item.label, pageId: item.pageId, action: "skip_prefix_absent", currentTitle };
  }

  const nextTitle = cleanText(currentTitle.slice(options.prefix.length));
  if (!nextTitle) {
    return { label: item.label, pageId: item.pageId, action: "skip_empty_next_title", currentTitle };
  }

  if (!options.apply) {
    return { label: item.label, pageId: item.pageId, action: "would_update", currentTitle, nextTitle };
  }

  await notion.pages.update({
    page_id: item.pageId,
    properties: {
      [titlePropertyName]: { title: richText(nextTitle) }
    }
  });

  return { label: item.label, pageId: item.pageId, action: "updated", currentTitle, nextTitle };
}

function summarize(actions) {
  return actions.reduce((summary, action) => {
    summary[action.action] = (summary[action.action] ?? 0) + 1;
    return summary;
  }, {});
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  if (!token) throw new Error("Set NOTION_WRITE_TOKEN or NOTION_TOKEN.");

  const manifest = JSON.parse(fs.readFileSync(options.manifestPath, "utf8"));
  const items = normalizeManifest(manifest);
  const notion = createNotionClient(token);
  const actions = [];

  for (const item of items) {
    actions.push(await processItem(notion, item, options));
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    manifestPath: options.manifestPath,
    prefix: options.prefix,
    summary: summarize(actions),
    actions
  };

  fs.mkdirSync(path.dirname(options.reportPath), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    reportPath: options.reportPath,
    summary: report.summary
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
