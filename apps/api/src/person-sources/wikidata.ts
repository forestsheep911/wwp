import type { PersonNameEntry } from "@wwpdw/shared";
import { normalizePersonExternalIds, normalizeWikidataId } from "@wwpdw/shared";
import OpenCC from "opencc-js";
import { fetchProviderJson, ProviderRateLimiter } from "./provider-http.js";
import type { FetchLike, PersonEvidence } from "./types.js";

interface WikidataValue { value?: string; id?: string; time?: string }
interface WikidataClaim { mainsnak?: { datavalue?: { value?: WikidataValue | string } } }
interface WikidataEntity {
  labels?: Record<string, { value?: string }>;
  aliases?: Record<string, Array<{ value?: string }>>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<string, WikidataClaim[]>;
}
interface WikidataPayload { entities?: Record<string, WikidataEntity> }

export class NonHumanWikidataEntityError extends Error {
  constructor(readonly wikidataId: string) {
    super(`Wikidata entity ${wikidataId} is explicitly not a human.`);
  }
}

export class WikidataRoleMismatchError extends Error {
  constructor(readonly wikidataId: string, readonly expectedDepartments: readonly string[], readonly description: string) {
    super(`Wikidata entity ${wikidataId} has a non-film description that conflicts with the expected credit department: ${description}`);
  }
}

export function assertWikidataPersonRole(wikidataId: string, evidence: PersonEvidence, expectedDepartments: readonly string[] = []) {
  const description = evidence.biography?.texts?.find((entry) => entry.language === "en")?.value;
  if (description && isObviousRoleMismatch(description, evidence.externalIds.tmdb, evidence.externalIds.imdb, expectedDepartments)) {
    throw new WikidataRoleMismatchError(wikidataId, expectedDepartments, description);
  }
}

export interface WikidataPersonSourceOptions {
  fetchImpl?: FetchLike;
  limiter?: ProviderRateLimiter;
  now?: () => Date;
  userAgent?: string;
}

export class WikidataPersonSource {
  private readonly fetchImpl: FetchLike;
  private readonly limiter: ProviderRateLimiter;
  private readonly now: () => Date;
  private readonly userAgent: string;

  constructor(options: WikidataPersonSourceOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.limiter = options.limiter ?? new ProviderRateLimiter(1_000);
    this.now = options.now ?? (() => new Date());
    this.userAgent = options.userAgent ?? "WWPDW-People/0.1 (local catalog enrichment)";
  }

