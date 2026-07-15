import type { AppTab, BrowseChannel, BrowseViewId } from "./types";

type BrowseRoute = {
  tab: AppTab;
  channel: BrowseChannel;
  view: BrowseViewId;
  query: string;
};

export function scheduleBrowseRoute(lastKey: string, route: BrowseRoute, start: () => boolean) {
  const routeKey = `${route.channel}:${route.view}`;
  if (route.tab !== "library" || route.query.trim() || lastKey === routeKey) {
    return { scheduled: false, routeKey: lastKey };
  }

  return start()
    ? { scheduled: true, routeKey }
    : { scheduled: false, routeKey: lastKey };
}
