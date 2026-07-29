import dns from "node:dns";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@notionhq/client";

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    manifestPath: "",
    reportPath: ".local-data/notion-media-assets-release.json",
    resolveIp: "",
    apply: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [name, inlineValue] = arg.split(/=(.*)/s);
    const value = () => inlineValue ?? argv[++index];
    if (name === "--manifest") options.manifestPath = value();
    else if (name === "--report") options.reportPath = value();
    else if (name === "--resolve-ip") options.resolveIp = value();
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.manifestPath) throw new Error("--manifest is required.");
  return options;
}

function printHelp() {
  console.log(`Usage:
  node tools/notion-media-assets-release.mjs --manifest .local-data/release.json
  node tools/notion-media-assets-release.mjs --manifest .local-data/release.json --apply --report .local-data/release-apply.json

The manifest must identify every Media Assets page and its expected Work, source
page, media block, episode, resolution, codec, container, and decimal-GB size.
Use an integer expectedEpisodeNumber for series assets and explicit null for movies.
Dry-run is the default. Apply clears only the asset row's Hide from Website field
after all evidence matches and verifies the updated row by direct readback.`);
}

function dotenv(name) {
  if (process.env[name]) return process.env[name];
  if (!fs.existsSync(".env")) return undefined;
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/u)) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/u);
    if (match?.[1] === name) return match[2].trim();
  }
  return undefined;
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

function plainText(items = []) {
  return items.map((item) => item.plain_text ?? item.text?.content ?? "").join("").trim();
}

function propertyText(property) {
  if (!property) return "";
  if (property.type === "title") return plainText(property.title);
  if (property.type === "rich_text") return plainText(property.rich_text);
  if (property.type === "select") return property.select?.name ?? "";
  return "";
}

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function required(item, name) {
  if (item[name] === undefined || item[name] === null || item[name] === "") {
    throw new Error(`Manifest item ${item.pageId ?? "(missing pageId)"} requires ${name}.`);
  }
  return item[name];
}

