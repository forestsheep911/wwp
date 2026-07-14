export type BrowseRequest = {
  id: number;
  key: string;
};

export function shouldLoadBrowseRoute(lastRequestedKey: string, nextKey: string) {
  return lastRequestedKey !== nextKey;
}

export function browseResponseIsCurrent(current: BrowseRequest, response: BrowseRequest) {
  return current.id === response.id && current.key === response.key;
}
