import type {
  EnsureCacheResponse,
  PlaybackResponse,
  SearchResponse
} from "@wwpdw/shared";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}

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
  return request<SearchResponse>(apiUrl(`/api/search?${params.toString()}`));
}

export function ensureCache(assetKey: string) {
  return request<EnsureCacheResponse>(apiUrl("/api/cache"), {
    method: "POST",
    body: JSON.stringify({ assetKey })
  });
}

export function getCacheStatus(jobId: string) {
  return request<EnsureCacheResponse>(apiUrl(`/api/cache/${encodeURIComponent(jobId)}`));
}

export function getPlayback(assetKey: string) {
  return request<PlaybackResponse>(apiUrl(`/api/playback/${encodeURIComponent(assetKey)}`));
}
