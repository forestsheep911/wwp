import type { SearchResult } from "@wwpdw/shared";

export interface SiteStatisticItem {
  label: string;
  count: number;
}

export interface SiteStatistics {
  generatedAt: string;
  latestIndexedAt?: string;
  totals: {
    titles: number;
    movies: number;
    series: number;
    variants: number;
    instantPlay: number;
    people: number;
    genreCount: number;
    countryCount: number;
    companyCount: number;
    companyCoveredTitles: number;
  };
  decades: SiteStatisticItem[];
  genres: SiteStatisticItem[];
  countries: SiteStatisticItem[];
  companies: SiteStatisticItem[];
}

type SiteCategory = "movie" | "series";

export function buildSiteStatistics(
  results: SearchResult[],
  options: {
    readyAssetKeys?: Set<string>;
    people?: number;
    latestIndexedAt?: string;
    generatedAt?: string;
  } = {}
): SiteStatistics {
  const visibleResults = results.filter((result) => result.metadata?.hideFromWebsite !== true);
  const works = groupSiteWorks(visibleResults);
  const readyAssetKeys = options.readyAssetKeys ?? new Set<string>();
  const categories: Record<SiteCategory, number> = { movie: 0, series: 0 };
  const decades = new Map<string, number>();
  const genres = new Map<string, number>();
  const countries = new Map<string, number>();
  const companies = new Map<string, number>();
  let companyCoveredTitles = 0;
  let instantPlay = 0;
  let variants = 0;

  for (const work of works) {
    const { result } = work;
    categories[siteCategoryForResult(result)] += 1;
    variants += work.variantAssetKeys.size;
    increment(decades, decadeForResult(result));
    for (const genre of genresForResult(result)) increment(genres, genre);
    for (const country of countriesForResult(result)) increment(countries, country);
    const productionCompanies = companiesForResult(result);
    if (productionCompanies.length > 0) companyCoveredTitles += 1;
    for (const company of productionCompanies) increment(companies, company);
    if ([...work.allAssetKeys].some((assetKey) => readyAssetKeys.has(assetKey))) {
      instantPlay += 1;
    }
  }

  const decadeOrder = ["未知", "1949 年以前", "1950 年代", "1960 年代", "1970 年代", "1980 年代", "1990 年代", "2000 年代", "2010 年代", "2020 年代"];

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    ...(options.latestIndexedAt ? { latestIndexedAt: options.latestIndexedAt } : {}),
    totals: {
      titles: works.length,
      movies: categories.movie,
      series: categories.series,
      variants,
      instantPlay,
      people: Math.max(0, options.people ?? 0),
      genreCount: genres.size,
      countryCount: countries.size,
      companyCount: companies.size,
      companyCoveredTitles
    },
    decades: decadeOrder.map((label) => ({ label, count: decades.get(label) ?? 0 })),
    genres: rankedItems(genres),
    countries: rankedItems(countries, 10),
    companies: rankedItems(companies)
  };
}

function groupSiteWorks(results: SearchResult[]) {
  const groups = new Map<string, {
    result: SearchResult;
    allAssetKeys: Set<string>;
    variantAssetKeys: Set<string>;
  }>();

  for (const result of results) {
    const identity = result.metadata?.work?.workId
      ?? result.metadata?.workId
      ?? result.sourcePageId
      ?? result.assetKey;
    const current = groups.get(identity) ?? {
      result,
      allAssetKeys: new Set<string>(),
      variantAssetKeys: new Set<string>()
    };
    current.allAssetKeys.add(result.assetKey);
    for (const variant of result.variants ?? []) {
      current.allAssetKeys.add(variant.assetKey);
      current.variantAssetKeys.add(variant.assetKey);
    }
    groups.set(identity, current);
  }

  return [...groups.values()];
}

