#!/usr/bin/env node
import "./lib/project-env.mjs";
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { Client } from "@notionhq/client";
import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { createPacedFetch } from "./lib/notion-request-limiter.mjs";
import { installNotionDnsOverride } from "./lib/notion-network.mjs";

const args = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (!["--work-page", "--report", "--resolve-ip", "--local-address"].includes(args[i])) throw new Error(`Unknown option ${args[i]}`);
  options[args[i].slice(2)] = args[++i];
}
if (!options["work-page"] || !options.report) throw new Error("--work-page and --report are required");
if (Boolean(options["resolve-ip"]) !== Boolean(options["local-address"])) throw new Error("--resolve-ip and --local-address must be paired");
if (options["resolve-ip"]) installNotionDnsOverride(options["resolve-ip"]);
const proxy = process.env.NOTION_PROXY_URL;
const agent = options["local-address"] ? new https.Agent({localAddress: options["local-address"]}) : proxy ? new HttpsProxyAgent(proxy) : undefined;
const client = new Client({
  auth: process.env.NOTION_WRITE_TOKEN || process.env.NOTION_TOKEN || process.env.NOTION_API_KEY,
  fetch: createPacedFetch((url, init) => fetch(url, { ...init, agent }), { minIntervalMs: 1100 })
});
const workId = options["work-page"];
const work = await client.pages.retrieve({ page_id: workId });
const text = (property) => (property?.title || property?.rich_text || []).map(t => t.plain_text || t.text?.content || "").join("");
const assets = [];
let cursor;
do {
  const page = await client.dataSources.query({ data_source_id: process.env.NOTION_MEDIA_ASSETS_DATA_SOURCE_ID,
    filter: { property: "Work", relation: { contains: workId } }, page_size: 100, ...(cursor ? {start_cursor: cursor} : {}) });
  for (const row of page.results) {
    const p = row.properties;
    assets.push({ id: row.id, assetType: p["Asset Type"]?.select?.name, label: text(p["Display Label"]), sourcePageId: text(p["Source Page ID"]),
      mediaBlockId: text(p["Media Block ID"]), bytesGb: p["Approx Size GB"]?.number,
      playbackVerified: p["Playback Verified"]?.checkbox === true, hidden: p["Hide from Website"]?.checkbox === true,
      subtitleLanguages: (p["Subtitle Languages"]?.multi_select || []).map(v => v.name) });
  }
  cursor = page.has_more ? page.next_cursor : null;
} while (cursor);
// Verify recorded blocks rather than trusting a stale ledger or asset row.
for (const asset of assets) {
  if (!asset.mediaBlockId) { asset.blockVerified = false; continue; }
  try {
    const block = await client.blocks.retrieve({ block_id: asset.mediaBlockId });
    asset.blockVerified = !block.archived && ["video", "file"].includes(block.type)
      && block.parent?.page_id?.replaceAll("-", "") === asset.sourcePageId.replaceAll("-", "");
  } catch (error) {
    if (error.status !== 404) throw error;
    asset.blockVerified = false;
  }
}
const chinese = a => a.subtitleLanguages.some(v => /^zh|中文|简|繁/u.test(v));
const useful = assets.filter(a => a.playbackVerified && a.blockVerified && chinese(a));
const compact = useful.filter(a => a.bytesGb > 0 && a.bytesGb <= 1.8);
const unverified = assets.filter(a => a.assetType === "playable_video" && a.blockVerified && !a.playbackVerified);
const report = { checkedAt: new Date().toISOString(), workId,
  title: text(Object.values(work.properties).find(p => p.type === "title")),
  workHidden: work.properties["Hide from Website"]?.checkbox,
  assets, usefulPlayableCount: useful.length, compactCount: compact.length,
  decision: unverified.length ? "existing_playables_need_qc_before_encode" : compact.length ? "existing_compact_review_before_encode" : useful.length ? "existing_playables_compact_only" : "subtitle_production_candidate" };
fs.mkdirSync(path.dirname(options.report), { recursive: true });
fs.writeFileSync(options.report, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
