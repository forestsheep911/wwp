import { entityPath, resolveIdentity } from "./public-identities";
import type { AppTab, BrowseChannel, BrowseViewId } from "./types";

export interface CinemaRoute {
  page?: "list" | "work" | "person" | "graph" | "search" | "watch" | "thread" | "notFound";
  graph?: boolean;
  scope?: string;
  threadId?: string;
  section?: string;
  params?: Record<string, string>;
  tab: AppTab;
  browseChannel: BrowseChannel;
  browseView: BrowseViewId;
  query: string;
  personId?: string;
  detailAssetKey?: string;
  playerAssetKey?: string;
}

interface CinemaHistoryState {
  app: "wwpdw-cinema";
  route: CinemaRoute;
}

export const routeTabs: AppTab[] = [
  "library",
  "people",
  "statistics",
  "cached",
  "history",
  "favorites",
  "watchlist",
  "nowPlaying",
  "help",
  "profile",
  "admin",
  "tasks",
  "forum"
];
export const browseChannels: BrowseChannel[] = ["recommended", "movie", "tv", "animation"];
export const browseViews: BrowseViewId[] = [
  "newGood",
  "recent",
  "popular",
  "topRated",
  "mostWatched",
  "doubanRank",
  "imdbRank",
  "rottenRank",
  "tspdtRank",
  "lucky"
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
  return "newGood";
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

  return routeFromUrl(new URL(window.location.href));
}

export function routeFromUrl(url: URL): CinemaRoute {
  const params = url.searchParams;
  let pathname: string;
  try { pathname = decodeURIComponent(url.pathname).replace(/\/$/, "") || "/"; } catch { pathname = "/invalid"; }
  const graph = pathname.endsWith("/graph");
  const basePath = graph ? pathname.slice(0, -6) : pathname;
  const work = basePath.match(/^\/works\/(?:.*-)?(w_[a-zA-Z0-9]+)$/);
  const person = basePath.match(/^\/people\/(?:.*-)?(p_[a-zA-Z0-9]+)$/);
  const legacyPerson = !person && basePath.match(/^\/people\/([^/]+)$/);
  const legacyWork = basePath.match(/^\/movie\/(.+)$/);
  const watch = basePath.match(/^\/watch\/(v_[a-zA-Z0-9]+)$/);
  const thread = basePath.match(/^\/forum\/([^/]+)$/);
  const section = basePath.match(/^\/(admin|profile)\/([^/]+)$/);
  const pathTab = basePath === "/" ? "library" : basePath.slice(1) === "now-playing" ? "nowPlaying" : basePath.slice(1);
  const tab: AppTab = person || legacyPerson ? "people" : section ? section[1] as AppTab : thread ? "forum" : basePath !== "/" && isAppTab(pathTab) ? pathTab : isAppTab(params.get("tab")) ? params.get("tab") as AppTab : "library";
  const personKey = person?.[1] ?? (legacyPerson ? legacyPerson[1] : undefined) ?? params.get("person") ?? undefined;
  const workKey = work?.[1] ?? legacyWork?.[1] ?? params.get("detail") ?? undefined;
  const videoKey = watch?.[1] ?? params.get("play") ?? undefined;
  const known = isAppTab(pathTab) || basePath === "/now-playing" || basePath === "/search" || work || person || legacyPerson || legacyWork || watch || thread || section;
  const invalidSection = section && !(section[1] === "profile" ? ["notices", "requests", "usage"] : ["cached", "jobs", "passes", "invites", "requests", "notices", "security", "oss-poc"]).includes(section[2]);
  const page = !known || invalidSection ? "notFound" : videoKey ? "watch" : graph ? "graph" : personKey ? "person" : workKey ? "work" : basePath === "/search" || (basePath === "/" && params.has("q")) ? "search" : thread ? "thread" : "list";
  const browseChannel = isBrowseChannel(params.get("channel")) ? params.get("channel") as BrowseChannel : "recommended";
  return { tab, page, graph, browseChannel, browseView: isBrowseView(params.get("view")) ? params.get("view") as BrowseViewId : defaultBrowseView(browseChannel),
    query: params.get("q") ?? "", scope: params.get("scope") ?? "all", threadId: thread?.[1], section: section?.[2],
    personId: personKey ? resolveIdentity("person", personKey)?.key ?? personKey : undefined,
    detailAssetKey: workKey ? resolveIdentity("work", workKey)?.key ?? workKey : undefined,
    playerAssetKey: videoKey ? resolveIdentity("video", videoKey)?.key ?? videoKey : undefined,
    params: Object.fromEntries([...params.entries()].filter(([key]) => ["kind", "decade", "rating", "genres", "availability", "seed", "depth", "limit", "branches"].includes(key))) };
}
export function historyStateRoute(state: unknown): CinemaRoute | undefined {
  const value = state as Partial<CinemaHistoryState> | undefined;
  return value?.app === "wwpdw-cinema" && value.route && isAppTab(value.route.tab) ? value.route : undefined;
}
export function routeUrl(route: CinemaRoute, currentHref = window.location.href) {
  const url = new URL(currentHref); url.search = ""; url.hash = "";
  if (route.page === "notFound") return new URL(currentHref).pathname;
  url.pathname = route.playerAssetKey ? entityPath("video", route.playerAssetKey) ?? `/watch/${encodeURIComponent(route.playerAssetKey)}`
    : route.personId ? entityPath("person", route.personId) ?? `/people/${encodeURIComponent(route.personId)}`
    : route.detailAssetKey ? entityPath("work", route.detailAssetKey) ?? (/^w_[a-zA-Z0-9]+$/.test(route.detailAssetKey) ? `/works/${route.detailAssetKey}` : `/movie/${encodeURIComponent(route.detailAssetKey)}`)
    : route.page === "search" ? "/search" : route.tab === "library" ? "/" : route.tab === "nowPlaying" ? "/now-playing" : `/${route.tab}`;
  if (route.graph && (route.personId || route.detailAssetKey)) url.pathname += "/graph";
  if (route.tab === "forum" && route.threadId) url.pathname += `/${encodeURIComponent(route.threadId)}`;
  if (["admin", "profile"].includes(route.tab) && route.section) url.pathname += `/${encodeURIComponent(route.section)}`;
  if (!route.personId && !route.detailAssetKey && !route.playerAssetKey) {
    if (route.tab === "library" && route.page !== "search") {
      if (route.browseChannel !== "recommended") url.searchParams.set("channel", route.browseChannel);
      if (route.browseView !== defaultBrowseView(route.browseChannel)) url.searchParams.set("view", route.browseView);
    }
    if (route.query.trim() && (route.page === "search" || route.tab === "people")) url.searchParams.set("q", route.query.trim());
    if (route.page === "search" && route.scope && route.scope !== "all") url.searchParams.set("scope", route.scope);
  }
  if (route.graph || (!route.personId && !route.detailAssetKey && !route.playerAssetKey && route.tab === "library" && route.page !== "search")) {
    for (const [key, value] of Object.entries(route.params ?? {})) {
      if ((route.graph ? ["depth", "limit", "branches"] : ["kind", "decade", "rating", "genres", "availability", "seed"]).includes(key) && value) url.searchParams.set(key, value);
    }
  }
  return `${url.pathname}${url.search}`;
}
export function sameRoute(left: CinemaRoute | undefined, right: CinemaRoute) {
  return Boolean(left && JSON.stringify(left) === JSON.stringify(right));
}
export function cinemaHistoryState(route: CinemaRoute): CinemaHistoryState { return { app: "wwpdw-cinema", route }; }
