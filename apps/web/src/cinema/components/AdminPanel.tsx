import { useState, type FormEvent } from "react";
import {
  Activity,
  Bell,
  Database,
  Copy,
  Fingerprint,
  Globe2,
  KeyRound,
  Loader2,
  MessageSquarePlus,
  MinusCircle,
  MonitorSmartphone,
  PlusCircle,
  ReceiptText,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users
} from "lucide-react";
import type {
  AdminCacheJobEntry,
  AdminLoginAuditEntry,
  CacheAsset,
  CreateMemberNoticeRequest,
  MemberNoticeEntry,
  MovieRequestEntry,
  MovieRequestStatus
} from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Progress } from "../../components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { creditInputDisplayValue, parseCreditInputValue } from "../admin-credit-input";
import {
  booleanLabel,
  cacheErrorLabel,
  creditsLabel,
  formatBytes,
  formatDateTime,
  jobMessageLabel,
  jobStatusLabel,
  jobVariant,
  mediaQuality,
  mp4StatusLabel
} from "../format";
import {
  copy,
  invitationStatusLabel as adminInvitationStatusLabel,
  invitationTypeLabel as adminInvitationTypeLabel,
  memberStatusLabel as adminMemberStatusLabel,
  movieRequestStatusLabel as adminMovieRequestStatusLabel
} from "../i18n";
import type { BadgeVariant, ManagedMemberCode, ManagedMemberInvitation } from "../types";
import { EmptyState } from "./EmptyState";
import { Metric } from "./MediaDiagnosticsView";

function invitationLink(invitation: ManagedMemberInvitation) {
  if (!invitation.code || typeof window === "undefined") {
    return undefined;
  }

  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(invitation.type === "reset" ? "reset" : "invite", invitation.code);
  return url.toString();
}

interface AdminPanelProps {
  adminUnlocked: boolean;
  adminError: string;
  adminLoading: boolean;
  cacheJobs: AdminCacheJobEntry[];
  cacheJobsLoading: boolean;
  cachedAssets: CacheAsset[];
  cachedAssetsLoading: boolean;
  loginAudit: AdminLoginAuditEntry[];
  loginAuditLoading: boolean;
  movieRequests: MovieRequestEntry[];
  movieRequestsLoading: boolean;
  memberNotices: MemberNoticeEntry[];
  memberNoticesLoading: boolean;
  adminKeyInput: string;
  memberCredits: number;
  memberBulkCredits: number;
  memberCreditEdits: Record<string, number>;
  memberCodes: ManagedMemberCode[];
  memberInvitations: ManagedMemberInvitation[];
  setAdminKeyInput: (value: string) => void;
  setMemberCredits: (value: number) => void;
  setMemberBulkCredits: (value: number) => void;
  setMemberCreditEdit: (id: string, value: number) => void;
  onUnlock: () => void;
  onGenerate: () => void;
  onCopy: (code: string) => void;
  onDelete: (id: string) => void;
  onAdjustCredits: (delta: number) => void;
  onRefreshJobs: () => void;
  onRefreshCachedAssets: () => void;
  onRefreshLoginAudit: () => void;
  onRefreshMovieRequests: () => void;
  onRefreshNotices: () => void;
  onCreateNotice: (input: CreateMemberNoticeRequest) => void;
  onRetryCacheJob: (jobId: string) => void;
  onDeleteCacheJob: (jobId: string) => void;
  onDeleteCachedAsset: (assetKey: string) => void;
  onUpdateCredits: (id: string) => void;
  onCreateResetInvitation: (id: string) => Promise<boolean>;
  onUpdateMovieRequestStatus: (id: string, status: MovieRequestStatus) => void;
  onViewCreditUsage: (id: string) => void;
  onRevoke: (id: string) => void;
}

