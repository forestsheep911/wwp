import "../apps/api/src/env.ts";
import path from "node:path";
import { createSearchIndexStore, createPersonCatalogStore } from "@wwpdw/cache-store";
import { PublicIdentityStore } from "../apps/api/src/public-identities.ts";
import { publicIdentityCandidates } from "../apps/api/src/public-identity-candidates.ts";
// Explicit local home snapshots. Never crawls Notion. Default is read-only.
const root = path.resolve(process.env.WWPDW_HOME_DATA_DIR ?? ".local-data/home-site");
process.env.WWPDW_LOCAL_DATA_DIR = root;
const [results, people] = await Promise.all([createSearchIndexStore("local").listAllResults(), createPersonCatalogStore("local").getState()]);
const candidates = publicIdentityCandidates(results, people);
const seen = new Map(); const conflicts = [];
for (const candidate of candidates) for (const alias of [candidate.key, ...(candidate.aliases ?? [])]) {
 const key = `${candidate.kind}:${alias}`; const previous = seen.get(key);
 if (previous && previous !== candidate.key) conflicts.push({ kind: candidate.kind, alias, keys: [previous, candidate.key] });
 seen.set(key, candidate.key);
}
if (conflicts.length) { console.log(JSON.stringify({ apply: false, candidates: candidates.length, conflicts }, null, 2)); process.exitCode = 1; }
else if (process.argv.includes("--apply")) {
 const entries = await new PublicIdentityStore(path.join(root,"public-identities.json")).sync(candidates);
 console.log(JSON.stringify({ apply: true, counts: Object.fromEntries(["work","person","video"].map(kind => [kind, entries.filter(entry => entry.kind === kind).length])), conflicts: [] }));
} else console.log(JSON.stringify({ apply: false, candidates: candidates.length, conflicts: [] }));
