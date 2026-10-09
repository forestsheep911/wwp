#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "./lib/project-secrets.mjs";
import { transportUrl } from "./lib/notion-attachment-transport.mjs";

export function parseArgs(args) {
  const values = new Map([["--block-id", "blockId"], ["--name", "name"], ["--output", "output"], ["--state", "state"], ["--workers", "workers"]]);
  const result = { workers: 1 };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--apply") result.apply = true;
    else if (args[i] === "--verify-only") result.verify = true;
    else if (values.has(args[i]) && args[i + 1]) result[values.get(args[i])] = args[++i];
    else throw new Error("Invalid download option.");
  }
  if (!result.blockId || !result.name || !result.output || (result.apply && result.verify)) throw new Error("Block ID, expected filename, output path, and at most one mode are required.");
  result.workers = Number(result.workers);
  if (!Number.isInteger(result.workers) || result.workers < 1 || result.workers > 8) throw new Error("Workers must be between 1 and 8.");
  if (path.basename(result.name) !== result.name) throw new Error("Expected filename must be a basename.");
  result.output = path.resolve(result.output);
  result.state ??= `${result.output}.transfer.json`;
  result.state = path.resolve(result.state);
  return result;
}

export function assertBlockFilename(source, expectedName) {
  const attachmentName = String(source.name ?? "").trim();
  if (attachmentName) {
    if (attachmentName !== expectedName) throw new Error("Notion attachment name does not match the expected filename.");
  } else {
    const urlName = decodeURIComponent(new URL(source.url).pathname.split("/").at(-1) ?? "");
    if (urlName !== expectedName) throw new Error("Nameless Notion block URL does not identify the expected filename.");
  }
  return { ...source, name: expectedName };
}

export async function run(input) {
  if (!input.apply && !input.verify) return { mode: "dry-run", blockId: input.blockId, name: input.name, output: input.output, workers: input.workers };

  config({ resolveSecrets: ["NOTION_API_KEY", "NOTION_TOKEN"] });
  process.env.NOTION_API_KEY ||= process.env.NOTION_TOKEN || "";
  process.env.NOTION_UPLOAD_EXPECTED_ROUTE = "direct";
  const [{ Coordinator }, { networkOptions, attachmentClient }, { downloadAttachment }] = await Promise.all([
    import(transportUrl("lib/coordinator.mjs")),
    import(transportUrl("lib/attachment-client.mjs")),
    import(transportUrl("lib/download.mjs"))
  ]);
  const options = networkOptions();
  const coordinator = new Coordinator();
  try {
    const client = attachmentClient(options, coordinator);
    const result = await downloadAttachment({
      blockId: input.blockId,
      name: input.name,
      destination: input.output,
      statePath: input.state,
      workers: input.workers,
      coordinator,
      refresh: async () => assertBlockFilename(await client.block(input.blockId), input.name),
      request: client.request
    });
    return { complete: result.complete, blockId: result.blockId, name: result.name, output: result.destination, bytes: result.bytes, sha256: result.sha256 };
  } finally {
    coordinator.close();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const input = parseArgs(process.argv.slice(2));
    const result = await run(input);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    console.error(`Notion media-block download stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
