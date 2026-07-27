import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { TableClient } from "@azure/data-tables";
import { DefaultAzureCredential } from "@azure/identity";
import type {
  AdminLoginAuditEntry,
  MovieRequestEntry,
  MovieRequestStatus,
  MemberCreditCharge,
  MemberCreditChargeReason,
  MemberCreditLimitReason,
  MemberCreditSummary,
  MemberCreditUsageEntry,
  CreateSignupInvitationRequest,
  CreateForumReplyRequest,
  CreateForumThreadRequest,
  CreateMemberNoticeRequest,
  ForumReplyEntry,
  ForumThreadEntry,
  ForumThreadSummary,
  GeneratedMemberInvitation,
  MemberAccessCode,
  MemberInvitation,
  MemberInvitationStatus,
  MemberNoticeEntry,
  ResetMemberPasscodeRequest,
  RegisterMemberRequest,
  UpdateMemberProfileRequest
} from "@wwpdw/shared";

type AccessBackend = "local" | "azure";

interface LocalAccessState {
  codes: Record<string, StoredMemberCode>;
  invitations?: Record<string, StoredMemberInvitation>;
  audit?: AdminLoginAuditEntry[];
  movieRequests?: StoredMovieRequest[];
  forumThreads?: StoredForumThread[];
  notices?: StoredMemberNotice[];
}

interface StoredMemberCode {
  id: string;
  name: string;
  codeHash: string;
  codePreview: string;
  createdAt: string;
  expiresAt: string;
  creditScaleVersion?: number;
  creditBalance?: number;
  creditLimit?: number;
  creditsUsed?: number;
  usage?: StoredMemberCreditUsage[];
  revokedAt?: string;
  lastUsedAt?: string;
}

interface StoredMemberCreditUsage {
  id: string;
  at: string;
  credits: number;
  reason: MemberCreditChargeReason;
  assetKey: string;
  title: string;
  requestId?: string;
  windowExpiresAt?: string;
}

interface StoredMovieRequest {
  id: string;
  text: string;
  status: MovieRequestStatus;
  requestedAt: string;
  updatedAt: string;
  requestedByMemberId?: string;
  requestedByMemberName?: string;
}

interface StoredForumAuthor {
  memberId?: string;
  memberName?: string;
  role: "admin" | "member";
}

interface StoredForumReply extends StoredForumAuthor {
  id: string;
  body: string;
  createdAt: string;
}

interface StoredForumThread extends StoredForumAuthor {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  replies?: StoredForumReply[];
}

interface StoredMemberNotice {
  id: string;
  title: string;
  body: string;
  audience: "all" | "member";
  createdAt: string;
  createdByRole: "admin" | "member";
  createdByMemberId?: string;
  createdByMemberName?: string;
  targetMemberId?: string;
  targetMemberName?: string;
  readByMemberIds?: Record<string, string>;
}

interface StoredMemberInvitation {
  id: string;
  type: "signup" | "reset";
  codeHash: string;
  codePreview: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  usedAt?: string;
  claimedByMemberId?: string;
  claimedByMemberName?: string;
  name?: string;
  creditScaleVersion?: number;
  creditBalance?: number;
  memberId?: string;
  memberName?: string;
}

type PayloadEntity = {
  partitionKey: string;
  rowKey: string;
  codeHash?: string;
  status?: string;
  payload: string;
};

const defaultAccountName = "stwwcachee9219db7";
const defaultMemberTableName = "membercodes";
const memberCreditUnitSymbol = "🍀";
const memberCreditMax = 100000;
const currentCreditScaleVersion = 2;
const legacyCreditScaleFactor = 10;
const usageRetentionMs = 90 * 24 * 60 * 60 * 1000;
const resetInvitationTtlMs = 7 * 24 * 60 * 60 * 1000;
const noExpiryAt = "9999-12-31T23:59:59.999Z";
const loginAuditRetention = 500;
const movieRequestPartitionKey = "movie-request";
const invitationPartitionKey = "invite";
const forumThreadPartitionKey = "forum-thread";
const noticePartitionKey = "notice";
const forumThreadRetention = 1000;
const forumReplyRetention = 500;
const noticeRetention = 1000;
const movieRequestStatuses: MovieRequestStatus[] = ["new", "planned", "fulfilled", "dismissed"];

function backend(): AccessBackend {
  const configured = process.env.WWPDW_AUTH_BACKEND ?? process.env.CACHE_BACKEND;
  return configured === "azure" ? "azure" : "local";
}

function localStatePath() {
  const root = process.env.WWPDW_LOCAL_DATA_DIR ?? ".local-data";
  return path.join(root, "access-state.json");
}

function tableName() {
  return process.env.AZURE_STORAGE_MEMBER_TABLE ?? defaultMemberTableName;
}

function accountName() {
  return process.env.AZURE_STORAGE_ACCOUNT_NAME ?? defaultAccountName;
}

function hashCode(code: string) {
  return createHash("sha256").update(code, "utf8").digest("hex");
}

function codePreview(code: string) {
  return `${code.slice(0, 4)}...${code.slice(-2)}`;
}

function createRawMemberCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const bytes = randomBytes(12);
    const token = Array.from(bytes)
      .map((byte) => alphabet[byte % alphabet.length])
      .join("");
    if (/[A-Za-z]/.test(token) && /[0-9]/.test(token)) {
      return token;
    }
  }

  return `A${Array.from(randomBytes(10)).map((byte) => alphabet[byte % alphabet.length]).join("")}1`;
}

function createRawInviteCode() {
  return createRawMemberCode();
}

function positiveInt(value: unknown, fallback: number, options: { min?: number; max?: number } = {}) {
  const raw = Number(value);
  const min = options.min ?? 0;
  const max = options.max ?? 10000;
  if (!Number.isFinite(raw)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.floor(raw)));
}

function defaultCredits() {
  return positiveInt(process.env.MEMBER_DEFAULT_CREDITS, 200, { min: 0, max: memberCreditMax });
}

function legacyDefaultCredits() {
  return Math.max(0, Math.floor(defaultCredits() / legacyCreditScaleFactor));
}

function usageEvents(code: StoredMemberCode) {
  return code.usage ?? [];
}

function movieRequestStatus(value: unknown): MovieRequestStatus {
  return movieRequestStatuses.includes(value as MovieRequestStatus) ? value as MovieRequestStatus : "new";
}

function usageCredits(events: StoredMemberCreditUsage[]) {
  return events.reduce((total, event) => total + Math.max(0, event.credits), 0);
}

function scaledLegacyCredits(value: number | undefined, fallback = 0) {
  const legacyValue = positiveInt(value, fallback, { min: 0, max: 1000000 });
  return positiveInt(legacyValue * legacyCreditScaleFactor, fallback * legacyCreditScaleFactor, {
    min: 0,
    max: memberCreditMax
  });
}

function migrateStoredCodeCreditScale(code: StoredMemberCode) {
  const scaleVersion = positiveInt(code.creditScaleVersion, 1, { min: 1, max: currentCreditScaleVersion });
  if (scaleVersion >= currentCreditScaleVersion) {
    return;
  }

  if (scaleVersion < 2) {
    code.creditBalance = scaledLegacyCredits(code.creditBalance, legacyDefaultCredits());
    if (code.creditLimit !== undefined) {
      code.creditLimit = scaledLegacyCredits(code.creditLimit);
    }
    if (code.creditsUsed !== undefined) {
      code.creditsUsed = scaledLegacyCredits(code.creditsUsed);
    }
    code.usage = usageEvents(code).map((event) => ({
      ...event,
      credits: scaledLegacyCredits(event.credits)
    }));
  }

  code.creditScaleVersion = currentCreditScaleVersion;
}

