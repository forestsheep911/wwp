import type {
  AdminCacheJobsResponse,
  AdminLoginAuditResponse,
  AdjustMemberCreditsRequest,
  AdjustMemberCreditsResponse,
  AuthCheckResponse,
  CachedAssetsResponse,
  CacheAssetLookupResponse,
  ChangeMemberPasscodeRequest,
  ChangeMemberPasscodeResponse,
  CreateResetInvitationResponse,
  CreateSignupInvitationRequest,
  CreateSignupInvitationResponse,
  CreateMovieRequestRequest,
  CreateMovieRequestResponse,
  CreditPreviewRequest,
  CreditPreviewResponse,
  CreditPolicyResponse,
  DeleteCacheEntryResponse,
  EnsureCacheResponse,
  MemberCodeListResponse,
  MemberCreditUsageResponse,
  MemberInvitationListResponse,
  MovieRequestsResponse,
  PlaybackResponse,
  RegisterMemberRequest,
  RegisterMemberResponse,
  ResetMemberPasscodeRequest,
  ResetMemberPasscodeResponse,
  SearchResult,
  SearchResponse,
  SetMemberCreditsRequest,
  SetMemberCreditsResponse,
  UpdateMemberProfileRequest,
  UpdateMemberProfileResponse,
  UpdateMovieRequestStatusRequest,
  UpdateMovieRequestStatusResponse
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

export function registerMember(input: RegisterMemberRequest) {
  return request<RegisterMemberResponse>(apiUrl("/api/auth/register"), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function changeMemberPasscode(input: ChangeMemberPasscodeRequest) {
  return request<ChangeMemberPasscodeResponse>(apiUrl("/api/auth/passcode"), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateMemberProfile(input: UpdateMemberProfileRequest) {
  return request<UpdateMemberProfileResponse>(apiUrl("/api/member/profile"), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function resetMemberPasscode(input: ResetMemberPasscodeRequest) {
  return request<ResetMemberPasscodeResponse>(apiUrl("/api/auth/reset-passcode"), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listOwnCreditUsage(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<MemberCreditUsageResponse>(apiUrl(`/api/member/credit-usage?${params.toString()}`));
}

export function createMovieRequest(input: CreateMovieRequestRequest) {
  return request<CreateMovieRequestResponse>(apiUrl("/api/member/movie-requests"), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function listOwnMovieRequests(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<MovieRequestsResponse>(apiUrl(`/api/member/movie-requests?${params.toString()}`));
}

export function searchAssets(query: string) {
  const params = new URLSearchParams({ q: query });
  return request<SearchResponse>(apiUrl(`/api/search?${params.toString()}`));
}

export function browseAssets(limit = 60, offset = 0) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return request<SearchResponse>(apiUrl(`/api/browse-assets?${params.toString()}`));
}

export function previewCredit(input: CreditPreviewRequest) {
  return request<CreditPreviewResponse>(apiUrl("/api/credit-preview"), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getCreditPolicy() {
  return request<CreditPolicyResponse>(apiUrl("/api/credit-policy"));
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

export function getCacheAsset(assetKey: string) {
  return request<CacheAssetLookupResponse>(apiUrl(`/api/assets/${encodeURIComponent(assetKey)}`));
}

export function listCachedAssets(limit = 100) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<CachedAssetsResponse>(apiUrl(`/api/cached-assets?${params.toString()}`));
}

export function listMemberCodes() {
  return request<MemberCodeListResponse>(apiUrl("/api/admin/member-codes"));
}

export function listMemberInvitations() {
  return request<MemberInvitationListResponse>(apiUrl("/api/admin/member-invitations"));
}

export function createSignupInvitation(input: CreateSignupInvitationRequest) {
  return request<CreateSignupInvitationResponse>(apiUrl("/api/admin/member-invitations"), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function createResetInvitation(id: string) {
  return request<CreateResetInvitationResponse>(
    apiUrl(`/api/admin/member-codes/${encodeURIComponent(id)}/reset-invitation`),
    {
      method: "POST"
    }
  );
}

export function revokeMemberAccessCode(id: string) {
  return request<{ code: MemberCodeListResponse["codes"][number] }>(
    apiUrl(`/api/admin/member-codes/${encodeURIComponent(id)}/revoke`),
    {
      method: "POST"
    }
  );
}

export function deleteMemberAccessCode(id: string) {
  return request<{ ok: true }>(
    apiUrl(`/api/admin/member-codes/${encodeURIComponent(id)}/delete`),
    {
      method: "POST"
    }
  );
}

export function setMemberCredits(id: string, input: SetMemberCreditsRequest) {
  return request<SetMemberCreditsResponse>(
    apiUrl(`/api/admin/member-codes/${encodeURIComponent(id)}/credits`),
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function adjustMemberCredits(input: AdjustMemberCreditsRequest) {
  return request<AdjustMemberCreditsResponse>(
    apiUrl("/api/admin/member-codes/credits/adjust"),
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function listMemberCreditUsage(id: string, limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<MemberCreditUsageResponse>(
    apiUrl(`/api/admin/member-codes/${encodeURIComponent(id)}/credit-usage?${params.toString()}`)
  );
}

export function listCacheJobs(limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<AdminCacheJobsResponse>(apiUrl(`/api/admin/cache-jobs?${params.toString()}`));
}

export function listLoginAudit(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<AdminLoginAuditResponse>(apiUrl(`/api/admin/login-audit?${params.toString()}`));
}

export function listMovieRequests(limit = 100) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<MovieRequestsResponse>(apiUrl(`/api/admin/movie-requests?${params.toString()}`));
}

export function updateMovieRequestStatus(id: string, input: UpdateMovieRequestStatusRequest) {
  return request<UpdateMovieRequestStatusResponse>(
    apiUrl(`/api/admin/movie-requests/${encodeURIComponent(id)}/status`),
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function retryCacheJob(jobId: string) {
  return request<EnsureCacheResponse>(
    apiUrl(`/api/admin/cache-jobs/${encodeURIComponent(jobId)}/retry`),
    {
      method: "POST"
    }
  );
}

export function deleteCacheJob(jobId: string) {
  return request<DeleteCacheEntryResponse>(
    apiUrl(`/api/admin/cache-jobs/${encodeURIComponent(jobId)}/delete`),
    {
      method: "POST"
    }
  );
}

export function deleteCachedAsset(assetKey: string) {
  return request<DeleteCacheEntryResponse>(
    apiUrl(`/api/admin/assets/${encodeURIComponent(assetKey)}/delete`),
    {
      method: "POST"
    }
  );
}
