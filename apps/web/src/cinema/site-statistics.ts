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
