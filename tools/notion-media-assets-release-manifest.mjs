import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    reports: [],
    mediaRoots: [],
    output: ".local-data/notion-media-assets-release-manifest.json",
    metadataOutput: "",
    includeExisting: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report") options.reports.push(argv[++index]);
    else if (arg === "--media-root") options.mediaRoots.push(argv[++index]);
    else if (arg === "--output") options.output = argv[++index];
    else if (arg === "--metadata-output") options.metadataOutput = argv[++index];
    else if (arg === "--include-existing") options.includeExisting = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node tools/notion-media-assets-release-manifest.mjs --report <writer-report.json> [--report <writer-report.json>] [--media-root <directory>] [--metadata-output <corrections.json>] [--include-existing] [--output <manifest.json>]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (options.reports.length === 0) throw new Error("Provide at least one --report.");
  return options;
}

function mediaFilenameKey(value) {
  return String(value ?? "").toLocaleLowerCase("en-US");
}

export function filesByName(root, requestedNames, map = new Map()) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) filesByName(entryPath, requestedNames, map);
    else if (entry.isFile()) {
      const key = mediaFilenameKey(entry.name);
      if (!requestedNames.has(key)) continue;
      if (map.has(key)) throw new Error(`Duplicate requested media filename across roots: ${entry.name}`);
      map.set(key, entryPath);
    }
  }
  return map;
}

export function roundedDecimalGb(filePath) {
  // Media Assets uses decimal GB, consistent with the workflow's file labels.
  return Number((fs.statSync(filePath).size / 1e9).toFixed(2));
}

export function releaseItemFromAction(action) {
  const candidate = action.candidate;
  if (!candidate?.metadata || !action.pageId) return null;
  const episode = candidate.metadata.episodeNumber;
  const expectedEpisodeNumber = Number.isInteger(episode) && episode > 0 ? episode : null;
  return {
    pageId: action.pageId,
    originalFileName: candidate.originalFileName,
    expectedWorkPageId: candidate.workPageId,
    expectedSourcePageId: candidate.sourcePageId,
    expectedMediaBlockId: candidate.mediaBlockId,
    // Movie Media Assets have no episode relationship; release explicitly
    // records null so the downstream verifier can fail closed on a stray value.
    expectedEpisodeNumber,
    expectedResolution: candidate.metadata.resolution,
    expectedVideoCodec: candidate.metadata.videoCodec,
    expectedContainer: candidate.metadata.container,
    expectedApproxSizeGb: candidate.metadata.approximateSizeGb
  };
}

function main() {
  const options = parseArgs();
  const byPageId = new Map();
  for (const reportPath of options.reports) {
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    for (const reportPage of report.reports ?? []) {
      for (const action of reportPage.actions ?? []) {
        const releasableActions = ["created", "would_create", "updated_existing", "would_update_existing", "corrected_existing", "would_correct_existing"];
        if (options.includeExisting) releasableActions.push("skip_existing");
        if (!releasableActions.includes(action.action)) continue;
        const item = releaseItemFromAction(action);
        if (item) byPageId.set(item.pageId, item);
      }
    }
  }
  const items = [...byPageId.values()].sort((left, right) =>
    (left.expectedEpisodeNumber ?? 0) - (right.expectedEpisodeNumber ?? 0)
  );
  if (items.length === 0) throw new Error("No release candidates found in writer reports.");
  if (options.mediaRoots.length > 0) {
    const requestedNames = new Set(items.map((item) => mediaFilenameKey(item.originalFileName)));
    const mediaByName = new Map();
    for (const root of options.mediaRoots) filesByName(root, requestedNames, mediaByName);
    for (const item of items) {
      const filePath = mediaByName.get(mediaFilenameKey(item.originalFileName));
      if (!filePath) throw new Error(`Missing local media for release candidate ${item.pageId}: ${item.originalFileName}`);
      item.expectedApproxSizeGb = roundedDecimalGb(filePath);
    }
  }
  fs.mkdirSync(path.dirname(path.resolve(options.output)), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");
  if (options.metadataOutput) {
    const corrections = items.map((item) => ({
      mediaBlockId: item.expectedMediaBlockId,
      replaceExistingFields: ["Approx Size GB"],
      metadata: { approximateSizeGb: item.expectedApproxSizeGb }
    }));
    fs.writeFileSync(options.metadataOutput, `${JSON.stringify({ items: corrections }, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify({ output: options.output, items: items.length, episodes: items.map((item) => item.expectedEpisodeNumber) }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
