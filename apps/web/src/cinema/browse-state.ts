export type BrowseRequest = {
  id: number;
  key: string;
};

export type BrowseRequestState = {
  active: BrowseRequest;
  loadingInitial: boolean;
  loadingMore: boolean;
};

export type BrowseRequestStart =
  | {
      started: false;
      state: BrowseRequestState;
    }
  | {
      started: true;
      request: BrowseRequest;
      state: BrowseRequestState;
    };

export function shouldLoadBrowseRoute(lastRequestedKey: string, nextKey: string) {
  return lastRequestedKey !== nextKey;
}

export function browseResponseIsCurrent(current: BrowseRequest, response: BrowseRequest) {
  return current.id === response.id && current.key === response.key;
}

export function startBrowseRequest(
  state: BrowseRequestState,
  options: { append: boolean; hasMore: boolean; key: string }
): BrowseRequestStart {
  if (options.append && (state.loadingInitial || state.loadingMore || !options.hasMore)) {
    return { started: false, state };
  }
  if (!options.append && state.loadingInitial && state.active.key === options.key) {
    return { started: false, state };
  }

  const request = {
    id: state.active.id + 1,
    key: options.key
  };
  return {
    started: true,
    request,
    state: {
      active: request,
      loadingInitial: !options.append,
      loadingMore: options.append
    }
  };
}

export function finishBrowseRequest(state: BrowseRequestState, request: BrowseRequest): BrowseRequestState {
  if (!browseResponseIsCurrent(state.active, request)) {
    return state;
  }

  return {
    ...state,
    loadingInitial: false,
    loadingMore: false
  };
}
