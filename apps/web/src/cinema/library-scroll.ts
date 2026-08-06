import type { BrowseChannel, BrowseViewId } from "./types";

export interface LibraryScrollRoute {
  browseChannel: BrowseChannel;
  browseView: BrowseViewId;
  query: string;
}

export function libraryScrollRouteKey(route: LibraryScrollRoute) {
  return JSON.stringify([
    route.browseChannel,
    route.browseView,
    route.query.trim()
  ]);
}

export function libraryScrollTarget(savedTop: number, scrollHeight: number, viewportHeight: number) {
  const maximumTop = Math.max(0, scrollHeight - viewportHeight);
  return Math.min(Math.max(0, savedTop), maximumTop);
}
