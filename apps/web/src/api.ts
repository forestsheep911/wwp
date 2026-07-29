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
  CreateForumReplyRequest,
  CreateForumReplyResponse,
  CreateForumThreadRequest,
  CreateForumThreadResponse,
  CreateMemberNoticeRequest,
  CreateMemberNoticeResponse,
  CreditPreviewRequest,
  CreditPreviewResponse,
  CreditPolicyResponse,
  DeleteCacheEntryResponse,
  DirectDownloadResponse,
  EnsureCacheResponse,
  ForumThreadResponse,
  ForumThreadsResponse,
  MemberCodeListResponse,
  MemberCreditUsageResponse,
  MemberInvitationListResponse,
  MemberNoticeListResponse,
  MarkMemberNoticeReadResponse,
  MovieSummaryRequest,
  MovieSummaryResponse,
  NowPlayingResponse,
  MovieRequestsResponse,
  PlaybackAdmissionResponse,
  PlaybackCapacity,
  PlaybackLine,
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
import { apiRequestUrl, healthRequestUrl, normalizeApiBaseUrl } from "./api-routing";
import type { BrowseChannel } from "./cinema/types";
import type { BrowseViewId } from "./cinema/types";
import { unwrapAuthenticatedSession, type AuthenticatedSessionEnvelope } from "./cinema/auth-session";
import { retryAfterCsrfRecovery } from "./csrf-recovery";

const apiBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL);
const backendWakeTimeoutMs = 90_000;

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

let csrfToken = "";
export function getAccessKey() { return ""; }
export function setAccessKey(_value: string) { /* authentication is server-cookie-only */ }
export function clearAccessKey() { csrfToken = ""; }

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
  return apiRequestUrl(apiBaseUrl, path);
}

export async function wakeBackend() {
  const response = await fetch(healthRequestUrl(apiBaseUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(backendWakeTimeoutMs)
  });
  return response.ok;
}