function migrateStoredInvitationCreditScale(invitation: StoredMemberInvitation) {
  const scaleVersion = positiveInt(invitation.creditScaleVersion, 1, { min: 1, max: currentCreditScaleVersion });
  if (scaleVersion >= currentCreditScaleVersion) {
    return;
  }

  if (scaleVersion < 2 && invitation.creditBalance !== undefined) {
    invitation.creditBalance = scaledLegacyCredits(invitation.creditBalance, legacyDefaultCredits());
  }

  invitation.creditScaleVersion = currentCreditScaleVersion;
}

function pruneUsage(code: StoredMemberCode, now = new Date()) {
  const cutoff = now.getTime() - usageRetentionMs;
  code.usage = usageEvents(code).filter((event) => {
    const at = new Date(event.at).getTime();
    return Number.isFinite(at) && at >= cutoff;
  });
}

function prepareStoredCode(code: StoredMemberCode, now = new Date()) {
  code.usage = usageEvents(code);
  if (code.creditBalance === undefined) {
    const legacyLimit = positiveInt(code.creditLimit, legacyDefaultCredits(), { min: 0, max: 10000 });
    const legacyUsed = positiveInt(code.creditsUsed, usageCredits(code.usage), { min: 0, max: 1000000 });
    code.creditBalance = Math.max(0, legacyLimit - legacyUsed);
  }
  migrateStoredCodeCreditScale(code);
  code.creditBalance = positiveInt(code.creditBalance, defaultCredits(), { min: 0, max: memberCreditMax });
  pruneUsage(code, now);
  return code;
}

function creditSummary(code: StoredMemberCode, now = new Date()): MemberCreditSummary {
  const prepared = prepareStoredCode(code, now);
  return {
    unit: "clover",
    unitSymbol: memberCreditUnitSymbol,
    remaining: prepared.creditBalance ?? 0
  };
}

function creditUsageList(code: StoredMemberCode, limit: number): MemberCreditUsageList {
  prepareStoredCode(code);
  const boundedLimit = positiveInt(limit, 50, { min: 1, max: 200 });
  const entries = usageEvents(code)
    .slice()
    .sort((left, right) => right.at.localeCompare(left.at))
    .slice(0, boundedLimit)
    .map((event) => ({
      id: event.id,
      credits: event.credits,
      reason: event.reason,
      assetKey: event.assetKey,
      title: event.title,
      chargedAt: event.at,
      requestId: event.requestId,
      windowExpiresAt: event.windowExpiresAt
    }));
  return {
    code: publicCode(code),
    entries
  };
}

function memberCreditDenial(summary: MemberCreditSummary, credits: number): MemberCreditLimitReason | undefined {
  if (summary.remaining < credits) {
    return "balance";
  }

  return undefined;
}

function memberName(value: string) {
  return value.trim().slice(0, 80) || "Family member";
}

function storedMemberCode(input: { name: string; rawCode: string; credits?: number }) {
  const now = new Date().toISOString();
  const stored: StoredMemberCode = {
    id: randomUUID(),
    name: memberName(input.name),
    codeHash: hashCode(input.rawCode),
    codePreview: codePreview(input.rawCode),
    createdAt: now,
    expiresAt: noExpiryAt,
    creditScaleVersion: currentCreditScaleVersion,
    creditBalance: positiveInt(input.credits, defaultCredits(), { min: 0, max: memberCreditMax }),
    usage: []
  };
  return stored;
}

function storedSignupInvitation(input: { rawCode: string; credits?: number }): StoredMemberInvitation {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    type: "signup",
    codeHash: hashCode(input.rawCode),
    codePreview: codePreview(input.rawCode),
    createdAt: now,
    creditScaleVersion: currentCreditScaleVersion,
    creditBalance: positiveInt(input.credits, defaultCredits(), { min: 0, max: memberCreditMax })
  };
}

function storedResetInvitation(input: { rawCode: string; member: StoredMemberCode }): StoredMemberInvitation {
  const now = new Date();
  return {
    id: randomUUID(),
    type: "reset",
    codeHash: hashCode(input.rawCode),
    codePreview: codePreview(input.rawCode),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + resetInvitationTtlMs).toISOString(),
    memberId: input.member.id,
    memberName: input.member.name
  };
}

function storedMovieRequest(input: CreateMovieRequestInput): StoredMovieRequest {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    text: input.text.trim().slice(0, 2000),
    status: "new",
    requestedAt: now,
    updatedAt: now,
    requestedByMemberId: input.memberId,
    requestedByMemberName: input.memberName
  };
}

function forumText(value: string, maxLength: number) {
  return value.trim().replace(/\r\n/g, "\n").slice(0, maxLength);
}

function forumAuthor(input: CreateForumAuthorInput): StoredForumAuthor {
  return {
    role: input.role,
    memberId: input.memberId,
    memberName: input.memberName
  };
}

function storedForumThread(input: CreateForumThreadInput): StoredForumThread {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    title: forumText(input.title, 120),
    body: forumText(input.body, 5000),
    createdAt: now,
    updatedAt: now,
    replies: [],
    ...forumAuthor(input)
  };
}

function storedForumReply(input: CreateForumReplyInput): StoredForumReply {
  return {
    id: randomUUID(),
    body: forumText(input.body, 5000),
    createdAt: new Date().toISOString(),
    ...forumAuthor(input)
  };
}