  async fetchPersonEvidence(value: string, expectedDepartments: readonly string[] = []): Promise<PersonEvidence> {
    const wikidataId = normalizeWikidataId(value);
    if (!wikidataId) throw new Error(`Invalid Wikidata person id: ${value}`);
    const url = `https://www.wikidata.org/wiki/Special:EntityData/${wikidataId}.json`;
    const payload = await fetchProviderJson<WikidataPayload>({
      url,
      provider: "Wikidata",
      fetchImpl: this.fetchImpl,
      limiter: this.limiter,
      headers: { Accept: "application/json", "User-Agent": this.userAgent }
    });
    const entity = payload.entities?.[wikidataId];
    if (!entity) throw new Error(`Wikidata entity ${wikidataId} was not returned.`);
    const instanceOf = claimEntityIds(entity, "P31");
    if (instanceOf.length > 0 && !instanceOf.includes("Q5")) throw new NonHumanWikidataEntityError(wikidataId);
    const observedAt = this.now().toISOString();
    const tmdb = claimString(entity, "P4985");
    const imdb = claimString(entity, "P345");
    const image = claimString(entity, "P18");
    const descriptions = localizedBiographyDescriptions(entity.descriptions);
    const description = descriptions[0];
    const englishDescription = descriptions.find((entry) => entry.language === "en")?.value;
    if (englishDescription && isObviousRoleMismatch(englishDescription, tmdb, imdb, expectedDepartments)) {
      throw new WikidataRoleMismatchError(wikidataId, expectedDepartments, englishDescription);
    }
    return {
      externalIds: normalizePersonExternalIds({ wikidata: wikidataId, tmdb, imdb }),
      names: wikidataNames(entity, url, observedAt),
      biography: description?.value || claimTime(entity, "P569") || claimTime(entity, "P570") ? {
        birthDate: claimTime(entity, "P569"),
        deathDate: claimTime(entity, "P570"),
        ...(descriptions.length ? { texts: descriptions.map((entry) => ({
          value: entry.value,
          language: entry.language,
          source: "wikidata" as const,
          status: "strong" as const,
          sourceRef: url,
          observedAt
        })) } : {}),
        source: "wikidata"
      } : undefined,
      images: image ? [{
        url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(image)}`,
        source: "wikidata",
        observedAt
      }] : undefined,
      sourceRefs: [{ source: "wikidata", id: wikidataId, url: `https://www.wikidata.org/wiki/${wikidataId}`, observedAt }],
      observedAt
    };
  }
}

function isObviousRoleMismatch(description: string, tmdb: string | undefined, imdb: string | undefined, expectedDepartments: readonly string[]) {
  if (tmdb || imdb || expectedDepartments.length === 0) return false;
  if (!expectedDepartments.some((department) => ["acting", "directing", "writing", "production", "music", "camera", "editing"].includes(department))) return false;
  const normalized = description.toLocaleLowerCase("en-US");
  const nonFilmOccupation = /\b(activist|politician|scientist|physicist|astronomer|athlete|wrestler|footballer|baseball player|basketball player|soccer player|racing driver|boxer|journalist|lawyer|professor|academic|businessman|businesswoman)\b/.test(normalized);
  const filmOccupation = /\b(actor|actress|director|writer|screenwriter|producer|composer|animator|filmmaker|comedian|singer)\b/.test(normalized);
  return nonFilmOccupation && !filmOccupation;
}

const languagePriority = ["zh-cn", "zh-hans", "zh-hant", "zh", "en"];
const traditionalToSimplified = OpenCC.Converter({ from: "t", to: "cn" });

function wikidataNames(entity: WikidataEntity, sourceRef: string, observedAt: string): PersonNameEntry[] {
  const result: PersonNameEntry[] = [];
  const seen = new Set<string>();
  for (const language of languagePriority) {
    const label = entity.labels?.[language]?.value;
    add(label, language, "display");
    for (const alias of entity.aliases?.[language] ?? []) add(alias.value, language, "alternate");
  }
  return result;

  function add(value: string | undefined, language: string, kind: "display" | "alternate") {
    const cleaned = value?.trim();
    if (!cleaned) return;
    const simplified = language.startsWith("zh") ? traditionalToSimplified(cleaned) : cleaned;
    if (simplified !== cleaned) addEntry(simplified, "zh-hans", "Hans", kind);
    addEntry(cleaned, language, language === "zh-hant" || simplified !== cleaned ? "Hant" : language.startsWith("zh") ? "Hans" : "Latn", simplified !== cleaned && kind === "display" ? "alternate" : kind);
  }

  function addEntry(value: string, language: string, script: "Hans" | "Hant" | "Latn", kind: "display" | "alternate") {
    const cleaned = value.trim();
    const key = cleaned.toLocaleLowerCase("und");
    if (seen.has(key)) return;
    seen.add(key);
    result.push({
      value: cleaned,
      language,
      script,
      kind,
      source: "wikidata",
      status: "strong",
      sourceRef,
      observedAt
    });
  }
}

function claimString(entity: WikidataEntity, property: string) {
  const value = entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  if (typeof value === "string") return value.trim() || undefined;
  return value?.value?.trim() || undefined;
}

function claimTime(entity: WikidataEntity, property: string) {
  const value = entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;
  const time = typeof value === "object" ? value.time : undefined;
  const match = time?.match(/^\+?(\d{4}-\d{2}-\d{2})T/);
  if (!match || match[1].includes("-00")) return undefined;
  return match[1];
}

function claimEntityIds(entity: WikidataEntity, property: string) {
  return (entity.claims?.[property] ?? []).flatMap((claim) => {
    const value = claim.mainsnak?.datavalue?.value;
    if (typeof value !== "object") return [];
    const id = value.value?.trim() || value.id?.trim();
    return id ? [id] : [];
  });
}

function localized<T extends { value?: string }>(values?: Record<string, T>) {
  for (const language of languagePriority) {
    if (values?.[language]?.value) return { ...values[language], language };
  }
  return undefined;
}

function localizedBiographyDescriptions<T extends { value?: string }>(values?: Record<string, T>) {
  const result: Array<{ value: string; language: string }> = [];
  const chinese = languagePriority.find((language) => language.startsWith("zh") && values?.[language]?.value?.trim());
  if (chinese) {
    const original = values![chinese].value!.trim();
    const simplified = traditionalToSimplified(original);
    if (simplified !== original) result.push({ value: simplified, language: "zh-hans" });
    result.push({ value: original, language: chinese });
  }
  const english = values?.en?.value?.trim();
  if (english) result.push({ value: english, language: "en" });
  return result;
}