export async function getPlaybackCapacity(): Promise<PlaybackCapacity> {
  const response = await fetch(healthRequestUrl(apiBaseUrl), {
    cache: "no-store",
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) {
    throw new Error(`Health request failed with ${response.status}`);
  }
  const health = await response.json() as {
    playback?: {
      activeStreams?: number;
      maximumStreams?: number;
      queued?: number;
      level?: PlaybackCapacity["level"];
      queueEnabled?: boolean;
    };
  };
  const playback = health.playback;
  return {
    enabled: Boolean(playback?.queueEnabled),
    active: playback?.activeStreams ?? 0,
    maximum: playback?.maximumStreams ?? 0,
    queued: playback?.queued ?? 0,
    level: playback?.level ?? "low"
  };
}

function createRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const unsafeRequest = !["GET", "HEAD"].includes(method);
  const performRequest = async (): Promise<T> => {
    const requestId = createRequestId();
    const response = await fetch(url, {
      ...init,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": requestId,
        ...(unsafeRequest && csrfToken ? { "x-wwpdw-csrf-token": csrfToken } : {}),
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
  };

  return retryAfterCsrfRecovery(
    performRequest,
    () => checkAccess(),
    (error) => unsafeRequest
      && error instanceof ApiError
      && error.statusCode === 403
      && error.message === "Cross-site request verification failed."
  );
}

export function checkAccess() {
  return request<AuthCheckResponse & { csrfToken?: string }>(apiUrl("/api/auth/check")).then((auth) => {
    csrfToken = auth.csrfToken ?? "";
    return auth;
  });
}

export function login(passcode: string) {
  return request<AuthenticatedSessionEnvelope>(apiUrl("/api/auth/login"), { method: "POST", body: JSON.stringify({ passcode }) }).then((response) => {
    csrfToken = response.csrfToken ?? "";
    return unwrapAuthenticatedSession(response);
  });
}

export function logout() { return request<{ ok: true }>(apiUrl("/api/auth/logout"), { method: "POST" }).finally(() => { csrfToken = ""; }); }

export interface BrowserSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  device?: string;
  ipAddress?: string;
  current: boolean;
}

export function listSessions() { return request<{ sessions: BrowserSession[] }>(apiUrl("/api/auth/sessions")); }
export function revokeSession(id: string) { return request<{ ok: true }>(apiUrl(`/api/auth/sessions/${encodeURIComponent(id)}`), { method: "DELETE" }); }

export function registerMember(input: RegisterMemberRequest) {
  return request<RegisterMemberResponse>(apiUrl("/api/auth/register"), {
    method: "POST",
    body: JSON.stringify(input)
  }).then((response) => { csrfToken = (response as RegisterMemberResponse & { csrfToken?: string }).csrfToken ?? ""; return response; });
}

export function changeMemberPasscode(input: ChangeMemberPasscodeRequest) {
  return request<ChangeMemberPasscodeResponse>(apiUrl("/api/auth/passcode"), {
    method: "POST",
    body: JSON.stringify(input)
  }).then((response) => { csrfToken = (response as ChangeMemberPasscodeResponse & { csrfToken?: string }).csrfToken ?? csrfToken; return response; });
}

export function updateMemberProfile(input: UpdateMemberProfileRequest) {
  return request<UpdateMemberProfileResponse>(apiUrl("/api/member/profile"), {
    method: "POST",
    body: JSON.stringify(input)
  }).then((response) => { csrfToken = (response as UpdateMemberProfileResponse & { csrfToken?: string }).csrfToken ?? csrfToken; return response; });
}

export function resetMemberPasscode(input: ResetMemberPasscodeRequest) {
  return request<ResetMemberPasscodeResponse>(apiUrl("/api/auth/reset-passcode"), {
    method: "POST",
    body: JSON.stringify(input)
  }).then((response) => { csrfToken = (response as ResetMemberPasscodeResponse & { csrfToken?: string }).csrfToken ?? ""; return response; });
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

export function listOwnNotices(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<MemberNoticeListResponse>(apiUrl(`/api/member/notices?${params.toString()}`));
}

export function markOwnNoticeRead(id: string) {
  return request<MarkMemberNoticeReadResponse>(
    apiUrl(`/api/member/notices/${encodeURIComponent(id)}/read`),
    {
      method: "POST"
    }
  );
}

export function listForumThreads(limit = 50) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<ForumThreadsResponse>(apiUrl(`/api/forum/threads?${params.toString()}`));
}

export function createForumThread(input: CreateForumThreadRequest) {
  return request<CreateForumThreadResponse>(apiUrl("/api/forum/threads"), {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function getForumThread(id: string) {
  return request<ForumThreadResponse>(apiUrl(`/api/forum/threads/${encodeURIComponent(id)}`));
}

export function createForumReply(id: string, input: CreateForumReplyRequest) {
  return request<CreateForumReplyResponse>(
    apiUrl(`/api/forum/threads/${encodeURIComponent(id)}/replies`),
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export function searchAssets(query: string, line?: PlaybackLine) {
  const params = new URLSearchParams({ q: query });
  if (line) params.set("line", line);
  return request<SearchResponse>(apiUrl(`/api/search?${params.toString()}`));
}

export function browseAssets(
  limit = 60,
  offset = 0,
  options: { mode?: "paged" | "random"; channel?: BrowseChannel; view?: BrowseViewId; line?: PlaybackLine } = {}
) {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (options.mode) {
    params.set("mode", options.mode);
  }
  if (options.channel && options.channel !== "recommended") {
    params.set("channel", options.channel);
  }
  if (options.view) {
    params.set("view", options.view);
  }
  if (options.line) {
    params.set("line", options.line);
  }
  return request<SearchResponse>(apiUrl(`/api/browse-assets?${params.toString()}`));
}

export function getNowPlaying(options: { refresh?: boolean } = {}) {
  const params = new URLSearchParams();
  if (options.refresh) {
    params.set("refresh", "true");
  }
  const query = params.toString();
  return request<NowPlayingResponse>(apiUrl(`/api/now-playing${query ? `?${query}` : ""}`));
}

export function summarizeMovie(input: MovieSummaryRequest) {
  return request<MovieSummaryResponse>(apiUrl("/api/movie-summary"), {
    method: "POST",
    body: JSON.stringify(input)
  });
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

export function ensureCache(result: SearchResult, line?: PlaybackLine) {
  return request<EnsureCacheResponse>(apiUrl("/api/cache"), {
    method: "POST",
    body: JSON.stringify({
      assetKey: result.assetKey,
      result,
      line
    })
  });
}

export function getDirectDownload(result: SearchResult) {
  return request<DirectDownloadResponse>(apiUrl("/api/direct-download"), {
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

export function requestPlaybackAdmission(assetKey: string, ticketId?: string) {
  const params = new URLSearchParams();
  if (ticketId) params.set("ticket", ticketId);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<PlaybackAdmissionResponse>(
    apiUrl(`/api/playback-admission/${encodeURIComponent(assetKey)}${suffix}`)
  );
}

export function releasePlaybackAdmission(ticketId: string) {
  return request<{ ok: true }>(
    apiUrl(`/api/playback-admission-ticket/${encodeURIComponent(ticketId)}`),
    { method: "DELETE", keepalive: true }
  );
}

export function getPlayback(assetKey: string, admissionTicketId?: string, line?: PlaybackLine) {
  const params = new URLSearchParams();
  if (admissionTicketId) params.set("admission", admissionTicketId);
  if (line) params.set("line", line);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<PlaybackResponse>(apiUrl(`/api/playback/${encodeURIComponent(assetKey)}${suffix}`));
}

export interface PlaybackClientDiagnostic {
  assetKey: string;
  event: string;
  readyState: number;
  networkState: number;
  currentTime?: number;
  duration?: number;
  bufferedEnd?: number;
  errorCode?: number;
}

export function reportPlaybackDiagnostic(diagnostic: PlaybackClientDiagnostic) {
  return request<{ ok: true }>(apiUrl("/api/playback-diagnostic"), {
    method: "POST",
    body: JSON.stringify(diagnostic)
  });
}

export function getCacheAsset(assetKey: string, line?: PlaybackLine) {
  const params = new URLSearchParams();
  if (line) params.set("line", line);
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  return request<CacheAssetLookupResponse>(apiUrl(`/api/assets/${encodeURIComponent(assetKey)}${suffix}`));
}

export function listCachedAssets(limit = 100, line?: PlaybackLine) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (line) params.set("line", line);
  return request<CachedAssetsResponse>(apiUrl(`/api/cached-assets?${params.toString()}`));
}

export function listMemberCodes() {
  return request<MemberCodeListResponse>(apiUrl("/api/admin/member-codes"));
}

export function listMemberInvitations() {
  return request<MemberInvitationListResponse>(apiUrl("/api/admin/member-invitations"));
}

export function listAdminNotices(limit = 100) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<MemberNoticeListResponse>(apiUrl(`/api/admin/notices?${params.toString()}`));
}

export function createAdminNotice(input: CreateMemberNoticeRequest) {
  return request<CreateMemberNoticeResponse>(apiUrl("/api/admin/notices"), {
    method: "POST",
    body: JSON.stringify(input)
  });
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

export interface AdminOssPlaybackPocStatus {
  enabled: boolean;
  expiresMinutes: number;
  mediaUrl?: string;
  objectKey?: string;
  reason?: string;
}

export function getAdminOssPlaybackPocStatus() {
  return request<AdminOssPlaybackPocStatus>(apiUrl("/api/admin/oss-playback-poc"));
}

export type AdminOssPreparationStatus =
  | "queued"
  | "running"
  | "ready"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface AdminOssPreparationJob {
  id: string;
  assetKey: string;
  title: string;
  objectKey: string;
  taskId: string;
  status: AdminOssPreparationStatus;
  progress: number;
  message: string;
  expectedBytes?: number;
  contentLength?: number;
  contentType?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export function listAdminOssPreparations(limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  return request<{
    enabled: boolean;
    concurrency: number;
    jobs: AdminOssPreparationJob[];
  }>(apiUrl(`/api/admin/oss-preparations?${params.toString()}`));
}

export function createAdminOssPreparation(assetKey: string) {
  return request<{ job: AdminOssPreparationJob }>(apiUrl("/api/admin/oss-preparations"), {
    method: "POST",
    body: JSON.stringify({ assetKey })
  });
}

export function cancelAdminOssPreparation(id: string) {
  return request<{ job: AdminOssPreparationJob }>(
    apiUrl(`/api/admin/oss-preparations/${encodeURIComponent(id)}/cancel`),
    { method: "POST" }
  );
}

export function deleteAdminOssPreparation(id: string) {
  return request<{ ok: true }>(
    apiUrl(`/api/admin/oss-preparations/${encodeURIComponent(id)}`),
    { method: "DELETE" }
  );
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
