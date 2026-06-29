import type {
  AuthCheckResponse,
  CreateMemberCodeRequest,
  CreateMemberCodeResponse,
  EnsureCacheResponse,
  MemberCodeListResponse,
  PlaybackResponse,
  SearchResult,
  SearchResponse
} from "@wwpdw/shared";

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const accessKeyStorageKey = "wwpdw-access-key";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
    readonly requestId: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getAccessKey() {
  return sessionStorage.getItem(accessKeyStorageKey) ?? "";
}

export function setAccessKey(value: string) {
  sessionStorage.setItem(accessKeyStorageKey, value);
}

export function clearAccessKey() {
  sessionStorage.removeItem(accessKeyStorageKey);
}

export function isUnauthorizedError(error: unknown) {
  return error instanceof ApiError && error.statusCode === 401;
}

export function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return `${error.message} (request ${error.requestId})`;
  }

  return error instanceof Error ? error.message : fallback;
}

function apiUrl(path: string) {
  return `${apiBaseUrl}${path}`;
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const accessKey = getAccessKey();
  const requestId = createRequestId();
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-request-id": requestId,
      ...(accessKey ? { "x-wwpdw-access-key": accessKey } : {}),
      ...init?.headers
    }
  });
  const responseRequestId = response.headers.get("x-request-id") ?? requestId;

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new ApiError(
      payload.error ?? `Request failed with ${response.status}`,
      response.status,
      responseRequestId
    );
  }

  return response.json() as Promise<T>;
}

export function checkAccess() {
  return request<AuthCheckResponse>(apiUrl("/api/auth/check"));
}

export function searchAssets(query: string) {
  const params = new URLSearchParams({ q: query });
  return request<SearchResponse>(apiUrl(`/api/search?${params.toString()}`));
}

export function ensureCache(result: SearchResult) {
  return request<EnsureCacheResponse>(apiUrl("/api/cache"), {
    method: "POST",
    body: JSON.stringify({
      assetKey: result.assetKey,
      result
    })
  });
}

export function getCacheStatus(jobId: string) {
  return request<EnsureCacheResponse>(apiUrl(`/api/cache/${encodeURIComponent(jobId)}`));
}

export function getPlayback(assetKey: string) {
  return request<PlaybackResponse>(apiUrl(`/api/playback/${encodeURIComponent(assetKey)}`));
}

export function listMemberCodes() {
  return request<MemberCodeListResponse>(apiUrl("/api/admin/member-codes"));
}

export function createMemberAccessCode(input: CreateMemberCodeRequest) {
  return request<CreateMemberCodeResponse>(apiUrl("/api/admin/member-codes"), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function revokeMemberAccessCode(id: string) {
  return request<{ code: MemberCodeListResponse["codes"][number] }>(
    apiUrl(`/api/admin/member-codes/${encodeURIComponent(id)}/revoke`),
    {
      method: "POST"
    }
  );
}
