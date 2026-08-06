#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const DEFAULT_INDEX = ".local-data/home-site/search-index.json";

function parseArgs(argv = process.argv.slice(2)) {
  const options = { index: DEFAULT_INDEX, workPage: "", report: ".local-data/series-index-variant-audit.json", json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (["--index", "--work-page", "--report"].includes(argument)) options[argument.slice(2).replaceAll("-", "_")] = argv[++index];
    else if (argument === "--json") options.json = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function usage() {
  console.log(`Usage:
  node tools/series-index-variant-audit.mjs [--index .local-data/home-site/search-index.json] [--work-page <id>] [--report <path>] [--json]

Read-only website-index audit. It reports visible playable assets sharing one
series episode number across specifications. It never changes Notion, the
ledger, or website visibility.`);
}

function sizeTier(label) {
  const match = String(label ?? "").match(/(\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?)\s*GB(?:\s*\/\s*([集話]))?/iu);
  if (!match) return null;
  return { value: match[1].replaceAll(/\s+/gu, ""), perEpisode: Boolean(match[2]) };
}

export function visiblePlayableEpisodeVariants(result) {
  return (result?.variants ?? []).filter((variant) => {
    const metadata = variant.metadata ?? {};
    return Number.isInteger(metadata.episodeNumber)
      && metadata.episodeNumber > 0
      && metadata.hideFromWebsite !== true
      && metadata.playbackVerified === true;
  });
}

export function duplicateEpisodeGroups(result) {
  const byEpisode = new Map();
  for (const variant of visiblePlayableEpisodeVariants(result)) {
    const episode = variant.metadata.episodeNumber;
    const group = byEpisode.get(episode) ?? [];
    group.push(variant);
    byEpisode.set(episode, group);
  }
  return [...byEpisode.entries()]
    .filter(([, variants]) => variants.length > 1)
    .map(([episodeNumber, variants]) => {
      const tiers = variants.map((variant) => sizeTier(variant.label));
      const distinctTiers = tiers.every(Boolean) && new Set(tiers.map((tier) => tier.value)).size === tiers.length;
      const legacyTierTitle = distinctTiers && tiers.some((tier) => !tier.perEpisode);
      return {
        episodeNumber,
        status: distinctTiers ? (legacyTierTitle ? "legacy_tier_title" : "distinct_size_tiers") : "review_required",
        sizeTiers: tiers.map((tier) => tier?.value ?? null),
        variants: variants.map((variant) => ({
          label: variant.label,
          mediaAssetPageId: variant.metadata?.mediaAssetPageId ?? null,
          sourcePageId: variant.sourcePageId ?? null,
          qualityTag: variant.metadata?.qualityTag ?? null
        }))
      };
    })
    .sort((left, right) => left.episodeNumber - right.episodeNumber);
}

function indexEntries(index) {
  return Object.values(index.entries ?? {}).filter((entry) => entry?.result?.metadata?.work?.kind === "series" || entry?.result?.metadata?.kind === "series");
}

function main() {
  const options = parseArgs();
  if (options.help) return usage();
  const indexPath = path.resolve(options.index);
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const entries = indexEntries(index).filter((entry) => !options.work_page || entry.result.sourcePageId === options.work_page);
  if (options.work_page && entries.length !== 1) throw new Error(`Expected one series work page ${options.work_page}; found ${entries.length}.`);
  const works = entries.map((entry) => ({
    workPageId: entry.result.sourcePageId,
    title: entry.result.title,
    duplicateEpisodes: duplicateEpisodeGroups(entry.result)
  })).filter((work) => work.duplicateEpisodes.length > 0);
  const report = {
    generatedAt: new Date().toISOString(),
    index: indexPath,
    workPageId: options.work_page || null,
    works,
    summary: {
      worksScanned: entries.length,
      worksWithDuplicateEpisodes: works.length,
      duplicateEpisodeGroups: works.reduce((total, work) => total + work.duplicateEpisodes.length, 0),
      reviewRequired: works.reduce((total, work) => total + work.duplicateEpisodes.filter((group) => group.status === "review_required").length, 0),
      legacyTierTitles: works.reduce((total, work) => total + work.duplicateEpisodes.filter((group) => group.status === "legacy_tier_title").length, 0)
    }
  };
  fs.mkdirSync(path.dirname(path.resolve(options.report)), { recursive: true });
  fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ report: path.resolve(options.report), summary: report.summary }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).href) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