function noticeText(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

function storedMemberNotice(input: CreateMemberNoticeRequest & CreateForumAuthorInput & { targetMemberName?: string }): StoredMemberNotice {
  return {
    id: randomUUID(),
    title: noticeText(input.title, 120),
    body: noticeText(input.body, 4000),
    audience: input.audience,
    createdAt: new Date().toISOString(),
    createdByRole: input.role,
    createdByMemberId: input.memberId,
    createdByMemberName: input.memberName,
    targetMemberId: input.targetMemberId,
    targetMemberName: input.targetMemberName,
    readByMemberIds: {}
  };
}

function publicMovieRequest(request: StoredMovieRequest): MovieRequestEntry {
  const requestedAt = request.requestedAt || request.updatedAt || new Date(0).toISOString();
  return {
    id: request.id,
    text: request.text,
    status: movieRequestStatus(request.status),
    requestedAt,
    updatedAt: request.updatedAt || requestedAt,
    requestedByMemberId: request.requestedByMemberId,
    requestedByMemberName: request.requestedByMemberName
  };
}

function publicMemberNotice(notice: StoredMemberNotice, memberId?: string): MemberNoticeEntry {
  return {
    id: notice.id,
    title: notice.title,
    body: notice.body,
    audience: notice.audience,
    createdAt: notice.createdAt,
    createdByRole: notice.createdByRole,
    createdByMemberId: notice.createdByMemberId,
    createdByMemberName: notice.createdByMemberName,
    targetMemberId: notice.targetMemberId,
    targetMemberName: notice.targetMemberName,
    readAt: memberId ? notice.readByMemberIds?.[memberId] : undefined
  };
}

function noticeVisibleToMember(notice: StoredMemberNotice, memberId: string) {
  return notice.audience === "all" || notice.targetMemberId === memberId;
}

function listMemberNoticeEntries(notices: StoredMemberNotice[], input: { memberId?: string; limit: number }) {
  const boundedLimit = positiveInt(input.limit, 50, { min: 1, max: 200 });
  return notices
    .filter((notice) => !input.memberId || noticeVisibleToMember(notice, input.memberId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, boundedLimit)
    .map((notice) => publicMemberNotice(notice, input.memberId));
}

function publicForumReply(reply: StoredForumReply): ForumReplyEntry {
  return {
    id: reply.id,
    body: reply.body,
    createdAt: reply.createdAt,
    authorMemberId: reply.memberId,
    authorMemberName: reply.memberName,
    authorRole: reply.role
  };
}

function latestForumReply(replies: StoredForumReply[]) {
  return replies
    .slice()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function publicForumThreadSummary(thread: StoredForumThread): ForumThreadSummary {
  const replies = thread.replies ?? [];
  const latestReply = latestForumReply(replies);
  return {
    id: thread.id,
    title: thread.title,
    body: thread.body,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    authorMemberId: thread.memberId,
    authorMemberName: thread.memberName,
    authorRole: thread.role,
    replyCount: replies.length,
    lastReplyAt: latestReply?.createdAt,
    latestReply: latestReply ? publicForumReply(latestReply) : undefined
  };
}

function publicForumThread(thread: StoredForumThread): ForumThreadEntry {
  return {
    ...publicForumThreadSummary(thread),
    replies: (thread.replies ?? [])
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map(publicForumReply)
  };
}

function forumThreadSortKey(thread: StoredForumThread) {
  return latestForumReply(thread.replies ?? [])?.createdAt ?? thread.updatedAt ?? thread.createdAt;
}

function listForumThreadSummaries(threads: StoredForumThread[], limit: number) {
  const boundedLimit = positiveInt(limit, 50, { min: 1, max: 200 });
  return threads
    .slice()
    .sort((left, right) => forumThreadSortKey(right).localeCompare(forumThreadSortKey(left)))
    .slice(0, boundedLimit)
    .map(publicForumThreadSummary);
}

function listMovieRequestEntries(requests: StoredMovieRequest[], input: ListMovieRequestsInput) {
  const boundedLimit = positiveInt(input.limit, 50, { min: 1, max: 200 });
  return requests
    .filter((request) => !input.memberId || request.requestedByMemberId === input.memberId)
    .map(publicMovieRequest)
    .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
    .slice(0, boundedLimit);
}

function setCreditsOnStoredCode(code: StoredMemberCode, credits: number) {
  prepareStoredCode(code);
  code.creditBalance = positiveInt(credits, 0, { min: 0, max: memberCreditMax });
  return publicCode(code);
}

function chargeStoredCode(code: StoredMemberCode, input: ChargeMemberCreditsInput): MemberCreditChargeResult {
  const now = new Date();
  const credits = positiveInt(input.credits, 1, { min: 1, max: memberCreditMax });
  prepareStoredCode(code, now);
  const summary = creditSummary(code, now);
  const denial = memberCreditDenial(summary, credits);
  if (denial) {
    return {
      ok: false,
      code: publicCode(code),
      reason: denial
    };
  }

  const charge: MemberCreditCharge = {
    credits,
    reason: input.reason ?? "cache_reserved",
    assetKey: input.assetKey,
    title: input.title,
    chargedAt: now.toISOString(),
    windowExpiresAt: input.windowExpiresAt
  };
  const usage: StoredMemberCreditUsage = {
    id: randomUUID(),
    at: charge.chargedAt,
    credits,
    reason: charge.reason,
    assetKey: input.assetKey,
    title: input.title,
    requestId: input.requestId,
    windowExpiresAt: input.windowExpiresAt
  };
  code.usage = [usage, ...usageEvents(code)];
  code.creditBalance = Math.max(0, (code.creditBalance ?? 0) - credits);
  pruneUsage(code, now);

  return {
    ok: true,
    code: publicCode(code),
    charge
  };
}

function playbackWindowExpiresAt(event: StoredMemberCreditUsage, windowMs: number) {
  const chargedAt = new Date(event.at).getTime();
  if (!Number.isFinite(chargedAt)) {
    return undefined;
  }

  return new Date(chargedAt + windowMs).toISOString();
}

function recentPlaybackCharge(
  code: StoredMemberCode,
  input: ChargeMemberPlaybackInput,
  now = new Date()
) {
  prepareStoredCode(code, now);
  const windowMs = input.windowHours * 60 * 60 * 1000;
  const cutoff = now.getTime() - windowMs;
  return usageEvents(code)
    .filter((event) => event.reason === "playback_stream" && event.assetKey === input.assetKey)
    .filter((event) => {
      const at = new Date(event.at).getTime();
      return Number.isFinite(at) && at >= cutoff;
    })
    .sort((left, right) => right.at.localeCompare(left.at))[0];
}

function chargeStoredPlayback(code: StoredMemberCode, input: ChargeMemberPlaybackInput): MemberPlaybackChargeResult {
  const now = new Date();
  const windowMs = input.windowHours * 60 * 60 * 1000;
  const previous = recentPlaybackCharge(code, input, now);
  if (previous) {
    return {
      ok: true,
      charged: false,
      code: publicCode(code),
      windowExpiresAt: previous.windowExpiresAt ?? playbackWindowExpiresAt(previous, windowMs)
    };
  }

  const windowExpiresAt = new Date(now.getTime() + windowMs).toISOString();
  const result = chargeStoredCode(code, {
    credits: input.credits,
    reason: "playback_stream",
    assetKey: input.assetKey,
    title: input.title,
    requestId: input.requestId,
    windowExpiresAt
  });
  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
    charged: true,
    code: result.code,
    charge: result.charge,
    windowExpiresAt
  };
}

function statusFor(code: StoredMemberCode): MemberAccessCode["status"] {
  if (code.revokedAt) {
    return "revoked";
  }

  return "active";
}

function invitationStatus(invitation: StoredMemberInvitation, now = new Date()): MemberInvitationStatus {
  if (invitation.revokedAt) {
    return "revoked";
  }

  if (invitation.usedAt) {
    return "used";
  }

  if (invitation.expiresAt && new Date(invitation.expiresAt).getTime() <= now.getTime()) {
    return "expired";
  }

  return "unused";
}

function shouldRevokeMemberResetInvitation(
  invitation: StoredMemberInvitation,
  memberId: string,
  exceptId?: string,
  now = new Date()
) {
  return invitation.id !== exceptId
    && invitation.type === "reset"
    && invitation.memberId === memberId
    && invitationStatus(invitation, now) === "unused";
}

function publicCode(code: StoredMemberCode): MemberAccessCode {
  return {
    id: code.id,
    name: code.name,
    codePreview: code.codePreview,
    createdAt: code.createdAt,
    expiresAt: code.expiresAt,
    status: statusFor(code),
    lastUsedAt: code.lastUsedAt,
    credits: creditSummary(code)
  };
}

function publicInvitation(
  invitation: StoredMemberInvitation,
  members: Record<string, StoredMemberCode> = {}
): MemberInvitation {
  migrateStoredInvitationCreditScale(invitation);
  const claimedMember = invitation.claimedByMemberId ? members[invitation.claimedByMemberId] : undefined;
  const targetMember = invitation.memberId ? members[invitation.memberId] : undefined;
  const credits = invitation.creditBalance === undefined
    ? undefined
    : {
      unit: "clover" as const,
      unitSymbol: memberCreditUnitSymbol,
      remaining: positiveInt(invitation.creditBalance, defaultCredits(), { min: 0, max: memberCreditMax })
    };
  return {
    id: invitation.id,
    type: invitation.type,
    codePreview: invitation.codePreview,
    createdAt: invitation.createdAt,
    expiresAt: invitation.expiresAt,
    status: invitationStatus(invitation),
    name: invitation.name,
    credits,
    memberId: invitation.memberId,
    memberName: targetMember?.name ?? invitation.memberName,
    usedAt: invitation.usedAt,
    claimedByMemberId: invitation.claimedByMemberId,
    claimedByMemberName: claimedMember?.name ?? invitation.claimedByMemberName
  };
}

function serialize<T>(payload: T) {
  return JSON.stringify(payload);
}

function deserialize<T>(entity: Pick<PayloadEntity, "payload">) {
  return JSON.parse(entity.payload) as T;
}

function normalizeState(state: LocalAccessState): LocalAccessState {
  state.invitations ??= {};
  state.audit ??= [];
  state.movieRequests ??= [];
  state.forumThreads ??= [];
  state.notices ??= [];
  return state;
}

function isConflict(error: unknown) {
  return (error as { statusCode?: number }).statusCode === 409;
}

function isNotFound(error: unknown) {
  const statusCode = (error as { statusCode?: number }).statusCode;
  const code = (error as { code?: string }).code;
  return statusCode === 404 || code === "ResourceNotFound";
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface AccessIdentity {
  role: "admin" | "member";
  memberId?: string;
  memberName?: string;
  credits?: MemberCreditSummary;
}

export type MemberCreditChargeResult =
  | {
    ok: true;
    code: MemberAccessCode;
    charge: MemberCreditCharge;
  }
  | {
    ok: false;
    code: MemberAccessCode;
    reason: MemberCreditLimitReason;
  };

export type MemberPlaybackChargeResult =
  | {
    ok: true;
    charged: true;
    code: MemberAccessCode;
    charge: MemberCreditCharge;
    windowExpiresAt: string;
  }
  | {
    ok: true;
    charged: false;
    code: MemberAccessCode;
    windowExpiresAt?: string;
  }
  | {
    ok: false;
    code: MemberAccessCode;
    reason: MemberCreditLimitReason;
  };

export type MemberRegistrationResult =
  | {
    ok: true;
    code: MemberAccessCode;
  }
  | {
    ok: false;
    reason: "duplicate" | "invalid_invite";
  };

export type MemberResetPasscodeResult =
  | {
    ok: true;
    code: MemberAccessCode;
  }
  | {
    ok: false;
    reason: "not_found" | "duplicate" | "invalid_invite";
  };

export type MemberPasscodeUpdateResult =
  | {
    ok: true;
    code: MemberAccessCode;
  }
  | {
    ok: false;
    reason: "not_found" | "duplicate" | "invalid_current";
  };

export interface MemberCreditUsageList {
  code: MemberAccessCode;
  entries: MemberCreditUsageEntry[];
}

export interface MemberCreditAdjustmentResult {
  codes: MemberAccessCode[];
  adjustedCount: number;
  delta: number;
}

export interface ChargeMemberCreditsInput {
  credits: number;
  assetKey: string;
  title: string;
  requestId?: string;
  reason?: MemberCreditChargeReason;
  windowExpiresAt?: string;
}

export interface ChargeMemberPlaybackInput {
  credits: number;
  assetKey: string;
  title: string;
  requestId?: string;
  windowHours: number;
}

export interface CreateMovieRequestInput {
  text: string;
  memberId: string;
  memberName?: string;
}

export interface CreateForumAuthorInput {
  role: "admin" | "member";
  memberId?: string;
  memberName?: string;
}

export interface CreateForumThreadInput extends CreateForumAuthorInput, CreateForumThreadRequest {}

export interface CreateForumReplyInput extends CreateForumAuthorInput, CreateForumReplyRequest {}

export interface CreateMemberNoticeInput extends CreateForumAuthorInput, CreateMemberNoticeRequest {}

export interface ListMovieRequestsInput {
  memberId?: string;
  limit: number;
}

export interface ListMemberNoticesInput {
  memberId?: string;
  limit: number;
}

export interface AccessStore {
  readonly backend: AccessBackend;
  readonly description: string;
  createSignupInvitation(input: CreateSignupInvitationRequest): Promise<GeneratedMemberInvitation>;
  createResetInvitation(memberId: string): Promise<GeneratedMemberInvitation | undefined>;
  listMemberInvitations(): Promise<MemberInvitation[]>;
  registerMember(input: RegisterMemberRequest): Promise<MemberRegistrationResult>;
  resetMemberPasscode(input: ResetMemberPasscodeRequest): Promise<MemberResetPasscodeResult>;
  listMemberCodes(): Promise<MemberAccessCode[]>;
  setMemberCredits(id: string, credits: number): Promise<MemberAccessCode | undefined>;
  adjustMemberCredits(delta: number): Promise<MemberCreditAdjustmentResult>;
  changeMemberPasscode(id: string, currentPasscode: string, newPasscode: string): Promise<MemberPasscodeUpdateResult>;
  updateMemberProfile(id: string, input: UpdateMemberProfileRequest): Promise<MemberPasscodeUpdateResult>;
  listMemberCreditUsage(id: string, limit: number): Promise<MemberCreditUsageList | undefined>;
  chargeMemberCredits(id: string, input: ChargeMemberCreditsInput): Promise<MemberCreditChargeResult | undefined>;
  chargeMemberPlayback(id: string, input: ChargeMemberPlaybackInput): Promise<MemberPlaybackChargeResult | undefined>;
  createMovieRequest(input: CreateMovieRequestInput): Promise<MovieRequestEntry>;
  listMovieRequests(input: ListMovieRequestsInput): Promise<MovieRequestEntry[]>;
  updateMovieRequestStatus(id: string, status: MovieRequestStatus): Promise<MovieRequestEntry | undefined>;
  createForumThread(input: CreateForumThreadInput): Promise<ForumThreadEntry>;
  listForumThreads(limit: number): Promise<ForumThreadSummary[]>;
  getForumThread(id: string): Promise<ForumThreadEntry | undefined>;
  createForumReply(threadId: string, input: CreateForumReplyInput): Promise<{ thread: ForumThreadEntry; reply: ForumReplyEntry } | undefined>;
  createMemberNotice(input: CreateMemberNoticeInput): Promise<MemberNoticeEntry | undefined>;
  listMemberNotices(input: ListMemberNoticesInput): Promise<MemberNoticeEntry[]>;
  markMemberNoticeRead(id: string, memberId: string): Promise<MemberNoticeEntry | undefined>;
  recordLoginAudit(entry: AdminLoginAuditEntry): Promise<void>;
  listLoginAudit(limit: number): Promise<AdminLoginAuditEntry[]>;
  revokeMemberCode(id: string): Promise<MemberAccessCode | undefined>;
  deleteMemberCode(id: string): Promise<boolean>;
  getMemberIdentity(id: string): Promise<AccessIdentity | undefined>;
  findMemberByCode(code: string): Promise<AccessIdentity | undefined>;
  getHealth(): Promise<Record<string, unknown>>;
}

export function createAccessStore(): AccessStore {
  return backend() === "azure" ? new AzureAccessStore() : new LocalAccessStore(localStatePath());
}

class LocalAccessStore implements AccessStore {
  readonly backend = "local" as const;
  readonly description: string;

  constructor(private readonly statePath: string) {
    this.description = `local:${statePath}`;
  }

  async getHealth() {
    return {
      backend: this.backend,
      statePath: this.statePath
    };
  }

  async createSignupInvitation(input: CreateSignupInvitationRequest) {
    return this.updateState((state) => {
      let rawCode = createRawInviteCode();
      for (let attempt = 0; attempt < 10 && this.accessHashExists(state, hashCode(rawCode)); attempt += 1) {
        rawCode = createRawInviteCode();
      }
      const stored = storedSignupInvitation({
        rawCode,
        credits: input.credits
      });
      state.invitations![stored.id] = stored;
      return {
        ...publicInvitation(stored),
        code: rawCode
      };
    });
  }

  async createResetInvitation(memberId: string) {
    return this.updateState((state) => {
      const member = state.codes[memberId];
      if (!member) {
        return undefined;
      }

      let rawCode = createRawInviteCode();
      for (let attempt = 0; attempt < 10 && this.accessHashExists(state, hashCode(rawCode)); attempt += 1) {
        rawCode = createRawInviteCode();
      }
      const stored = storedResetInvitation({ rawCode, member });
      const revokedAt = new Date().toISOString();
      for (const invitation of Object.values(state.invitations ?? {})) {
        if (shouldRevokeMemberResetInvitation(invitation, member.id, stored.id)) {
          invitation.revokedAt = revokedAt;
        }
      }
      state.invitations![stored.id] = stored;
      return {
        ...publicInvitation(stored),
        code: rawCode
      };
    });
  }

  async listMemberInvitations() {
    const state = await this.readState();
    return Object.values(state.invitations ?? {})
      .map((invitation) => publicInvitation(invitation, state.codes))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async registerMember(input: RegisterMemberRequest) {
    return this.updateState((state) => {
      if (!input.inviteCode) {
        return {
          ok: false as const,
          reason: "invalid_invite" as const
        };
      }

      const invitation = this.findInvitationByRawCode(state, input.inviteCode);
      if (!invitation || invitation.type !== "signup" || invitationStatus(invitation) !== "unused") {
        return {
          ok: false as const,
          reason: "invalid_invite" as const
        };
      }
      migrateStoredInvitationCreditScale(invitation);

      if (this.accessHashExists(state, hashCode(input.passcode))) {
        return {
          ok: false as const,
          reason: "duplicate" as const
        };
      }

      const stored = storedMemberCode({
        name: input.name,
        rawCode: input.passcode,
        credits: invitation.creditBalance
      });
      state.codes[stored.id] = stored;
      invitation.usedAt = new Date().toISOString();
      invitation.claimedByMemberId = stored.id;
      invitation.claimedByMemberName = stored.name;
      return {
        ok: true as const,
        code: publicCode(stored)
      };
    });
  }

  async resetMemberPasscode(input: ResetMemberPasscodeRequest) {
    return this.updateState((state) => {
      const invitation = this.findInvitationByRawCode(state, input.inviteCode);
      if (!invitation || invitation.type !== "reset" || invitationStatus(invitation) !== "unused" || !invitation.memberId) {
        return {
          ok: false as const,
          reason: "invalid_invite" as const
        };
      }

      const code = state.codes[invitation.memberId];
      if (!code) {
        return {
          ok: false as const,
          reason: "not_found" as const
        };
      }

      const codeHash = hashCode(input.newPasscode);
      if (this.codeHashExists(state, codeHash, code.id) || this.invitationHashExists(state, codeHash, invitation.id)) {
        return {
          ok: false as const,
          reason: "duplicate" as const
        };
      }

      code.codeHash = codeHash;
      code.codePreview = codePreview(input.newPasscode);
      invitation.usedAt = new Date().toISOString();
      invitation.claimedByMemberId = code.id;
      const revokedAt = new Date().toISOString();
      for (const otherInvitation of Object.values(state.invitations ?? {})) {
        if (shouldRevokeMemberResetInvitation(otherInvitation, code.id, invitation.id)) {
          otherInvitation.revokedAt = revokedAt;
        }
      }
      return {
        ok: true as const,
        code: publicCode(code)
      };
    });
  }

  async listMemberCodes() {
    const state = await this.readState();
    return Object.values(state.codes)
      .map(publicCode)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async setMemberCredits(id: string, credits: number) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return undefined;
      }

      return setCreditsOnStoredCode(code, credits);
    });
  }

  async adjustMemberCredits(delta: number) {
    return this.updateState((state) => {
      let adjustedCount = 0;
      const boundedDelta = positiveInt(Math.abs(delta), 0, { min: 0, max: memberCreditMax }) * Math.sign(delta);
      for (const code of Object.values(state.codes)) {
        if (statusFor(code) !== "active") {
          continue;
        }

        prepareStoredCode(code);
        setCreditsOnStoredCode(code, (code.creditBalance ?? 0) + boundedDelta);
        adjustedCount += 1;
      }

      return {
        codes: Object.values(state.codes)
          .map(publicCode)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
        adjustedCount,
        delta: boundedDelta
      };
    });
  }

  async changeMemberPasscode(id: string, currentPasscode: string, newPasscode: string) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return {
          ok: false as const,
          reason: "not_found" as const
        };
      }

      if (code.codeHash !== hashCode(currentPasscode)) {
        return {
          ok: false as const,
          reason: "invalid_current" as const
        };
      }

      const newCodeHash = hashCode(newPasscode);
      if (this.codeHashExists(state, newCodeHash, id) || this.invitationHashExists(state, newCodeHash)) {
        return {
          ok: false as const,
          reason: "duplicate" as const
        };
      }

      code.codeHash = newCodeHash;
      code.codePreview = codePreview(newPasscode);
      return {
        ok: true as const,
        code: publicCode(code)
      };
    });
  }

  async updateMemberProfile(id: string, input: UpdateMemberProfileRequest) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return {
          ok: false as const,
          reason: "not_found" as const
        };
      }

      const nextName = input.name?.trim();
      if (nextName) {
        code.name = memberName(nextName);
      }

      if (input.newPasscode) {
        const newCodeHash = hashCode(input.newPasscode);
        if (this.codeHashExists(state, newCodeHash, id) || this.invitationHashExists(state, newCodeHash)) {
          return {
            ok: false as const,
            reason: "duplicate" as const
          };
        }

        code.codeHash = newCodeHash;
        code.codePreview = codePreview(input.newPasscode);
      }

      return {
        ok: true as const,
        code: publicCode(code)
      };
    });
  }

  async listMemberCreditUsage(id: string, limit: number) {
    const state = await this.readState();
    const code = state.codes[id];
    return code ? creditUsageList(code, limit) : undefined;
  }

  async chargeMemberCredits(id: string, input: ChargeMemberCreditsInput) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return undefined;
      }

      return chargeStoredCode(code, input);
    });
  }

  async chargeMemberPlayback(id: string, input: ChargeMemberPlaybackInput) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return undefined;
      }

      return chargeStoredPlayback(code, input);
    });
  }

  async createMovieRequest(input: CreateMovieRequestInput) {
    return this.updateState((state) => {
      const request = storedMovieRequest(input);
      state.movieRequests = [request, ...(state.movieRequests ?? [])].slice(0, 1000);
      return publicMovieRequest(request);
    });
  }

  async listMovieRequests(input: ListMovieRequestsInput) {
    const state = await this.readState();
    return listMovieRequestEntries(state.movieRequests ?? [], input);
  }

  async updateMovieRequestStatus(id: string, status: MovieRequestStatus) {
    return this.updateState((state) => {
      const request = (state.movieRequests ?? []).find((item) => item.id === id);
      if (!request) {
        return undefined;
      }

      request.status = movieRequestStatus(status);
      request.updatedAt = new Date().toISOString();
      return publicMovieRequest(request);
    });
  }

  async createForumThread(input: CreateForumThreadInput) {
    return this.updateState((state) => {
      const thread = storedForumThread(input);
      state.forumThreads = [thread, ...(state.forumThreads ?? [])].slice(0, forumThreadRetention);
      return publicForumThread(thread);
    });
  }

  async listForumThreads(limit: number) {
    const state = await this.readState();
    return listForumThreadSummaries(state.forumThreads ?? [], limit);
  }

  async getForumThread(id: string) {
    const state = await this.readState();
    const thread = (state.forumThreads ?? []).find((item) => item.id === id);
    return thread ? publicForumThread(thread) : undefined;
  }

  async createForumReply(threadId: string, input: CreateForumReplyInput) {
    return this.updateState((state) => {
      const thread = (state.forumThreads ?? []).find((item) => item.id === threadId);
      if (!thread) {
        return undefined;
      }

      const reply = storedForumReply(input);
      thread.replies = [...(thread.replies ?? []), reply].slice(-forumReplyRetention);
      thread.updatedAt = reply.createdAt;
      return {
        thread: publicForumThread(thread),
        reply: publicForumReply(reply)
      };
    });
  }

  async createMemberNotice(input: CreateMemberNoticeInput) {
    return this.updateState((state) => {
      const targetMember = input.audience === "member" && input.targetMemberId
        ? state.codes[input.targetMemberId]
        : undefined;
      if (input.audience === "member" && !targetMember) {
        return undefined;
      }

      const notice = storedMemberNotice({
        ...input,
        targetMemberName: targetMember?.name
      });
      state.notices = [notice, ...(state.notices ?? [])].slice(0, noticeRetention);
      return publicMemberNotice(notice, input.audience === "member" ? input.targetMemberId : undefined);
    });
  }

  async listMemberNotices(input: ListMemberNoticesInput) {
    const state = await this.readState();
    return listMemberNoticeEntries(state.notices ?? [], input);
  }

  async markMemberNoticeRead(id: string, memberId: string) {
    return this.updateState((state) => {
      const notice = (state.notices ?? []).find((item) => item.id === id && noticeVisibleToMember(item, memberId));
      if (!notice) {
        return undefined;
      }

      notice.readByMemberIds ??= {};
      notice.readByMemberIds[memberId] ??= new Date().toISOString();
      return publicMemberNotice(notice, memberId);
    });
  }

  async revokeMemberCode(id: string) {
    return this.updateState((state) => {
      const code = state.codes[id];
      if (!code) {
        return undefined;
      }

      code.revokedAt = new Date().toISOString();
      return publicCode(code);
    });
  }

  async recordLoginAudit(entry: AdminLoginAuditEntry) {
    await this.updateState((state) => {
      state.audit = [entry, ...(state.audit ?? [])].slice(0, loginAuditRetention);
    });
  }

  async listLoginAudit(limit: number) {
    const state = await this.readState();
    return (state.audit ?? [])
      .slice()
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, limit);
  }

  async deleteMemberCode(id: string) {
    return this.updateState((state) => {
      if (!state.codes[id]) {
        return false;
      }

      delete state.codes[id];
      return true;
    });
  }

  async getMemberIdentity(id: string) {
    const state = await this.readState();
    const match = state.codes[id];
    if (!match || statusFor(match) !== "active") return undefined;
    return {
      role: "member" as const,
      memberId: match.id,
      memberName: match.name,
      credits: creditSummary(match)
    };
  }

  async findMemberByCode(code: string) {
    const state = await this.readState();
    const codeHash = hashCode(code);
    const match = Object.values(state.codes).find((item) => item.codeHash === codeHash);
    if (!match || statusFor(match) !== "active") {
      return undefined;
    }

    match.lastUsedAt = new Date().toISOString();
    await this.writeState(state);
    return {
      role: "member" as const,
      memberId: match.id,
      memberName: match.name,
      credits: creditSummary(match)
    };
  }

  private async readState(): Promise<LocalAccessState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return normalizeState(JSON.parse(raw) as LocalAccessState);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return normalizeState({ codes: {} });
      }
      throw error;
    }
  }

  private codeHashExists(state: LocalAccessState, codeHash: string, exceptId?: string) {
    return Object.values(state.codes).some((item) => item.id !== exceptId && item.codeHash === codeHash);
  }

  private invitationHashExists(state: LocalAccessState, codeHash: string, exceptId?: string) {
    return Object.values(state.invitations ?? {}).some((item) => item.id !== exceptId && item.codeHash === codeHash);
  }

  private accessHashExists(state: LocalAccessState, codeHash: string) {
    return this.codeHashExists(state, codeHash) || this.invitationHashExists(state, codeHash);
  }

  private findInvitationByRawCode(state: LocalAccessState, code: string) {
    const codeHash = hashCode(code);
    return Object.values(state.invitations ?? {}).find((item) => item.codeHash === codeHash);
  }

  private async writeState(state: LocalAccessState) {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const tempPath = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(tempPath, this.statePath);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 4 || (code !== "EPERM" && code !== "EBUSY")) {
          throw error;
        }
        await sleep(50 * (attempt + 1));
      }
    }
  }

  private async updateState<T>(mutator: (state: LocalAccessState) => T | Promise<T>) {
    const state = await this.readState();
    const result = await mutator(state);
    await this.writeState(state);
    return result;
  }
}

