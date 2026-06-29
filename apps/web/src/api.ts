import type {
  EnsureCacheResponse,
  PlaybackResponse,
  SearchResponse
} from "@wwpdw/shared";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error ?? `Request failed with ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function searchAssets(query: string) {
  const params = new URLSearchParams({ q: query });
  return request<SearchResponse>(`/api/search?${params.toString()}`);
}

export function ensureCache(assetKey: string) {
  return request<EnsureCacheResponse>("/api/cache", {
    method: "POST",
    body: JSON.stringify({ assetKey })
  });
}

export function getCacheStatus(jobId: string) {
  return request<EnsureCacheResponse>(`/api/cache/${encodeURIComponent(jobId)}`);
}

export function getPlayback(assetKey: string) {
  return request<PlaybackResponse>(`/api/playback/${encodeURIComponent(assetKey)}`);
}
