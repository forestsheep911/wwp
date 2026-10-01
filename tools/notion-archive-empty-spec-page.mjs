#!/usr/bin/env node
import { config, projectEnv } from "./lib/project-secrets.mjs";
import fs from "node:fs";
import https from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";
import nodeFetch from "node-fetch";
import { installNotionDnsOverride } from "./lib/notion-network.mjs";
import { pageTitle } from "./lib/notion-workflow-handoff.mjs";

function loadDotEnv() { config(); }

function parseArgs(argv) {
  const options = { apply: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (["--page-id", "--parent-page-id", "--expected-title", "--local-address"].includes(arg)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      options[arg.slice(2).replaceAll("-", "_")] = value;
    } else if (arg === "--apply") options.apply = true;
    else if (arg === "--json") options.json = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  for (const [key, flag] of [["page_id", "--page-id"], ["parent_page_id", "--parent-page-id"], ["expected_title", "--expected-title"]]) {
    if (!options[key]) throw new Error(`${flag} is required`);
  }
  return options;
}

function compactId(value) {
  return String(value ?? "").replaceAll("-", "").toLowerCase();
}

export function archiveEmptySpecDecision(page, children, { parentPageId, expectedTitle }) {
  const observedTitle = pageTitle(page);
  if (observedTitle !== expectedTitle) {
    throw new Error(`Spec page title mismatch: expected "${expectedTitle}", observed "${observedTitle}"`);
  }
  if (page?.parent?.type !== "page_id" || compactId(page.parent.page_id) !== compactId(parentPageId)) {
    throw new Error(`Spec page parent mismatch for ${page?.id ?? "(unknown)"}`);
  }
  if (page.archived || page.in_trash) return { action: "already_archived", observedTitle, childCount: children.length };
  if (children.length > 0) {
    throw new Error(`Spec page is not empty; refusing to archive ${children.length} child block(s)`);
  }
  return { action: "archive", observedTitle, childCount: 0 };
}

async function listAllChildren(notion, blockId) {
  const rows = [];
  let startCursor;
  do {
    const response = await notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: startCursor });
    rows.push(...(response.results ?? []));
    startCursor = response.has_more ? response.next_cursor : undefined;
  } while (startCursor);
  return rows;
}

async function main() {
  loadDotEnv();
  const options = parseArgs(process.argv.slice(2));
  const token = options.apply
    ? process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN
    : process.env.NOTION_READ_ONLY_TOKEN || process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN;
  if (!token) throw new Error("A Notion token is required");
  installNotionDnsOverride(process.env.NOTION_API_RESOLVE_IP);
  const clientOptions = { auth: token, timeoutMs: Number(process.env.NOTION_REQUEST_TIMEOUT_MS ?? 120000) };
  let lastRequestAt = 0;
  let queue = Promise.resolve();
  clientOptions.fetch = (...args) => {
    const request = queue.then(async () => {
      const waitMs = Math.max(0, 1000 - (Date.now() - lastRequestAt));
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      lastRequestAt = Date.now();
      return nodeFetch(...args);
    });
    queue = request.then(() => undefined, () => undefined);
    return request;
  };
  if (options.local_address) clientOptions.agent = new https.Agent({ keepAlive: true, localAddress: options.local_address });
  const notion = new Client(clientOptions);
  const page = await notion.pages.retrieve({ page_id: options.page_id });
  const children = await listAllChildren(notion, page.id);
  const decision = archiveEmptySpecDecision(page, children, {
    parentPageId: options.parent_page_id,
    expectedTitle: options.expected_title
  });
  if (options.apply && decision.action === "archive") {
    await notion.pages.update({ page_id: page.id, archived: true });
    const readback = await notion.pages.retrieve({ page_id: page.id });
    if (!readback.archived && !readback.in_trash) throw new Error("Archived page readback failed");
  }
  const result = { mode: options.apply ? "apply" : "dry-run", pageId: page.id, ...decision };
  process.stdout.write(`${options.json ? JSON.stringify(result) : JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