function expectedEpisodeNumber(item) {
  if (!Object.hasOwn(item, "expectedEpisodeNumber")) {
    throw new Error(`Manifest item ${item.pageId ?? "(missing pageId)"} requires expectedEpisodeNumber (integer for series, null for movies).`);
  }
  if (item.expectedEpisodeNumber === null) return null;
  const value = Number(required(item, "expectedEpisodeNumber"));
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Manifest item ${item.pageId ?? "(missing pageId)"} expectedEpisodeNumber must be a positive integer or null.`);
  }
  return value;
}

export function validateReleaseCandidate(page, item) {
  const properties = page.properties ?? {};
  const pageId = required(item, "pageId");
  const expected = {
    workPageId: required(item, "expectedWorkPageId"),
    sourcePageId: required(item, "expectedSourcePageId"),
    mediaBlockId: required(item, "expectedMediaBlockId"),
    episodeNumber: expectedEpisodeNumber(item),
    resolution: required(item, "expectedResolution"),
    videoCodec: required(item, "expectedVideoCodec"),
    container: required(item, "expectedContainer"),
    approximateSizeGb: Number(required(item, "expectedApproxSizeGb"))
  };
  const failures = [];
  const workIds = (properties.Work?.relation ?? []).map((relation) => relation.id);
  const actual = {
    assetType: propertyText(properties["Asset Type"]),
    availability: propertyText(properties["Media Availability"]),
    playbackVerified: properties["Playback Verified"]?.checkbox,
    hidden: properties["Hide from Website"]?.checkbox,
    sourcePageId: propertyText(properties["Source Page ID"]),
    mediaBlockId: propertyText(properties["Media Block ID"]),
    episodeNumber: properties["Episode Number"]?.number,
    resolution: propertyText(properties.Resolution),
    videoCodec: propertyText(properties["Video Codec"]),
    container: propertyText(properties.Container),
    approximateSizeGb: properties["Approx Size GB"]?.number
  };

  if (page.id !== pageId) failures.push(`page id ${page.id} != ${pageId}`);
  if (page.archived || page.in_trash) failures.push("page is archived or in trash");
  if (!workIds.includes(expected.workPageId)) failures.push("Work relation mismatch");
  if (actual.assetType !== "playable_video") failures.push("Asset Type is not playable_video");
  if (actual.availability !== "playable") failures.push("Media Availability is not playable");
  if (actual.playbackVerified !== true) failures.push("Playback Verified is not true");
  if (actual.sourcePageId !== expected.sourcePageId) failures.push("Source Page ID mismatch");
  if (actual.mediaBlockId !== expected.mediaBlockId) failures.push("Media Block ID mismatch");
  if (actual.episodeNumber !== expected.episodeNumber) failures.push("Episode Number mismatch");
  if (normalized(actual.resolution) !== normalized(expected.resolution)) failures.push("Resolution mismatch");
  if (normalized(actual.videoCodec) !== normalized(expected.videoCodec)) failures.push("Video Codec mismatch");
  if (normalized(actual.container) !== normalized(expected.container)) failures.push("Container mismatch");
  if (!Number.isFinite(actual.approximateSizeGb)
    || Math.abs(actual.approximateSizeGb - expected.approximateSizeGb) > 0.001) {
    failures.push("Approx Size GB mismatch");
  }
  if (typeof actual.hidden !== "boolean") failures.push("Hide from Website is missing");

  return {
    pageId,
    expected,
    actual,
    ok: failures.length === 0,
    failures,
    action: failures.length > 0 ? "blocked" : actual.hidden ? "release" : "already_released"
  };
}

function readManifest(manifestPath) {
  const payload = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw new Error("Manifest must contain a non-empty items array.");
  }
  const pageIds = payload.items.map((item) => required(item, "pageId"));
  if (new Set(pageIds).size !== pageIds.length) throw new Error("Manifest pageId values must be unique.");
  return payload;
}

async function main() {
  const options = parseArgs();
  const manifest = readManifest(options.manifestPath);
  installNotionDnsOverride(options.resolveIp);
  const auth = dotenv("NOTION_WRITE_TOKEN") || dotenv("NOTION_TOKEN") || dotenv("NOTION_API_KEY");
  if (!auth) throw new Error("NOTION_WRITE_TOKEN, NOTION_TOKEN, or NOTION_API_KEY is required.");
  const notion = new Client({ auth, timeoutMs: Number(dotenv("NOTION_REQUEST_TIMEOUT_MS") || 30000) });
  const actions = [];

  for (const item of manifest.items) {
    const page = await notion.pages.retrieve({ page_id: item.pageId });
    const validation = validateReleaseCandidate(page, item);
    if (!validation.ok) {
      actions.push(validation);
      continue;
    }
    if (validation.action === "already_released" || !options.apply) {
      actions.push(validation);
      continue;
    }

    await notion.pages.update({
      page_id: item.pageId,
      properties: {
        "Hide from Website": { checkbox: false }
      }
    });
    const readback = await notion.pages.retrieve({ page_id: item.pageId });
    const verified = validateReleaseCandidate(readback, item);
    if (!verified.ok || verified.action !== "already_released") {
      throw new Error(`Release readback failed for ${item.pageId}: ${verified.failures.join("; ")}`);
    }
    actions.push({ ...verified, action: "released" });
  }

  const summary = {
    total: actions.length,
    released: actions.filter((item) => item.action === "released").length,
    wouldRelease: actions.filter((item) => item.action === "release").length,
    alreadyReleased: actions.filter((item) => item.action === "already_released").length,
    blocked: actions.filter((item) => item.action === "blocked").length
  };
  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.apply ? "apply" : "dry-run",
    manifestPath: options.manifestPath,
    summary,
    actions
  };
  fs.mkdirSync(path.dirname(path.resolve(options.reportPath)), { recursive: true });
  fs.writeFileSync(options.reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ reportPath: options.reportPath, summary }, null, 2));
  if (summary.blocked > 0) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
