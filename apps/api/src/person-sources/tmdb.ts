import type { MovieCreditDepartment, MovieCreditEntry, PersonNameEntry } from "@wwpdw/shared";
import { normalizePersonExternalIds } from "@wwpdw/shared";
import { fetchProviderJson, ProviderRateLimiter } from "./provider-http.js";
import type { FetchLike, PersonEvidence, WorkCreditEvidence } from "./types.js";

interface TmdbCastCredit {
  id?: number;
  name?: string;
  original_name?: string;
  character?: string;
  order?: number;
  known_for_department?: string;
}

interface TmdbCrewCredit {
  id?: number;
  name?: string;
  original_name?: string;
  department?: string;
  job?: string;
}

interface TmdbCreditsPayload {
  cast?: TmdbCastCredit[];
  crew?: TmdbCrewCredit[];
}

interface TmdbPersonPayload {
  id?: number;
  name?: string;
  also_known_as?: string[];
  biography?: string;
  birthday?: string;
  deathday?: string;
  place_of_birth?: string;
  profile_path?: string;
  known_for_department?: string;
  external_ids?: {
    imdb_id?: string;
    wikidata_id?: string;
  };
}

export interface TmdbPersonSourceOptions {
  token?: string;
  apiKey?: string;
  fetchImpl?: FetchLike;
  limiter?: ProviderRateLimiter;
  now?: () => Date;
}

export class TmdbPersonSource {
  private readonly token?: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: FetchLike;
  private readonly limiter: ProviderRateLimiter;
  private readonly now: () => Date;

  constructor(options: TmdbPersonSourceOptions = {}) {
    this.token = options.token ?? process.env.TMDB_API_READ_ACCESS_TOKEN;
    this.apiKey = options.apiKey ?? process.env.TMDB_API_KEY;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.limiter = options.limiter ?? new ProviderRateLimiter(250);
    this.now = options.now ?? (() => new Date());
    if (!this.token && !this.apiKey) {
      throw new Error("Set TMDB_API_READ_ACCESS_TOKEN or TMDB_API_KEY before TMDB enrichment.");
    }
  }

  async fetchWorkCredits(input: { tmdbId: string; kind: "movie" | "series" }): Promise<WorkCreditEvidence> {
    const routeKind = input.kind === "series" ? "tv" : "movie";
    const payload = await this.get<TmdbCreditsPayload>(`/${routeKind}/${input.tmdbId}/credits?language=en-US`);
    const observedAt = this.now().toISOString();
    return {
      workExternalId: input.tmdbId,
      workKind: input.kind,
      credits: tmdbCredits(payload),
      observedAt
    };
  }

  async fetchPersonEvidence(tmdbId: string): Promise<PersonEvidence> {
    const payload = await this.get<TmdbPersonPayload>(`/person/${tmdbId}?append_to_response=external_ids&language=en-US`);
    const observedAt = this.now().toISOString();
    const externalIds = normalizePersonExternalIds({
      tmdb: String(payload.id ?? tmdbId),
      imdb: payload.external_ids?.imdb_id,
      wikidata: payload.external_ids?.wikidata_id
    });
    const names = tmdbPersonNames(payload, observedAt);
    return {
      externalIds,
      names,
      biography: payload.biography || payload.birthday || payload.deathday || payload.place_of_birth ? {
        birthDate: clean(payload.birthday),
        deathDate: clean(payload.deathday),
        birthPlace: clean(payload.place_of_birth),
        ...(clean(payload.biography) ? { texts: [{
          value: clean(payload.biography)!,
          language: "en",
          source: "tmdb" as const,
          status: "strong" as const,
          sourceRef: `https://www.themoviedb.org/person/${externalIds.tmdb}`,
          observedAt
        }] } : {}),
        source: "tmdb"
      } : undefined,
      images: payload.profile_path ? [{
        url: `https://image.tmdb.org/t/p/original${payload.profile_path}`,
        source: "tmdb",
        observedAt
      }] : undefined,
      sourceRefs: [{
        source: "tmdb",
        id: externalIds.tmdb,
        url: `https://www.themoviedb.org/person/${externalIds.tmdb}`,
        observedAt
      }],
      observedAt
    };
  }

