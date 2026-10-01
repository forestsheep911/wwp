import { projectEnv } from "./lib/project-secrets.mjs";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns";
import https from "node:https";
import { Client } from "@notionhq/client";
import nodeFetch from "node-fetch";
import {
  visibilityHideReasonIsConcrete,
  workVisibilityHideReasonIsConcrete
} from "./lib/notion-workflow-handoff.mjs";

function parseArgs(argv = process.argv.slice(2)) {
  const options = { workPage: "", sourcePages: [], hidden: null, reason: "", updateWork: false, report: ".local-data/notion-media-assets-visibility.json", resolveIp: "", localAddress: "", apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const [name, inline] = argv[index].split(/=(.*)/s);
    const value = () => inline ?? argv[++index];
    if (name === "--work-page") options.workPage = value();
    else if (name === "--source-page") options.sourcePages.push(value());
    else if (name === "--hidden") options.hidden = value() === "true";
    else if (name === "--reason") options.reason = value();
    else if (name === "--update-work") options.updateWork = true;
    else if (name === "--report") options.report = value();
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (name === "--local-address") options.localAddress = value();
    else if (name === "--apply") options.apply = true;
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!options.workPage || options.sourcePages.length === 0 || options.hidden === null) {
    throw new Error("--work-page, one or more --source-page, and --hidden true|false are required.");
  }
  const hideReasonIsConcrete = options.updateWork
    ? workVisibilityHideReasonIsConcrete(options.reason)
    : visibilityHideReasonIsConcrete(options.reason);
  if (options.hidden === true && !hideReasonIsConcrete) {
    throw new Error("--hidden true requires --reason with a concrete viewing, structure, Media Assets, or explicit human-hold reason; metadata follow-up is not a hiding reason.");
  }
  if (new Set(options.sourcePages).size !== options.sourcePages.length) throw new Error("--source-page values must be unique.");
  return options;
}

function dotenv(name) { return projectEnv(name); }

function installNotionDnsOverride(resolveIp) {
  const ip = resolveIp || dotenv("NOTION_API_RESOLVE_IP");
  if (!ip) return;
  const lookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname === "api.notion.com") {
      if (typeof options === "function") return options(null, ip, 4);
      if (options?.all) return callback(null, [{ address: ip, family: 4 }]);
      return callback(null, ip, 4);
    }
    return lookup(hostname, options, callback);
  };
}

function richText(property) {
  return property?.rich_text?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
}

function title(page) {
  return page.properties?.Name?.title?.map((item) => item.plain_text ?? "").join("").trim() ?? "";
}

async function main() {
  const options = parseArgs();
  installNotionDnsOverride(options.resolveIp);
  const token = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN");
  if (!token) throw new Error("Set NOTION_WRITE_TOKEN or NOTION_TOKEN.");
  const clientOptions = { auth: token, timeoutMs: Number(dotenv("NOTION_REQUEST_TIMEOUT_MS") || 30000) };
  if (options.localAddress) {
    clientOptions.fetch = nodeFetch;
    clientOptions.agent = new https.Agent({ keepAlive: true, localAddress: options.localAddress });
  }
  const notion = new Client(clientOptions);
  const dataSourceId = dotenv("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID");
  if (!dataSourceId) throw new Error("NOTION_MEDIA_ASSETS_DATA_SOURCE_ID is required.");
  const response = await notion.dataSources.query({
    data_source_id: dataSourceId,
    page_size: 100,
    filter: { property: "Work", relation: { contains: options.workPage } }
  });
  if (response.has_more) throw new Error("Exact Work query returned more than 100 Media Assets; refusing visibility update.");
  const expectedSources = new Set(options.sourcePages);
  const matching = response.results.filter((page) => expectedSources.has(richText(page.properties?.["Source Page ID"])));
  const actualSources = new Set(matching.map((page) => richText(page.properties?.["Source Page ID"])));
  const missingSources = options.sourcePages.filter((id) => !actualSources.has(id));
  const unexpectedSources = matching.filter((page) => !expectedSources.has(richText(page.properties?.["Source Page ID"]))).map((page) => page.id);
  if (missingSources.length || unexpectedSources.length || matching.length !== options.sourcePages.length) {
    throw new Error(`Asset-source guard failed: expected=${options.sourcePages.length} found=${matching.length} missing=${missingSources.length} unexpected=${unexpectedSources.length}`);
  }
  const actions = matching.map((page) => ({ pageId: page.id, title: title(page), sourcePageId: richText(page.properties?.["Source Page ID"]), before: page.properties?.["Hide from Website"]?.checkbox ?? null, after: options.hidden }));
  if (options.apply) {
    for (const action of actions) {
      await notion.pages.update({ page_id: action.pageId, properties: { "Hide from Website": { checkbox: options.hidden } } });
      const readback = await notion.pages.retrieve({ page_id: action.pageId });
      if (readback.properties?.["Hide from Website"]?.checkbox !== options.hidden) throw new Error(`Visibility readback failed for ${action.pageId}`);
    }
  }
  let workAction = null;
  if (options.updateWork) {
    const work = await notion.pages.retrieve({ page_id: options.workPage });
    workAction = { pageId: work.id, before: work.properties?.["Hide from Website"]?.checkbox ?? null, after: options.hidden };
    if (options.apply) {
      await notion.pages.update({ page_id: work.id, properties: {
        "Hide from Website": { checkbox: options.hidden }
      } });
      const readback = await notion.pages.retrieve({ page_id: work.id });
      if (readback.properties?.["Hide from Website"]?.checkbox !== options.hidden) {
        throw new Error(`Work visibility readback failed for ${work.id}`);
      }
    }
  }
  const report = { generatedAt: new Date().toISOString(), apply: options.apply, workPageId: options.workPage, hidden: options.hidden, reason: options.reason || null, actions, workAction };
  fs.mkdirSync(path.dirname(path.resolve(options.report)), { recursive: true });
  fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ report: options.report, apply: options.apply, matched: actions.length, changed: options.apply ? actions.length : 0 }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