export function AdminPanel({
  adminUnlocked,
  adminError,
  adminLoading,
  cacheJobs,
  cacheJobsLoading,
  cachedAssets,
  cachedAssetsLoading,
  loginAudit,
  loginAuditLoading,
  movieRequests,
  movieRequestsLoading,
  memberNotices,
  memberNoticesLoading,
  adminKeyInput,
  memberCredits,
  memberBulkCredits,
  memberCreditEdits,
  memberCodes,
  memberInvitations,
  setAdminKeyInput,
  setMemberCredits,
  setMemberBulkCredits,
  setMemberCreditEdit,
  onUnlock,
  onGenerate,
  onCopy,
  onDelete,
  onAdjustCredits,
  onRefreshJobs,
  onRefreshCachedAssets,
  onRefreshLoginAudit,
  onRefreshMovieRequests,
  onRefreshNotices,
  onCreateNotice,
  onRetryCacheJob,
  onDeleteCacheJob,
  onDeleteCachedAsset,
  onUpdateCredits,
  onCreateResetInvitation,
  onUpdateMovieRequestStatus,
  onViewCreditUsage,
  onRevoke
}: AdminPanelProps) {
  const [activeAdminTab, setActiveAdminTab] = useState("cached");

  if (!adminUnlocked) {
    return (
      <Card className="rounded-xl sm:rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            {copy.admin.unlockTitle}
          </CardTitle>
          <CardDescription>{copy.admin.unlockDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid max-w-md gap-3 sm:max-w-md"
            onSubmit={(event) => {
              event.preventDefault();
              onUnlock();
            }}
          >
            <Label htmlFor="admin-key">{copy.admin.adminKey}</Label>
            <Input
              id="admin-key"
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              type="password"
            />
            {adminError ? <p className="text-sm font-semibold text-rose-300">{adminError}</p> : null}
            <Button className="w-full sm:w-auto" type="submit" disabled={adminLoading}>
              {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              {copy.admin.unlock}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      {adminError ? (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-200 sm:rounded-md">
          {adminError}
        </div>
      ) : null}

      <Tabs value={activeAdminTab} onValueChange={setActiveAdminTab}>
        <TabsList className="max-w-[calc(100vw-1.5rem)] sm:flex sm:w-full sm:max-w-full">
          <TabsTrigger value="cached">
            <Database className="h-4 w-4" />
            {copy.admin.tabs.cached}
            <Badge variant="secondary">{cachedAssets.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="jobs">
            <Activity className="h-4 w-4" />
            {copy.admin.tabs.jobs}
            <Badge variant={cacheJobs.some((item) => item.job.status === "failed") ? "danger" : "secondary"}>
              {cacheJobs.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="passes">
            <Users className="h-4 w-4" />
            {copy.admin.tabs.passes}
            <Badge variant="secondary">{memberCodes.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="invites">
            <KeyRound className="h-4 w-4" />
            {copy.admin.tabs.invites}
            <Badge variant={memberInvitations.some((invitation) => invitation.status === "unused") ? "warning" : "secondary"}>
              {memberInvitations.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="requests">
            <MessageSquarePlus className="h-4 w-4" />
            {copy.admin.tabs.requests}
            <Badge variant={movieRequests.some((request) => request.status === "new") ? "warning" : "secondary"}>
              {movieRequests.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="notices">
            <Bell className="h-4 w-4" />
            站内信
            <Badge variant="secondary">{memberNotices.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="security">
            <ShieldCheck className="h-4 w-4" />
            {copy.admin.tabs.security}
            <Badge variant="secondary">{loginAudit.length}</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cached">
          <AdminCachedAssetsPanel
            actionLoading={adminLoading}
            assets={cachedAssets}
            loading={cachedAssetsLoading}
            onDelete={onDeleteCachedAsset}
            onRefresh={onRefreshCachedAssets}
          />
        </TabsContent>

        <TabsContent value="jobs">
          <AdminCacheJobsPanel
            actionLoading={adminLoading}
            jobs={cacheJobs}
            loading={cacheJobsLoading}
            onDelete={onDeleteCacheJob}
            onRefresh={onRefreshJobs}
            onRetry={onRetryCacheJob}
          />
        </TabsContent>

        <TabsContent value="passes">
          <AdminMembersPanel
            adminLoading={adminLoading}
            memberCodes={memberCodes}
            memberBulkCredits={memberBulkCredits}
            memberCreditEdits={memberCreditEdits}
            onAdjustCredits={onAdjustCredits}
            onDelete={onDelete}
            onRevoke={onRevoke}
            onUpdateCredits={onUpdateCredits}
            onCreateResetInvitation={async (id) => {
              if (await onCreateResetInvitation(id)) {
                setActiveAdminTab("invites");
              }
            }}
            onViewCreditUsage={onViewCreditUsage}
            setMemberCreditEdit={setMemberCreditEdit}
            setMemberBulkCredits={setMemberBulkCredits}
          />
        </TabsContent>

        <TabsContent value="invites">
          <AdminInvitesPanel
            adminLoading={adminLoading}
            memberCredits={memberCredits}
            memberInvitations={memberInvitations}
            onCopy={onCopy}
            onGenerate={onGenerate}
            setMemberCredits={setMemberCredits}
          />
        </TabsContent>

        <TabsContent value="requests">
          <AdminMovieRequestsPanel
            actionLoading={adminLoading}
            loading={movieRequestsLoading}
            requests={movieRequests}
            onRefresh={onRefreshMovieRequests}
            onUpdateStatus={onUpdateMovieRequestStatus}
          />
        </TabsContent>

        <TabsContent value="notices">
          <AdminNoticesPanel
            actionLoading={adminLoading}
            loading={memberNoticesLoading}
            memberCodes={memberCodes}
            notices={memberNotices}
            onCreateNotice={onCreateNotice}
            onRefresh={onRefreshNotices}
          />
        </TabsContent>

        <TabsContent value="security">
          <AdminLoginAuditPanel
            events={loginAudit}
            loading={loginAuditLoading}
            onRefresh={onRefreshLoginAudit}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

const movieRequestStatusOptions: MovieRequestStatus[] = ["new", "planned", "fulfilled", "dismissed"];
const adminSelectClassName = "h-12 rounded-lg border border-slate-700 bg-slate-950 px-3 text-base text-slate-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 sm:h-10 sm:rounded-md sm:text-sm";
const adminTextareaClassName = "min-h-32 resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-base leading-7 text-slate-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 sm:rounded-md sm:py-2 sm:text-sm sm:leading-6";

function AdminNoticesPanel({
  actionLoading,
  loading,
  memberCodes,
  notices,
  onCreateNotice,
  onRefresh
}: {
  actionLoading: boolean;
  loading: boolean;
  memberCodes: ManagedMemberCode[];
  notices: MemberNoticeEntry[];
  onCreateNotice: (input: CreateMemberNoticeRequest) => void;
  onRefresh: () => void;
}) {
  const [audience, setAudience] = useState<"all" | "member">("all");
  const [targetMemberId, setTargetMemberId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const busy = actionLoading || loading;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextTitle = title.trim();
    const nextBody = body.trim();
    if (!nextTitle || !nextBody) {
      return;
    }

    onCreateNotice({
      audience,
      targetMemberId: audience === "member" ? targetMemberId : undefined,
      title: nextTitle,
      body: nextBody
    });
    setTitle("");
    setBody("");
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card className="self-start rounded-xl sm:rounded-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-emerald-300" />
            发送站内信
          </CardTitle>
          <CardDescription>给所有成员发公告，或单独给某个成员留言。</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="notice-audience">发送范围</Label>
              <select
                id="notice-audience"
                className={adminSelectClassName}
                value={audience}
                onChange={(event) => setAudience(event.target.value === "member" ? "member" : "all")}
              >
                <option value="all">全体公告</option>
                <option value="member">单独成员</option>
              </select>
            </div>
            {audience === "member" ? (
              <div className="grid gap-2">
                <Label htmlFor="notice-target">成员</Label>
                <select
                  id="notice-target"
                  className={adminSelectClassName}
                  value={targetMemberId}
                  onChange={(event) => setTargetMemberId(event.target.value)}
                  required
                >
                  <option value="">选择成员</option>
                  {memberCodes.map((code) => (
                    <option key={code.id} value={code.id}>{code.name}</option>
                  ))}
                </select>
              </div>
            ) : null}
            <div className="grid gap-2">
              <Label htmlFor="notice-title">标题</Label>
              <Input
                id="notice-title"
                maxLength={120}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="notice-body">内容</Label>
              <textarea
                id="notice-body"
                className={adminTextareaClassName}
                maxLength={4000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
              />
              <p className="text-xs text-slate-500">{body.length}/4000</p>
            </div>
            <Button className="w-full sm:w-auto" type="submit" disabled={busy || !title.trim() || !body.trim() || (audience === "member" && !targetMemberId)}>
              {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              发送
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="rounded-xl sm:rounded-lg">
        <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-emerald-300" />
              最近站内信
            </CardTitle>
            <CardDescription>按发送时间查看公告和单人消息。</CardDescription>
          </div>
          <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={busy}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {copy.common.refresh}
          </Button>
        </CardHeader>
        <CardContent>
          {loading && notices.length === 0 ? (
            <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="正在加载站内信" />
          ) : notices.length === 0 ? (
            <EmptyState icon={<Bell className="h-5 w-5" />} title="暂无站内信" />
          ) : (
            <div className="grid gap-3">
              {notices.map((notice) => (
                <article key={notice.id} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-4 sm:rounded-md sm:p-3">
                  <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-50">{notice.title}</h3>
                        <Badge variant={notice.audience === "all" ? "secondary" : "warning"}>
                          {notice.audience === "all" ? "全体公告" : `给 ${notice.targetMemberName ?? notice.targetMemberId ?? "成员"}`}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{formatDateTime(notice.createdAt)}</p>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{notice.body}</p>
                </article>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function movieRequestVariant(status: MovieRequestStatus): BadgeVariant {
  const variants: Record<MovieRequestStatus, BadgeVariant> = {
    new: "secondary",
    planned: "warning",
    fulfilled: "default",
    dismissed: "muted"
  };
  return variants[status];
}

function AdminMovieRequestsPanel({
  actionLoading,
  loading,
  requests,
  onRefresh,
  onUpdateStatus
}: {
  actionLoading: boolean;
  loading: boolean;
  requests: MovieRequestEntry[];
  onRefresh: () => void;
  onUpdateStatus: (id: string, status: MovieRequestStatus) => void;
}) {
  const busy = actionLoading || loading;

  return (
    <Card className="rounded-xl sm:rounded-lg">
      <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5 text-emerald-300" />
            {copy.admin.requestsTitle}
          </CardTitle>
          <CardDescription>{copy.admin.requestsDescription}</CardDescription>
        </div>
        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={busy}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {copy.common.refresh}
        </Button>
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-slate-800 bg-slate-950/70 p-8 text-center text-sm font-semibold text-slate-500 sm:rounded-md">
            {loading ? copy.admin.loadingRequests : copy.admin.noRequests}
          </div>
        ) : (
          <div className="grid gap-3">
            {requests.map((request) => (
              <div key={request.id} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4 sm:rounded-md">
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-50">{request.requestedByMemberName ?? copy.common.cinemaMember}</p>
                      <Badge variant={movieRequestVariant(request.status)}>{adminMovieRequestStatusLabel(request.status)}</Badge>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{request.text}</p>
                    <p className="mt-2 text-xs text-slate-500">
                      {copy.request.requestedAt(formatDateTime(request.requestedAt))}
                      {request.updatedAt !== request.requestedAt ? copy.request.updatedAt(formatDateTime(request.updatedAt)) : ""}
                    </p>
                  </div>

                  <div className="grid gap-2 sm:flex sm:flex-wrap md:justify-end">
                    {movieRequestStatusOptions.map((status) => (
                      <Button
                        className="w-full sm:w-auto"
                        key={status}
                        type="button"
                        variant={request.status === status ? "secondary" : "outline"}
                        size="sm"
                        onClick={() => onUpdateStatus(request.id, status)}
                        disabled={busy || request.status === status}
                      >
                        {adminMovieRequestStatusLabel(status)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <Metric label={copy.admin.requestId} value={request.id} />
                  <Metric label={copy.admin.memberId} value={request.requestedByMemberId ?? copy.common.notRecorded} />
                  <Metric label={copy.admin.status} value={adminMovieRequestStatusLabel(request.status)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminLoginAuditPanel({
  events,
  loading,
  onRefresh
}: {
  events: AdminLoginAuditEntry[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Card className="rounded-xl sm:rounded-lg">
      <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Fingerprint className="h-5 w-5 text-emerald-300" />
            {copy.admin.loginTitle}
          </CardTitle>
          <CardDescription>{copy.admin.loginDescription}</CardDescription>
        </div>
        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {copy.common.refresh}
        </Button>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-slate-800 bg-slate-950/70 p-8 text-center text-sm font-semibold text-slate-500 sm:rounded-md">
            {loading ? copy.admin.loadingAudit : copy.admin.noAudit}
          </div>
        ) : (
          <div className="grid gap-3">
            {events.map((event) => (
              <div key={event.id} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4 sm:rounded-md">
                <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-50">
                        {event.role === "admin" ? copy.common.admin : event.memberName ?? copy.common.cinemaMember}
                      </p>
                      <Badge variant={event.role === "admin" ? "warning" : "secondary"}>{event.role === "admin" ? copy.common.admin : copy.common.member}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{formatDateTime(event.at)}</p>
                  </div>
                  <Badge variant="muted">{event.ipAddress ?? copy.admin.ipUnknown}</Badge>
                </div>

                <div className="grid gap-3 text-sm md:grid-cols-4">
                  <Metric label={copy.admin.location} value={event.ipLocation ?? copy.common.unknown} />
                  <Metric label={copy.admin.device} value={event.device ?? copy.admin.unknownDevice} />
                  <Metric label={copy.admin.memberId} value={event.memberId ?? copy.common.admin} />
                  <Metric label={copy.admin.requestId} value={event.requestId ?? copy.common.notRecorded} />
                </div>

                {event.userAgent ? (
                  <p className="break-all text-xs leading-5 text-slate-500 sm:truncate" title={event.userAgent}>
                    <MonitorSmartphone className="mr-1 inline h-3.5 w-3.5" />
                    {event.userAgent}
                  </p>
                ) : null}
                {event.ipLocation ? (
                  <p className="text-xs text-slate-500">
                    <Globe2 className="mr-1 inline h-3.5 w-3.5" />
                    {event.ipLocation}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminMembersPanel({
  adminLoading,
  memberCodes,
  memberBulkCredits,
  memberCreditEdits,
  onAdjustCredits,
  onDelete,
  onRevoke,
  onUpdateCredits,
  onCreateResetInvitation,
  onViewCreditUsage,
  setMemberBulkCredits,
  setMemberCreditEdit
}: {
  adminLoading: boolean;
  memberCodes: ManagedMemberCode[];
  memberBulkCredits: number;
  memberCreditEdits: Record<string, number>;
  onAdjustCredits: (delta: number) => void;
  onDelete: (id: string) => void;
  onRevoke: (id: string) => void;
  onUpdateCredits: (id: string) => void;
  onCreateResetInvitation: (id: string) => Promise<void>;
  onViewCreditUsage: (id: string) => void;
  setMemberBulkCredits: (value: number) => void;
  setMemberCreditEdit: (id: string, value: number) => void;
}) {
  const activeMemberCount = memberCodes.filter((code) => code.status === "active").length;
  const bulkAmount = Number.isFinite(memberBulkCredits) ? Math.max(0, Math.floor(memberBulkCredits)) : 0;

  return (
    <div className="grid gap-4">
        <Card className="rounded-xl sm:rounded-lg">
          <CardHeader className="flex flex-col items-start justify-between gap-4 lg:flex-row">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <PlusCircle className="h-5 w-5 text-emerald-300" />
                {copy.admin.bulkBalance}
              </CardTitle>
              <CardDescription>{copy.admin.bulkDescription}</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-[minmax(0,220px)_auto_1fr] md:items-end">
              <div className="grid gap-2">
                <Label htmlFor="member-bulk-credits">{copy.admin.amount}</Label>
                <Input
                  id="member-bulk-credits"
                  min={1}
                  max={10000}
                  type="number"
                  value={creditInputDisplayValue(memberBulkCredits)}
                  onChange={(event) => setMemberBulkCredits(parseCreditInputValue(event.target.value))}
                />
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onAdjustCredits(bulkAmount)}
                  disabled={adminLoading || bulkAmount <= 0 || activeMemberCount === 0}
                >
                  <PlusCircle className="h-4 w-4" />
                  {copy.admin.addAll}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onAdjustCredits(-bulkAmount)}
                  disabled={adminLoading || bulkAmount <= 0 || activeMemberCount === 0}
                >
                  <MinusCircle className="h-4 w-4" />
                  {copy.admin.subtractAll}
                </Button>
              </div>
              <p className="text-xs text-slate-500 md:pb-2">{copy.admin.activePasses(activeMemberCount)}</p>
            </div>
          </CardContent>
        </Card>

      <div className="grid gap-3">
        {memberCodes.length === 0 ? (
          <EmptyState icon={<Users className="h-5 w-5" />} title={copy.admin.noMembers} />
        ) : (
          memberCodes.map((code) => (
            <Card key={code.id} className="rounded-xl sm:rounded-lg">
              <CardContent className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-50">{code.name}</p>
                    <Badge variant={code.status === "active" ? "default" : "danger"}>{adminMemberStatusLabel(code.status)}</Badge>
                  </div>
                  <p className="mt-1 break-all font-mono text-sm leading-6 text-slate-300 sm:truncate">
                    {code.code ?? code.codePreview}
                  </p>
                  <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-[minmax(0,180px)]">
                    <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
                      <p className="text-slate-500">{copy.admin.balance}</p>
                      <p className="mt-1 font-semibold text-emerald-200">{creditsLabel(code)}</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2 lg:min-w-[360px]">
                  <div className="grid gap-2 sm:grid-cols-[6rem_minmax(0,1fr)] lg:flex lg:flex-wrap lg:items-center lg:justify-end">
                    <Input
                      className="w-full lg:w-20"
                      min={0}
                      max={10000}
                      type="number"
                      value={creditInputDisplayValue(memberCreditEdits[code.id] ?? code.credits.remaining)}
                      onChange={(event) => setMemberCreditEdit(code.id, parseCreditInputValue(event.target.value))}
                    />
                    <Button
                      className="w-full lg:w-auto"
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onUpdateCredits(code.id)}
                      disabled={adminLoading || code.status !== "active"}
                    >
                      {copy.admin.setCredits}
                    </Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-end">
                    <Button
                      className="w-full lg:w-auto"
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onViewCreditUsage(code.id)}
                      disabled={adminLoading}
                    >
                      <ReceiptText className="h-4 w-4" />
                      {copy.layout.spending}
                    </Button>
                    <Button
                      className="w-full lg:w-auto"
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => onCreateResetInvitation(code.id)}
                      disabled={adminLoading || code.status !== "active"}
                    >
                      <KeyRound className="h-4 w-4" />
                      {copy.admin.resetInvite}
                    </Button>
                    {code.status === "active" ? (
                      <Button
                        className="w-full lg:w-auto"
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onRevoke(code.id)}
                        disabled={adminLoading}
                      >
                        {copy.admin.revoke}
                      </Button>
                    ) : null}
                    {code.status !== "active" ? (
                      <Button
                        className="w-full lg:w-auto"
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onDelete(code.id)}
                        disabled={adminLoading}
                      >
                        {copy.common.delete}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function AdminInvitesPanel({
  adminLoading,
  memberCredits,
  memberInvitations,
  onCopy,
  onGenerate,
  setMemberCredits
}: {
  adminLoading: boolean;
  memberCredits: number;
  memberInvitations: ManagedMemberInvitation[];
  onCopy: (code: string) => void;
  onGenerate: () => void;
  setMemberCredits: (value: number) => void;
}) {
  const unusedCount = memberInvitations.filter((invitation) => invitation.status === "unused").length;
  const usedCount = memberInvitations.filter((invitation) => invitation.status === "used").length;

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <div className="self-start">
        <Card className="rounded-xl sm:rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-emerald-300" />
              {copy.admin.signupInvite}
            </CardTitle>
            <CardDescription>{copy.admin.signupDescription}</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                onGenerate();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="member-credits">{copy.admin.initialBalance}</Label>
                <Input
                  id="member-credits"
                  min={0}
                  max={10000}
                  type="number"
                  value={creditInputDisplayValue(memberCredits)}
                  onChange={(event) => setMemberCredits(parseCreditInputValue(event.target.value))}
                />
              </div>
              <Button className="w-full sm:w-auto" type="submit" disabled={adminLoading}>
                {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {copy.admin.generateInvite}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-xl sm:rounded-lg">
        <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-emerald-300" />
              {copy.admin.invitationHistory}
            </CardTitle>
            <CardDescription>{copy.admin.invitationDescription}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="warning">{copy.admin.unusedCount(unusedCount)}</Badge>
            <Badge variant="secondary">{copy.admin.usedCount(usedCount)}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {memberInvitations.length === 0 ? (
            <EmptyState icon={<KeyRound className="h-5 w-5" />} title={copy.admin.noInvitations} />
          ) : (
            <div className="grid gap-3">
              {memberInvitations.map((invitation) => {
                const link = invitationLink(invitation);
                return (
                  <div key={invitation.id} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4 sm:rounded-md sm:p-3">
                    <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-50">
                            {invitation.type === "signup"
                              ? invitation.status === "used"
                                ? copy.admin.joined(invitation.claimedByMemberName ?? invitation.claimedByMemberId ?? copy.common.member)
                                : copy.admin.signupInvite
                              : copy.admin.resetFor(invitation.memberName ?? invitation.memberId ?? copy.common.member)}
                          </p>
                          <Badge variant={invitation.status === "unused" ? "secondary" : invitation.status === "used" ? "default" : "danger"}>
                            {adminInvitationStatusLabel(invitation.status)}
                          </Badge>
                          <Badge variant="muted">{adminInvitationTypeLabel(invitation.type)}</Badge>
                        </div>
                        <p className="mt-1 break-all font-mono text-sm leading-6 text-slate-300 sm:truncate">
                          {invitation.code ?? invitation.codePreview}
                        </p>
                        {link ? (
                          <p className="mt-1 break-all text-xs leading-5 text-emerald-200 sm:truncate">
                            {link}
                          </p>
                        ) : invitation.status === "unused" ? (
                          <p className="mt-1 text-xs leading-5 text-amber-200">
                            {copy.admin.invitationSecretUnavailable}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-slate-500">
                          {invitation.type === "signup" && invitation.credits
                            ? copy.admin.invitationCredits(invitation.credits.remaining, invitation.credits.unitSymbol, invitation.claimedByMemberName)
                            : copy.admin.invitationFor(invitation.memberName ?? invitation.memberId ?? copy.common.member)}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => link && onCopy(link)}
                        disabled={!link || adminLoading}
                        title={copy.admin.copyInvitationLink}
                      >
                        <Copy className="h-4 w-4" />
                        <span className="sr-only">{copy.admin.copyInvitationLink}</span>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AdminCachedAssetsPanel({
  actionLoading,
  assets,
  loading,
  onDelete,
  onRefresh
}: {
  actionLoading: boolean;
  assets: CacheAsset[];
  loading: boolean;
  onDelete: (assetKey: string) => void;
  onRefresh: () => void;
}) {
  const busy = actionLoading || loading;

  return (
    <Card className="rounded-xl sm:rounded-lg">
      <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5 text-emerald-300" />
            {copy.admin.cachedTitle}
          </CardTitle>
          <CardDescription>{copy.admin.cachedDescription}</CardDescription>
        </div>
        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={busy}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {copy.common.refresh}
        </Button>
      </CardHeader>
      <CardContent>
        {assets.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-slate-800 bg-slate-950/70 p-8 text-center text-sm font-semibold text-slate-500 sm:rounded-md">
            {loading ? copy.admin.loadingCached : copy.admin.noCached}
          </div>
        ) : (
          <div className="grid gap-3">
            {assets.map((asset) => (
              <div key={asset.assetKey} className="grid gap-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 p-4 sm:rounded-md">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-semibold leading-6 text-slate-50 sm:truncate">{asset.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400 sm:leading-normal">
                      {mediaQuality(asset.media)} / {formatBytes(asset.media?.contentLength)} / {formatDateTime(asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt)}
                    </p>
                  </div>
                  <Button
                    className="w-full sm:w-auto sm:justify-self-end"
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(asset.assetKey)}
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4" />
                    {copy.admin.deleteCache}
                  </Button>
                </div>

                <div className="grid gap-3 text-sm md:grid-cols-4">
                  <Metric label={copy.admin.asset} value={asset.assetKey} />
                  <Metric label={copy.admin.job} value={asset.jobId ?? copy.common.notRecorded} />
                  <Metric label={copy.admin.cacheFile} value={asset.media?.blobName ?? copy.common.notReady} />
                  <Metric label={copy.admin.range} value={booleanLabel(asset.media?.rangeSupported)} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdminCacheJobsPanel({
  actionLoading,
  jobs,
  loading,
  onDelete,
  onRetry,
  onRefresh
}: {
  actionLoading: boolean;
  jobs: AdminCacheJobEntry[];
  loading: boolean;
  onDelete: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onRefresh: () => void;
}) {
  const busy = actionLoading || loading;

  return (
    <Card className="rounded-xl sm:rounded-lg">
      <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-300" />
            {copy.admin.jobsTitle}
          </CardTitle>
          <CardDescription>{copy.admin.jobsDescription}</CardDescription>
        </div>
        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={busy}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {copy.common.refresh}
        </Button>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-slate-800 bg-slate-950/70 p-8 text-center text-sm font-semibold text-slate-500 sm:rounded-md">
            {copy.admin.noJobs}
          </div>
        ) : (
          <div className="grid gap-3">
            {jobs.map(({ job, asset }) => (
              <div key={job.id} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-4 sm:rounded-md">
                <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="line-clamp-2 font-semibold leading-6 text-slate-50 sm:truncate">{job.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{jobMessageLabel(job)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={jobVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
                    <Badge variant="secondary">{job.progress}%</Badge>
                  </div>
                </div>

                <Progress value={job.progress} />

                <div className="grid gap-3 text-sm md:grid-cols-4">
                  <Metric label={copy.admin.job} value={job.id} />
                  <Metric label={copy.admin.requestId} value={job.lastRequestId ?? job.requestId ?? copy.common.notRecorded} />
                  <Metric label={copy.admin.asset} value={job.assetKey} />
                  <Metric label={copy.admin.sourcePage} value={job.sourcePageId ?? copy.common.notRecorded} />
                  <Metric label={copy.admin.breadcrumb} value={job.sourceBreadcrumb?.join(" / ") ?? copy.common.notRecorded} />
                  <Metric label={copy.admin.updated} value={formatDateTime(job.lastRequestedAt ?? job.updatedAt)} />
                  <Metric label={copy.admin.cacheFile} value={asset?.media?.blobName ?? copy.common.notReady} />
                  <Metric label={copy.admin.size} value={formatBytes(asset?.media?.contentLength)} />
                  <Metric label={copy.admin.range} value={booleanLabel(asset?.media?.rangeSupported)} />
                  <Metric label="MP4" value={mp4StatusLabel(asset?.media)} />
                </div>

                {job.error ? <p className="text-sm font-semibold text-rose-300">{cacheErrorLabel(job.error)}</p> : null}

                <div className="grid gap-2 sm:flex sm:flex-wrap">
                  {job.status === "failed" ? (
                    <Button
                      className="w-full sm:w-auto"
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => onRetry(job.id)}
                      disabled={busy}
                    >
                      <RefreshCw className="h-4 w-4" />
                      {copy.common.continue}
                    </Button>
                  ) : null}
                  <Button
                    className="w-full sm:w-auto"
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => onDelete(job.id)}
                    disabled={busy}
                  >
                    <Trash2 className="h-4 w-4" />
                    {job.status === "ready"
                      ? copy.admin.deleteCache
                      : job.status === "failed"
                        ? copy.admin.deleteFailedJob
                        : copy.admin.deleteJob}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