class AzureAccessStore implements AccessStore {
  readonly backend = "azure" as const;
  readonly description: string;

  private readonly table = new TableClient(
    `https://${accountName()}.table.core.windows.net`,
    tableName(),
    new DefaultAzureCredential()
  );
  private ready?: Promise<void>;

  constructor() {
    this.description = `azure:${accountName()}/${tableName()}`;
  }

  async getHealth() {
    await this.ensureReady();
    return {
      backend: this.backend,
      accountName: accountName(),
      tableName: tableName()
    };
  }

  async createSignupInvitation(input: CreateSignupInvitationRequest) {
    await this.ensureReady();
    let rawCode = createRawInviteCode();
    for (let attempt = 0; attempt < 10 && await this.accessHashExists(hashCode(rawCode)); attempt += 1) {
      rawCode = createRawInviteCode();
    }
    const stored = storedSignupInvitation({
      rawCode,
      credits: input.credits
    });
    await this.saveInvitation(stored);
    return {
      ...publicInvitation(stored),
      code: rawCode
    };
  }

  async createResetInvitation(memberId: string) {
    await this.ensureReady();
    const member = await this.getStored(memberId);
    if (!member) {
      return undefined;
    }

    await this.revokeUnusedResetInvitations(member.id);
    let rawCode = createRawInviteCode();
    for (let attempt = 0; attempt < 10 && await this.accessHashExists(hashCode(rawCode)); attempt += 1) {
      rawCode = createRawInviteCode();
    }
    const stored = storedResetInvitation({ rawCode, member });
    await this.saveInvitation(stored);
    return {
      ...publicInvitation(stored),
      code: rawCode
    };
  }

