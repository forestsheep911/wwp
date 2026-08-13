import type { MovieCreditDepartment, MovieCreditEntry } from "@wwpdw/shared";
import { normalizePersonExternalIds, normalizeWikidataId } from "@wwpdw/shared";
import { fetchProviderJson, ProviderRateLimiter } from "./provider-http.js";
import type { FetchLike, WorkCreditEvidence } from "./types.js";

interface WikidataClaim {
  mainsnak?: { datavalue?: { value?: string | { id?: string; value?: string } } };
  qualifiers?: Record<string, Array<{ datavalue?: { value?: string } }>>;
}

interface WikidataEntity {
  labels?: Record<string, { value?: string }>;
  claims?: Record<string, WikidataClaim[]>;
}

interface EntityPayload {
  entities?: Record<string, WikidataEntity>;
}

const roles: Array<{ property: string; department: MovieCreditDepartment; job: string }> = [
  { property: "P57", department: "directing", job: "Director" },
  { property: "P58", department: "writing", job: "Screenwriter" },
  { property: "P162", department: "production", job: "Producer" },
  { property: "P344", department: "camera", job: "Director of Photography" },
  { property: "P1040", department: "editing", job: "Editor" },
  { property: "P86", department: "music", job: "Original Music Composer" },
  { property: "P161", department: "acting", job: "Actor" }
];

const labelLanguages = ["zh-cn", "zh-hans", "zh-hant", "zh", "en", "ja"];

export class WikidataWorkCreditsSource {
  private readonly fetchImpl: FetchLike;
  private readonly limiter: ProviderRateLimiter;
  private readonly now: () => Date;
  private readonly userAgent: string;

  constructor(options: { fetchImpl?: FetchLike; limiter?: ProviderRateLimiter; now?: () => Date; userAgent?: string } = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.limiter = options.limiter ?? new ProviderRateLimiter(1_300);
    this.now = options.now ?? (() => new Date());
    this.userAgent = options.userAgent ?? "WWPDW-People/0.1 (bounded work-credit pilot)";
  }

  async fetchWorkCredits(wikidataWorkId: string, kind: "movie" | "series" = "movie"): Promise<WorkCreditEvidence> {
    const workId = normalizeWikidataId(wikidataWorkId);
    if (!workId) throw new Error(`Invalid Wikidata work id: ${wikidataWorkId}`);
    const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${workId}.json`;
    const workPayload = await this.get<EntityPayload>(entityUrl);
    const work = workPayload.entities?.[workId];
    if (!work) throw new Error(`Wikidata work ${workId} was not returned.`);
    const refs = extractCreditRefs(work);
    const people = new Map<string, WikidataEntity>();
    for (const batch of chunks([...new Set(refs.map((ref) => ref.wikidataId))], 20)) {
      const params = new URLSearchParams({
        action: "wbgetentities",
        ids: batch.join("|"),
        props: "labels|claims",
        languages: labelLanguages.join("|"),
        languagefallback: "1",
        format: "json",
        origin: "*"
      });
      const payload = await this.get<EntityPayload>(`https://www.wikidata.org/w/api.php?${params.toString()}`);
      for (const [id, entity] of Object.entries(payload.entities ?? {})) people.set(id, entity);
    }
    const credits = refs.flatMap((ref): MovieCreditEntry[] => {
      const entity = people.get(ref.wikidataId);
      const name = preferredLabel(entity);
      if (!name) return [];
      const originalName = entity?.labels?.ja?.value?.trim();
      return [{
        name,
        ...(originalName && originalName !== name ? { originalName } : {}),
        department: ref.department,
        job: ref.job,
        ...(ref.order !== undefined ? { order: ref.order } : {}),
        source: "wikidata",
        externalIds: normalizePersonExternalIds({
          wikidata: ref.wikidataId,
          tmdb: claimString(entity, "P4985"),
          imdb: claimString(entity, "P345")
        })
      }];
    });
    return {
      workExternalId: workId,
      workKind: kind,
      credits: dedupeCredits(credits),
      observedAt: this.now().toISOString()
    };
  }

  private get<T>(url: string) {
    return fetchProviderJson<T>({
      url,
      provider: "Wikidata",
      fetchImpl: this.fetchImpl,
      limiter: this.limiter,
      headers: { Accept: "application/json", "User-Agent": this.userAgent }
    });
  }
}

function extractCreditRefs(work: WikidataEntity) {
  return roles.flatMap((role) => (work.claims?.[role.property] ?? []).flatMap((claim) => {
    const value = claim.mainsnak?.datavalue?.value;
    const wikidataId = normalizeWikidataId(typeof value === "object" ? value.id : undefined);
    if (!wikidataId) return [];
    const ordinal = claim.qualifiers?.P1545?.[0]?.datavalue?.value;
    const parsedOrder = ordinal === undefined ? undefined : Number(ordinal);
    return [{
      wikidataId,
      department: role.department,
      job: role.job,
      ...(Number.isFinite(parsedOrder) ? { order: parsedOrder } : {})
    }];
  }));
}

function preferredLabel(entity?: WikidataEntity) {
  for (const language of labelLanguages) {
    const value = entity?.labels?.[language]?.value?.trim();
    if (value) return value;
  }
  return undefined;
}

function claimString(entity: WikidataEntity | undefined, property: string) {
  const value = entity?.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  if (typeof value === "string") return value.trim() || undefined;
  return value?.value?.trim() || undefined;
}

function dedupeCredits(credits: MovieCreditEntry[]) {
  const values = new Map<string, MovieCreditEntry>();
  for (const credit of credits) {
    const key = `${credit.externalIds?.wikidata}:${credit.department}:${credit.job ?? ""}`;
    if (!values.has(key)) values.set(key, credit);
  }
  return [...values.values()];
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
