#!/usr/bin/env node
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import dns from "node:dns";
import { isIPv4 } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { AzureCliCredential } from "@azure/identity";
import { TableClient } from "@azure/data-tables";
import { BlobServiceClient, StorageSharedKeyCredential } from "@azure/storage-blob";
import { maintainedPosterFiles, posterOnlyIndexPatch, decodeIndexEntity, ownedPosterFile } from "./lib/poster-index-repair.mjs";

const args = process.argv.slice(2);
const value = name => args[args.indexOf(name) + 1];
if (!args.includes("--audit") || !args.includes("--report")) throw new Error("Required: --audit <saved audit.json> --report <checkpoint.json> [--apply] [--limit 20] [--use-account-key]");
const limit = args.includes("--limit") ? Number(value("--limit")) : 20;
if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Batch limit must be 1..20");
const apply = args.includes("--apply");
const reportPath = path.resolve(value("--report"));
const audit = JSON.parse(fs.readFileSync(value("--audit"), "utf8"));
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : { records: [] };
const completed = new Set(report.records.filter(r => ["updated", "source_unavailable"].includes(r.status)).map(r => r.assetKey));
const candidates = audit.records.filter(r => r.status === "uncached-or-broken" && /^notion-page-[0-9a-f-]{36}$/.test(r.assetKey));
const excluded = new Set(args.flatMap((arg, i) => arg === "--exclude-asset-key" ? [args[i + 1]] : []));
const batch = candidates.filter(r => !completed.has(r.assetKey) && !excluded.has(r.assetKey)).slice(0, limit);
console.log(JSON.stringify({ apply, total: candidates.length, completed: completed.size, batch: batch.map(r=>r.title) }));
if (!apply) process.exit(0);
const token = process.env.NOTION_READ_ONLY_TOKEN;
if (!token) throw new Error("NOTION_READ_ONLY_TOKEN is required");
// Honor the same process-local Notion routing override as NotionSearchSource.
// Hostname/TLS verification remain api.notion.com; no system DNS is modified.
const notionIp = process.env.NOTION_API_RESOLVE_IP?.trim();
if (notionIp) {
  if (!isIPv4(notionIp)) throw new Error("NOTION_API_RESOLVE_IP must be an IPv4 address");
  const originalLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (hostname !== "api.notion.com") return originalLookup(hostname, options, callback);
    if (typeof options === "function") return options(null, notionIp, 4);
    return options?.all ? callback(null, [{ address: notionIp, family: 4 }]) : callback(null, notionIp, 4);
  };
}
const account = process.env.AZURE_STORAGE_ACCOUNT_NAME ?? "stwwcachee9219db7";
if (!/^[a-z0-9]{3,24}$/.test(account)) throw new Error("Invalid Azure storage account name");
const credential = new AzureCliCredential();
const table = new TableClient(`https://${account}.table.core.windows.net`, process.env.AZURE_STORAGE_SEARCH_INDEX_TABLE ?? "movieindex", credential);
let blobCredential = credential;
if (args.includes("--use-account-key")) {
  // Keep the existing authorized storage credential in memory, never in reports.
  const key = execFileSync("az", ["storage", "account", "keys", "list", "--resource-group", "rg-ww-player-cache-dev", "--account-name", account, "--query", "[0].value", "-o", "tsv", "--only-show-errors"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
  if (!key) throw new Error("Storage credential unavailable");
  blobCredential = new StorageSharedKeyCredential(account, key);
}
const container = new BlobServiceClient(`https://${account}.blob.core.windows.net`, blobCredential).getContainerClient(process.env.AZURE_STORAGE_BLOB_CONTAINER ?? "cached-videos");
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const backupDir = `${reportPath}.backups`;
fs.mkdirSync(backupDir, { recursive: true });
let nextRequestAt = 0;
let stopped = false;
let requestQueue = Promise.resolve();
function pacedFetch(url, init = {}) {
  const request = requestQueue.then(async () => {
    if (stopped) throw new Error("Batch stopped before next request");
    await sleep(Math.max(0, nextRequestAt - Date.now()));
    nextRequestAt = Date.now() + 1100;
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(new URL(url).hostname === "api.notion.com" ? 45000 : 120000) });
    if (response.status === 429) stopped = true;
    const chunks = []; let size = 0;
    const reader = response.body?.getReader();
    while (reader) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("Response exceeds 8 MiB"); }
      chunks.push(Buffer.from(chunk.value));
    }
    // Release the shared limiter only after the response body is consumed.
    return new Response(init.method === "HEAD" ? null : Buffer.concat(chunks), { status: response.status, headers: response.headers });
  });
  requestQueue = request.catch(() => {});
  return request;
}
async function repairItem(item) {
  const record = { assetKey: item.assetKey, title: item.title, page: item.page, at: new Date().toISOString() };
  try {
    record.phase = "notion-read";
    const response = await pacedFetch(`https://api.notion.com/v1/pages/${item.page}`, { headers: { Authorization: `Bearer ${token}`, "Notion-Version": "2022-06-28" } });
    if (response.status === 429) {
      record.status = "rate_limited";
      record.retryAfter = response.headers.get("retry-after");
      stopped = true;
    } else if (response.status === 404) {
      record.status = "source_unavailable"; // Never interpret unreadable as deletion.
    } else {
      if (!response.ok) throw new Error(`Notion HTTP ${response.status}`);
      const page = await response.json();
      if (page.archived || page.in_trash) throw new Error("Notion page is archived; manual review required");
      const urls = maintainedPosterFiles(page);
      const posters = [];
      for (const [index, url] of urls.entries()) {
        record.phase = `image-download-${index + 1}`;
        let buffer, copiedBlobName;
        const sourceUrl = new URL(url);
        if (sourceUrl.protocol !== "https:") throw new Error("Maintained image must use HTTPS");
        if (args.includes("--cloud-copy") && /^(prod-files-secure\.s3\.[a-z0-9-]+\.amazonaws\.com|secure\.notion-static\.com)$/i.test(sourceUrl.hostname)) {
          // S3's Notion URLs are signed for GET, so HEAD returns signature 403.
          const probe = await pacedFetch(url, { headers: { Range: "bytes=0-0" } });
          const size = Number(probe.headers.get("content-range")?.split("/").at(-1) ?? probe.headers.get("content-length"));
          if (!probe.ok || !Number.isFinite(size) || size <= 0 || size > 8 * 1024 * 1024) throw new Error(`Source size probe HTTP ${probe.status} failed or image size is outside 1..8 MiB`);
          // Notion's uploaded file UUID/path is immutable across signature refresh.
          const sourceId = createHash("sha256").update(sourceUrl.origin + sourceUrl.pathname).digest("hex").slice(0,20);
          copiedBlobName = `posters/${Buffer.from(item.assetKey).toString("base64url")}/${String(index+1).padStart(2,"0")}-notion-${sourceId}`;
          const copiedBlob = container.getBlockBlobClient(copiedBlobName);
          record.phase = `cloud-copy-${index + 1}`;
          try {
            await copiedBlob.syncUploadFromURL(url, { conditions: { ifNoneMatch: "*" }, abortSignal: AbortSignal.timeout(120000), metadata: { assetkey: Buffer.from(item.assetKey).toString("base64url"), source: "notion" } });
          } catch (error) { if (![409,412].includes(error.statusCode)) throw error; }
          const properties = await copiedBlob.getProperties();
          if (properties.contentLength !== size) throw new Error("Cloud copied size does not match maintained source");
          // Azure performed the full source transfer. Verify its exact size and
          // image signature without downloading the entire original twice locally.
          buffer = await copiedBlob.downloadToBuffer(0, Math.min(size, 32));
        } else {
          const image = await pacedFetch(url, { headers: { Accept: "image/*" } });
          if (!image.ok) throw new Error(`Maintained image HTTP ${image.status}`);
          buffer = Buffer.from(await image.arrayBuffer());
        }
        const file = ownedPosterFile(item.assetKey, index, buffer);
        if (copiedBlobName) file.blobName = copiedBlobName;
        const blob = container.getBlockBlobClient(file.blobName);
        record.phase = `blob-upload-${index + 1}`;
        // New owned names only. Old images are retained for rollback.
        if (copiedBlobName) await blob.setHTTPHeaders({ blobContentType: file.contentType });
        else {
          try {
            await blob.uploadData(buffer, { conditions: { ifNoneMatch: "*" }, blobHTTPHeaders: { blobContentType: file.contentType }, metadata: { assetkey: Buffer.from(item.assetKey).toString("base64url"), posterindex: String(index + 1), source: "notion" } });
          } catch (error) { if (![409, 412].includes(error.statusCode)) throw error; }
        }
        record.phase = `blob-readback-${index + 1}`;
        const saved = copiedBlobName ? await blob.downloadToBuffer(0, buffer.length) : await blob.downloadToBuffer();
        if (!saved.equals(buffer)) throw new Error("Uploaded image readback mismatch");
        posters.push({ source: "blob", origin: "notion-files", url: `/api/posters/${encodeURIComponent(file.blobName)}`, originalUrl: url, blobName: file.blobName, contentType: file.contentType, cachedAt: new Date().toISOString() });
      }
      // Re-read at write time, modify poster fields only, and use ETag to avoid
      // overwriting concurrent people/variant edits. A conflict stays resumable.
      record.phase = "index-read";
      const entity = await table.getEntity("movie", Buffer.from(item.assetKey).toString("base64url"));
      if (decodeIndexEntity(entity).result.assetKey !== item.assetKey) throw new Error("Index identity mismatch");
      const backupPath = path.join(backupDir, `${item.assetKey}-${Date.now()}.json`);
      fs.writeFileSync(backupPath, JSON.stringify(entity));
      const patch = posterOnlyIndexPatch(entity, posters);
      record.phase = "index-write";
      await table.updateEntity(patch, "Merge", { etag: entity.etag });
      record.phase = "index-readback";
      const readback = decodeIndexEntity(await table.getEntity("movie", entity.rowKey));
      if (JSON.stringify(readback.result.metadata.posters) !== JSON.stringify(posters)) throw new Error("Index readback differs; concurrent writer may have replaced posters");
      record.status = "updated";
      record.phase = "complete";
      record.posterCount = posters.length;
      record.blobNames = posters.map(p=>p.blobName);
      record.backupPath = backupPath;
    }
  } catch (error) {
    record.status = "failed";
    record.error = error.statusCode ? `Storage HTTP ${error.statusCode}` : error.message;
    if (error.cause?.code) record.causeCode = error.cause.code;
    stopped = true; // Do not amplify a storage/permission/network failure.
  }
  report.records = report.records.filter(r=>r.assetKey !== item.assetKey);
  report.records.push(record);
  report.updatedAt = new Date().toISOString();
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(record));
}
// Only Azure work overlaps. All Notion and source-image reads share the serial
// limiter above, including their response bodies; Notion concurrency stays one.
let nextItem = 0;
await Promise.all(Array.from({ length: 2 }, async () => {
  while (!stopped && nextItem < batch.length) await repairItem(batch[nextItem++]);
}));
console.log(JSON.stringify({ updated: report.records.filter(r=>r.status === "updated").length, sourceUnavailable: report.records.filter(r=>r.status === "source_unavailable").length, remaining: candidates.length - report.records.filter(r=>["updated", "source_unavailable"].includes(r.status)).length, stopped }));
if (stopped) process.exitCode = 1;
