import type { AppTab, BrowseChannel, BrowseViewId } from "./types";

export interface CinemaRoute {
  tab: AppTab;
  browseChannel: BrowseChannel;
  browseView: BrowseViewId;
  query: string;
  detailAssetKey?: string;
  playerAssetKey?: string;
}

interface CinemaHistoryState {
  app: "wwpdw-cinema";
  route: CinemaRoute;
}

export const routeTabs: AppTab[] = [
  "library",
  "cached",
  "history",
  "favorites",
  "watchlist",
  "nowPlaying",
  "help",
  "admin",
  "tasks",
  "forum"
];
export const browseChannels: BrowseChannel[] = ["recommended", "movie", "tv", "animation"];
export const browseViews: BrowseViewId[] = [
  "lucky",
  "recent",
  "newGood",
  "popular",
  "topRated",
  "mostWatched",
  "doubanRank",
  "imdbRank",
  "rottenRank",
  "tspdtRank"
];

export function isAppTab(value: string | null): value is AppTab {
  return Boolean(value && routeTabs.includes(value as AppTab));
}

export function isBrowseChannel(value: string | null): value is BrowseChannel {
  return Boolean(value && browseChannels.includes(value as BrowseChannel));
}

export function isBrowseView(value: string | null): value is BrowseViewId {
  return Boolean(value && browseViews.includes(value as BrowseViewId));
}

export function defaultBrowseView(channel: BrowseChannel): BrowseViewId {
  return channel === "movie" ? "newGood" : "lucky";
}

export function routeFromLocation(): CinemaRoute {
  if (typeof window === "undefined") {
    const browseChannel = "recommended";
    return {
      tab: "library",
      browseChannel,
      browseView: defaultBrowseView(browseChannel),
      query: ""
    };
  }

  const params = new URLSearchParams(window.location.search);
  const tab = isAppTab(params.get("tab")) ? params.get("tab") as AppTab : "library";
  const browseChannel = isBrowseChannel(params.get("channel"))
    ? params.get("channel") as BrowseChannel
    : "recommended";
  const browseView = isBrowseView(params.get("view"))
    ? params.get("view") as BrowseViewId
    : defaultBrowseView(browseChannel);
  return {
    tab,
    browseChannel,
    browseView,
    query: params.get("q") ?? "",
    detailAssetKey: params.get("detail") ?? undefined,
    playerAssetKey: params.get("play") ?? undefined
  };
}

export function historyStateRoute(state: unknown): CinemaRoute | undefined {
  const candidate = state as Partial<CinemaHistoryState> | undefined;
  const route = candidate?.route as Partial<CinemaRoute> | undefined;
  if (candidate?.app !== "wwpdw-cinema" || !route || !route.tab) {
    return undefined;
  }

  const rawBrowseChannel = route.browseChannel ?? null;
  const browseChannel: BrowseChannel = isBrowseChannel(rawBrowseChannel)
    ? rawBrowseChannel
    : "recommended";

  const tab: AppTab = isAppTab(route.tab) ? route.tab : "library";
  const rawBrowseView = route.browseView ?? null;
  const browseView: BrowseViewId = isBrowseView(rawBrowseView)
    ? rawBrowseView
    : defaultBrowseView(browseChannel);

  return {
    tab,
    browseChannel,
    browseView,
    query: route.query ?? "",
    detailAssetKey: route.detailAssetKey,
    playerAssetKey: route.playerAssetKey
  };
}

export function routeUrl(route: CinemaRoute) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (route.tab !== "library") {
    url.searchParams.set("tab", route.tab);
  }
  if (route.tab === "library" && route.browseChannel !== "recommended") {
    url.searchParams.set("channel", route.browseChannel);
  }
  if (route.tab === "library" && route.browseView !== defaultBrowseView(route.browseChannel)) {
    url.searchParams.set("view", route.browseView);
  }
  if (route.query.trim()) {
    url.searchParams.set("q", route.query.trim());
  }
  if (route.detailAssetKey) {
    url.searchParams.set("detail", route.detailAssetKey);
  }
  if (route.playerAssetKey) {
    url.searchParams.set("play", route.playerAssetKey);
  }
  return `${url.pathname}${url.search}`;
}

export function sameRoute(left: CinemaRoute | undefined, right: CinemaRoute) {
  return Boolean(
    left &&
      left.tab === right.tab &&
      left.browseChannel === right.browseChannel &&
      left.browseView === right.browseView &&
      left.query === right.query &&
      left.detailAssetKey === right.detailAssetKey &&
      left.playerAssetKey === right.playerAssetKey
  );
}

export function cinemaHistoryState(route: CinemaRoute): CinemaHistoryState {
  return {
    app: "wwpdw-cinema",
    route
  };
}