export function siteCategoryForResult(result: SearchResult): SiteCategory {
  const metadata = result.metadata;
  const work = metadata?.work;
  const text = [
    metadata?.kind,
    work?.kind,
    metadata?.type,
    metadata?.genres?.join(" "),
    work?.genres?.join(" "),
    metadata?.external?.omdb?.type,
    metadata?.external?.omdb?.genres?.join(" ")
  ].filter(Boolean).join(" ").toLowerCase();

  const kind = work?.kind ?? metadata?.kind;
  if (kind === "series" || kind === "season" || kind === "episode") return "series";
  if (kind === "movie" || kind === "short" || kind === "special") return "movie";
  if (/\btv\b|\bseries\b|\bseason\b|\bshow\b|电视|電視|剧集|影集/u.test(text)) return "series";
  if (/\bmovie\b|\bfilm\b|电影|電影/u.test(text)) return "movie";
  // The public library's primary content dimension is movie vs television.
  // Animation remains a genre/form and therefore inherits the work kind.
  return "movie";
}

function yearForResult(result: SearchResult) {
  const value = result.metadata?.work?.release?.year
    ?? result.metadata?.release?.year
    ?? result.metadata?.display?.year
    ?? result.metadata?.year
    ?? result.metadata?.external?.omdb?.year;
  const match = value?.match(/\b(19\d{2}|20\d{2})\b/u);
  return match ? Number(match[1]) : undefined;
}

function decadeForResult(result: SearchResult) {
  const year = yearForResult(result);
  if (year === undefined) return "未知";
  if (year < 1950) return "1949 年以前";
  return `${Math.floor(year / 10) * 10} 年代`;
}

function genresForResult(result: SearchResult) {
  return unique([
    ...(result.metadata?.work?.genres ?? []),
    ...(result.metadata?.genres ?? []),
    ...(result.metadata?.external?.omdb?.genres ?? [])
  ]);
}

function countriesForResult(result: SearchResult) {
  const structured = unique([
    ...(result.metadata?.work?.release?.countries ?? []),
    ...(result.metadata?.work?.countries ?? []),
    ...(result.metadata?.release?.countries ?? []),
    ...(result.metadata?.external?.omdb?.countries ?? [])
  ].map(normalizeCountryLabel));
  if (structured.length > 0) return structured;

  const info = result.metadata?.info ?? "";
  const match = info.match(/(?:制片)?国家\/地区\s*[:：]\s*([\s\S]*?)(?=\s*(?:语言|上映日期?|片长|集数)\s*[:：]|$)/u);
  return match ? unique(match[1].split(/\s*[/／,，]\s*/u).map(normalizeCountryLabel)) : [];
}

function companiesForResult(result: SearchResult) {
  return unique([
    ...(result.metadata?.work?.productionCompanies ?? []),
    ...(result.metadata?.productionCompanies ?? [])
  ]);
}

const countryAliases: Record<string, string> = {
  "united states": "美国",
  japan: "日本",
  "hong kong": "中国香港",
  "united kingdom": "英国",
  sweden: "瑞典",
  france: "法国",
  canada: "加拿大"
};

function normalizeCountryLabel(value: string) {
  const cleaned = value
    .replace(/\s*(?:语言|语)\s*.*$/u, "")
    .replace(/….*$/u, "")
    .trim();
  if (cleaned.length < 2) return "";
  if (value.includes("…") && /^[A-Za-z ]+$/u.test(cleaned)) return "";
  return countryAliases[cleaned.toLocaleLowerCase("en-US")] ?? cleaned;
}

function unique(values: string[]) {
  const seen = new Set<string>();
  return values.map((value) => value.trim()).filter((value) => {
    const key = value.toLocaleLowerCase("und");
    if (!value || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function increment(counts: Map<string, number>, label: string) {
  counts.set(label, (counts.get(label) ?? 0) + 1);
}

function rankedItems(counts: Map<string, number>, limit = Number.POSITIVE_INFINITY) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "zh-CN"))
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}
