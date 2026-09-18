export interface SiteStatisticItem {
  label: string;
  count: number;
}

export interface PeopleProgress {
  scope: "indexed_works";
  workCount: number;
  worksWithoutCredits: number;
  worksFullyLinked: number;
  knownCreditCount: number;
  linkedCreditCount: number;
  profileCount: number;
  qualityReadyCount: number;
  repairPriorities: { P0: number; P1: number; P2: number };
  qualityPolicyVersion: string;
  personCatalogUpdatedAt?: string;
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
  peopleProgress?: PeopleProgress;
}