  async listMemberInvitations() {
    await this.ensureReady();
    const invitations: MemberInvitation[] = [];
    const members: Record<string, StoredMemberCode> = {};
    const memberEntities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'member'"
      }
    });

    for await (const entity of memberEntities) {
      const member = deserialize<StoredMemberCode>(entity);
      members[member.id] = member;
    }

    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${invitationPartitionKey}'`
      }
    });

    for await (const entity of entities) {
      invitations.push(publicInvitation(deserialize<StoredMemberInvitation>(entity), members));
    }

    return invitations.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async registerMember(input: RegisterMemberRequest) {
    await this.ensureReady();
    if (!input.inviteCode) {
      return {
        ok: false as const,
        reason: "invalid_invite" as const
      };
    }

    const invitationMatch = await this.getInvitationByCodeHash(hashCode(input.inviteCode));
    const invitation = invitationMatch?.stored;
    if (!invitation || invitation.type !== "signup" || invitationStatus(invitation) !== "unused") {
      return {
        ok: false as const,
        reason: "invalid_invite" as const
      };
    }
    migrateStoredInvitationCreditScale(invitation);

    if (await this.accessHashExists(hashCode(input.passcode))) {
      return {
        ok: false as const,
        reason: "duplicate" as const
      };
    }

    const stored = storedMemberCode({
      name: input.name,
      rawCode: input.passcode,
      credits: invitation.creditBalance
    });
    await this.save(stored);
    invitation.usedAt = new Date().toISOString();
    invitation.claimedByMemberId = stored.id;
    invitation.claimedByMemberName = stored.name;
    await this.saveInvitation(invitation);
    return {
      ok: true as const,
      code: publicCode(stored)
    };
  }

  async resetMemberPasscode(input: ResetMemberPasscodeRequest) {
    await this.ensureReady();
    const invitationMatch = await this.getInvitationByCodeHash(hashCode(input.inviteCode));
    const invitation = invitationMatch?.stored;
    if (!invitation || invitation.type !== "reset" || invitationStatus(invitation) !== "unused" || !invitation.memberId) {
      return {
        ok: false as const,
        reason: "invalid_invite" as const
      };
    }

    const stored = await this.getStored(invitation.memberId);
    if (!stored) {
      return {
        ok: false as const,
        reason: "not_found" as const
      };
    }

    const codeHash = hashCode(input.newPasscode);
    const duplicate = await this.getStoredByCodeHash(codeHash);
    const duplicateInvitation = await this.getInvitationByCodeHash(codeHash);
    if ((duplicate && duplicate.stored.id !== stored.id) || (duplicateInvitation && duplicateInvitation.stored.id !== invitation.id)) {
      return {
        ok: false as const,
        reason: "duplicate" as const
      };
    }

    stored.codeHash = codeHash;
    stored.codePreview = codePreview(input.newPasscode);
    invitation.usedAt = new Date().toISOString();
    invitation.claimedByMemberId = stored.id;
    await this.save(stored);
    await this.saveInvitation(invitation);
    await this.revokeUnusedResetInvitations(stored.id, invitation.id);
    return {
      ok: true as const,
      code: publicCode(stored)
    };
  }

  async listMemberCodes() {
    await this.ensureReady();
    const codes: MemberAccessCode[] = [];
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'member'"
      }
    });

    for await (const entity of entities) {
      codes.push(publicCode(deserialize<StoredMemberCode>(entity)));
    }

    return codes.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async setMemberCredits(id: string, credits: number) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return undefined;
    }

    const code = setCreditsOnStoredCode(stored, credits);
    await this.save(stored);
    return code;
  }

  async adjustMemberCredits(delta: number) {
    await this.ensureReady();
    const boundedDelta = positiveInt(Math.abs(delta), 0, { min: 0, max: memberCreditMax }) * Math.sign(delta);
    const storedCodes: StoredMemberCode[] = [];
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'member'"
      }
    });

    for await (const entity of entities) {
      storedCodes.push(deserialize<StoredMemberCode>(entity));
    }

    let adjustedCount = 0;
    for (const code of storedCodes) {
      if (statusFor(code) !== "active") {
        continue;
      }

      prepareStoredCode(code);
      setCreditsOnStoredCode(code, (code.creditBalance ?? 0) + boundedDelta);
      await this.save(code);
      adjustedCount += 1;
    }

    return {
      codes: storedCodes.map(publicCode).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      adjustedCount,
      delta: boundedDelta
    };
  }

  async changeMemberPasscode(id: string, currentPasscode: string, newPasscode: string) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return {
        ok: false as const,
        reason: "not_found" as const
      };
    }

    if (stored.codeHash !== hashCode(currentPasscode)) {
      return {
        ok: false as const,
        reason: "invalid_current" as const
      };
    }

    const newCodeHash = hashCode(newPasscode);
    const duplicate = await this.getStoredByCodeHash(newCodeHash);
    const duplicateInvitation = await this.getInvitationByCodeHash(newCodeHash);
    if ((duplicate && duplicate.stored.id !== id) || duplicateInvitation) {
      return {
        ok: false as const,
        reason: "duplicate" as const
      };
    }

    stored.codeHash = newCodeHash;
    stored.codePreview = codePreview(newPasscode);
    await this.save(stored);
    return {
      ok: true as const,
      code: publicCode(stored)
    };
  }

  async updateMemberProfile(id: string, input: UpdateMemberProfileRequest) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return {
        ok: false as const,
        reason: "not_found" as const
      };
    }

    const nextName = input.name?.trim();
    if (nextName) {
      stored.name = memberName(nextName);
    }

    if (input.newPasscode) {
      const newCodeHash = hashCode(input.newPasscode);
      const duplicate = await this.getStoredByCodeHash(newCodeHash);
      const duplicateInvitation = await this.getInvitationByCodeHash(newCodeHash);
      if ((duplicate && duplicate.stored.id !== id) || duplicateInvitation) {
        return {
          ok: false as const,
          reason: "duplicate" as const
        };
      }

      stored.codeHash = newCodeHash;
      stored.codePreview = codePreview(input.newPasscode);
    }

    await this.save(stored);
    return {
      ok: true as const,
      code: publicCode(stored)
    };
  }

  async listMemberCreditUsage(id: string, limit: number) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    return stored ? creditUsageList(stored, limit) : undefined;
  }

  async chargeMemberCredits(id: string, input: ChargeMemberCreditsInput) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return undefined;
    }

    const result = chargeStoredCode(stored, input);
    await this.save(stored);
    return result;
  }

  async chargeMemberPlayback(id: string, input: ChargeMemberPlaybackInput) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return undefined;
    }

    const result = chargeStoredPlayback(stored, input);
    await this.save(stored);
    return result;
  }

  async createMovieRequest(input: CreateMovieRequestInput) {
    await this.ensureReady();
    const request = storedMovieRequest(input);
    await this.saveMovieRequest(request);
    return publicMovieRequest(request);
  }

  async listMovieRequests(input: ListMovieRequestsInput) {
    await this.ensureReady();
    const requests: StoredMovieRequest[] = [];
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${movieRequestPartitionKey}'`
      }
    });

    for await (const entity of entities) {
      requests.push(deserialize<StoredMovieRequest>(entity));
    }

    return listMovieRequestEntries(requests, input);
  }

  async updateMovieRequestStatus(id: string, status: MovieRequestStatus) {
    await this.ensureReady();
    const request = await this.getMovieRequest(id);
    if (!request) {
      return undefined;
    }

    request.status = movieRequestStatus(status);
    request.updatedAt = new Date().toISOString();
    await this.saveMovieRequest(request);
    return publicMovieRequest(request);
  }

  async createForumThread(input: CreateForumThreadInput) {
    await this.ensureReady();
    const thread = storedForumThread(input);
    await this.saveForumThread(thread);
    return publicForumThread(thread);
  }

  async listForumThreads(limit: number) {
    await this.ensureReady();
    const threads: StoredForumThread[] = [];
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${forumThreadPartitionKey}'`
      }
    });

    for await (const entity of entities) {
      threads.push(deserialize<StoredForumThread>(entity));
    }

    return listForumThreadSummaries(threads, limit);
  }

  async getForumThread(id: string) {
    await this.ensureReady();
    const thread = await this.getStoredForumThread(id);
    return thread ? publicForumThread(thread) : undefined;
  }

  async createForumReply(threadId: string, input: CreateForumReplyInput) {
    await this.ensureReady();
    const thread = await this.getStoredForumThread(threadId);
    if (!thread) {
      return undefined;
    }

    const reply = storedForumReply(input);
    thread.replies = [...(thread.replies ?? []), reply].slice(-forumReplyRetention);
    thread.updatedAt = reply.createdAt;
    await this.saveForumThread(thread);
    return {
      thread: publicForumThread(thread),
      reply: publicForumReply(reply)
    };
  }

  async createMemberNotice(input: CreateMemberNoticeInput) {
    await this.ensureReady();
    const targetMember = input.audience === "member" && input.targetMemberId
      ? await this.getStored(input.targetMemberId)
      : undefined;
    if (input.audience === "member" && !targetMember) {
      return undefined;
    }

    const notice = storedMemberNotice({
      ...input,
      targetMemberName: targetMember?.name
    });
    await this.saveMemberNotice(notice);
    return publicMemberNotice(notice, input.audience === "member" ? input.targetMemberId : undefined);
  }

  async listMemberNotices(input: ListMemberNoticesInput) {
    await this.ensureReady();
    const notices: StoredMemberNotice[] = [];
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${noticePartitionKey}'`
      }
    });

    for await (const entity of entities) {
      notices.push(deserialize<StoredMemberNotice>(entity));
    }

    return listMemberNoticeEntries(notices, input);
  }

  async markMemberNoticeRead(id: string, memberId: string) {
    await this.ensureReady();
    const notice = await this.getStoredMemberNotice(id);
    if (!notice || !noticeVisibleToMember(notice, memberId)) {
      return undefined;
    }

    notice.readByMemberIds ??= {};
    notice.readByMemberIds[memberId] ??= new Date().toISOString();
    await this.saveMemberNotice(notice);
    return publicMemberNotice(notice, memberId);
  }

  async revokeMemberCode(id: string) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored) {
      return undefined;
    }

    stored.revokedAt = new Date().toISOString();
    await this.save(stored);
    return publicCode(stored);
  }

  async recordLoginAudit(entry: AdminLoginAuditEntry) {
    await this.ensureReady();
    await this.table.upsertEntity<PayloadEntity>(
      {
        partitionKey: "audit",
        rowKey: `${entry.at}-${entry.id}`,
        status: entry.role,
        payload: serialize(entry)
      },
      "Replace"
    );
  }

  async listLoginAudit(limit: number) {
    await this.ensureReady();
    const events: AdminLoginAuditEntry[] = [];
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: "PartitionKey eq 'audit'"
      }
    });

    for await (const entity of entities) {
      events.push(deserialize<AdminLoginAuditEntry>(entity));
    }

    return events
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, limit);
  }

  async deleteMemberCode(id: string) {
    await this.ensureReady();
    try {
      await this.table.deleteEntity("member", id);
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  async getMemberIdentity(id: string) {
    await this.ensureReady();
    const stored = await this.getStored(id);
    if (!stored || statusFor(stored) !== "active") return undefined;
    return {
      role: "member" as const,
      memberId: stored.id,
      memberName: stored.name,
      credits: creditSummary(stored)
    };
  }

  async findMemberByCode(code: string) {
    await this.ensureReady();
    const codeHash = hashCode(code);
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq 'member' and codeHash eq '${codeHash}'`
      }
    });

    for await (const entity of entities) {
      const stored = deserialize<StoredMemberCode>(entity);
      if (statusFor(stored) !== "active") {
        return undefined;
      }

      stored.lastUsedAt = new Date().toISOString();
      await this.save(stored);
      return {
        role: "member" as const,
        memberId: stored.id,
        memberName: stored.name,
        credits: creditSummary(stored)
      };
    }

    return undefined;
  }

  private async ensureReady() {
    this.ready ??= this.createTableIfMissing();
    await this.ready;
  }

  private async createTableIfMissing() {
    try {
      await this.table.createTable();
    } catch (error) {
      if (!isConflict(error)) {
        throw error;
      }
    }
  }

  private async getStored(id: string) {
    try {
      const entity = await this.table.getEntity<PayloadEntity>("member", id);
      return deserialize<StoredMemberCode>(entity);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async getStoredByCodeHash(codeHash: string) {
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq 'member' and codeHash eq '${codeHash}'`
      }
    });

    for await (const entity of entities) {
      return {
        id: entity.rowKey,
        stored: deserialize<StoredMemberCode>(entity)
      };
    }

    return undefined;
  }

  private async getInvitationByCodeHash(codeHash: string) {
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${invitationPartitionKey}' and codeHash eq '${codeHash}'`
      }
    });

    for await (const entity of entities) {
      return {
        id: entity.rowKey,
        stored: deserialize<StoredMemberInvitation>(entity)
      };
    }

    return undefined;
  }

  private async accessHashExists(codeHash: string) {
    return Boolean(await this.getStoredByCodeHash(codeHash) || await this.getInvitationByCodeHash(codeHash));
  }

  private async revokeUnusedResetInvitations(memberId: string, exceptId?: string) {
    const revokedAt = new Date().toISOString();
    const entities = this.table.listEntities<PayloadEntity>({
      queryOptions: {
        filter: `PartitionKey eq '${invitationPartitionKey}'`
      }
    });

    for await (const entity of entities) {
      const invitation = deserialize<StoredMemberInvitation>(entity);
      if (shouldRevokeMemberResetInvitation(invitation, memberId, exceptId)) {
        invitation.revokedAt = revokedAt;
        await this.saveInvitation(invitation);
      }
    }
  }

  private async save(code: StoredMemberCode) {
    await this.table.upsertEntity<PayloadEntity>(
      {
        partitionKey: "member",
        rowKey: code.id,
        codeHash: code.codeHash,
        status: statusFor(code),
        payload: serialize(code)
      },
      "Replace"
    );
  }

  private async saveInvitation(invitation: StoredMemberInvitation) {
    await this.table.upsertEntity<PayloadEntity>(
      {
        partitionKey: invitationPartitionKey,
        rowKey: invitation.id,
        codeHash: invitation.codeHash,
        status: invitationStatus(invitation),
        payload: serialize(invitation)
      },
      "Replace"
    );
  }

  private async getMovieRequest(id: string) {
    try {
      const entity = await this.table.getEntity<PayloadEntity>(movieRequestPartitionKey, id);
      return deserialize<StoredMovieRequest>(entity);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async saveMovieRequest(request: StoredMovieRequest) {
    await this.table.upsertEntity<PayloadEntity>(
      {
        partitionKey: movieRequestPartitionKey,
        rowKey: request.id,
        status: movieRequestStatus(request.status),
        payload: serialize(request)
      },
      "Replace"
    );
  }

  private async getStoredForumThread(id: string) {
    try {
      const entity = await this.table.getEntity<PayloadEntity>(forumThreadPartitionKey, id);
      return deserialize<StoredForumThread>(entity);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async getStoredMemberNotice(id: string) {
    try {
      const entity = await this.table.getEntity<PayloadEntity>(noticePartitionKey, id);
      return deserialize<StoredMemberNotice>(entity);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async saveForumThread(thread: StoredForumThread) {
    await this.table.upsertEntity<PayloadEntity>(
      {
        partitionKey: forumThreadPartitionKey,
        rowKey: thread.id,
        status: "open",
        payload: serialize(thread)
      },
      "Replace"
    );
  }

  private async saveMemberNotice(notice: StoredMemberNotice) {
    await this.table.upsertEntity<PayloadEntity>(
      {
        partitionKey: noticePartitionKey,
        rowKey: notice.id,
        status: notice.audience,
        payload: serialize(notice)
      },
      "Replace"
    );
  }
}