  private get<T>(path: string) {
    const separator = path.includes("?") ? "&" : "?";
    const url = `https://api.themoviedb.org/3${path}${this.apiKey ? `${separator}api_key=${encodeURIComponent(this.apiKey)}` : ""}`;
    return fetchProviderJson<T>({
      url,
      provider: "TMDB",
      fetchImpl: this.fetchImpl,
      limiter: this.limiter,
      headers: this.token ? { Authorization: `Bearer ${this.token}`, Accept: "application/json" } : { Accept: "application/json" }
    });
  }
}

export function tmdbCredits(payload: TmdbCreditsPayload) {
  const cast = (payload.cast ?? [])
    .filter((credit) => credit.id && credit.name && (credit.order ?? Number.MAX_SAFE_INTEGER) < 20)
    .map((credit): MovieCreditEntry => ({
      name: credit.name!,
      ...(credit.original_name && credit.original_name !== credit.name ? { originalName: credit.original_name } : {}),
      department: "acting",
      job: "Actor",
      ...(credit.character ? { character: credit.character } : {}),
      ...(credit.order !== undefined ? { order: credit.order } : {}),
      source: "tmdb",
      externalIds: { tmdb: String(credit.id) }
    }));
  const crew = (payload.crew ?? [])
    .filter((credit) => credit.id && credit.name && crewCreditInScope(credit))
    .map((credit): MovieCreditEntry => ({
      name: credit.name!,
      ...(credit.original_name && credit.original_name !== credit.name ? { originalName: credit.original_name } : {}),
      department: departmentFromTmdb(credit.department),
      ...(credit.job ? { job: credit.job } : {}),
      source: "tmdb",
      externalIds: { tmdb: String(credit.id) }
    }));
  return [...cast, ...crew];
}

function crewCreditInScope(credit: TmdbCrewCredit) {
  if (credit.department === "Directing" || credit.department === "Writing") return true;
  if (credit.department === "Production") return /^(?:Producer|Executive Producer|Co-Producer)$/i.test(credit.job ?? "");
  if (credit.department === "Camera") return /Director of Photography|Cinematography/i.test(credit.job ?? "");
  if (credit.department === "Editing") return /Editor/i.test(credit.job ?? "");
  if (credit.department === "Sound") return /Original Music Composer|Music/i.test(credit.job ?? "");
  return false;
}

function departmentFromTmdb(value?: string): MovieCreditDepartment {
  const map: Record<string, MovieCreditDepartment> = {
    Directing: "directing",
    Writing: "writing",
    Acting: "acting",
    Production: "production",
    Camera: "camera",
    Editing: "editing",
    Sound: "music",
    Art: "art",
    "Costume & Make-Up": "costume",
    "Visual Effects": "visual_effects",
    Crew: "crew"
  };
  return map[value ?? ""] ?? "other";
}

function tmdbPersonNames(payload: TmdbPersonPayload, observedAt: string): PersonNameEntry[] {
  const values = [payload.name, ...(payload.also_known_as ?? [])].filter((value): value is string => Boolean(clean(value)));
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.trim().toLocaleLowerCase("und");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((value, index) => ({
    value: value.trim(),
    kind: index === 0 ? "display" : "alternate",
    source: "tmdb",
    status: "strong",
    ...(isLatinName(value) ? { script: "Latn" } : {}),
    observedAt
  }));
}

function isLatinName(value: string) {
  const letters = value.match(/\p{L}/gu) ?? [];
  return letters.length > 0 && letters.every((letter) => /\p{Script=Latin}/u.test(letter));
}

function clean(value?: string | null) {
  const result = value?.trim();
  return result || undefined;
}
