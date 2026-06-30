import {
  Activity,
  Copy,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  Users
} from "lucide-react";
import type { AdminCacheJobEntry } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Progress } from "../../components/ui/progress";
import {
  booleanLabel,
  cacheErrorLabel,
  creditWindowLabel,
  creditsLabel,
  formatBytes,
  formatDateTime,
  formatLongDate,
  jobMessageLabel,
  jobStatusLabel,
  jobVariant,
  mp4StatusLabel
} from "../format";
import type { ManagedMemberCode } from "../types";
import { EmptyState } from "./EmptyState";
import { Metric } from "./MediaDiagnosticsView";

interface AdminPanelProps {
  adminUnlocked: boolean;
  adminError: string;
  adminLoading: boolean;
  cacheJobs: AdminCacheJobEntry[];
  cacheJobsLoading: boolean;
  adminKeyInput: string;
  memberName: string;
  memberDays: number;
  memberCredits: number;
  memberFiveHourLimit: number;
  memberWeekLimit: number;
  memberTopUps: Record<string, number>;
  memberCodes: ManagedMemberCode[];
  setAdminKeyInput: (value: string) => void;
  setMemberName: (value: string) => void;
  setMemberDays: (value: number) => void;
  setMemberCredits: (value: number) => void;
  setMemberFiveHourLimit: (value: number) => void;
  setMemberWeekLimit: (value: number) => void;
  setMemberTopUp: (id: string, value: number) => void;
  onUnlock: () => void;
  onGenerate: () => void;
  onCopy: (code: string) => void;
  onDelete: (id: string) => void;
  onRefreshJobs: () => void;
  onTopUp: (id: string) => void;
  onRevoke: (id: string) => void;
}

export function AdminPanel({
  adminUnlocked,
  adminError,
  adminLoading,
  cacheJobs,
  cacheJobsLoading,
  adminKeyInput,
  memberName,
  memberDays,
  memberCredits,
  memberFiveHourLimit,
  memberWeekLimit,
  memberTopUps,
  memberCodes,
  setAdminKeyInput,
  setMemberName,
  setMemberDays,
  setMemberCredits,
  setMemberFiveHourLimit,
  setMemberWeekLimit,
  setMemberTopUp,
  onUnlock,
  onGenerate,
  onCopy,
  onDelete,
  onRefreshJobs,
  onTopUp,
  onRevoke
}: AdminPanelProps) {
  if (!adminUnlocked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            Administrator
          </CardTitle>
          <CardDescription>Enter the administrator key to manage household Cinema Passes.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid max-w-md gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              onUnlock();
            }}
          >
            <Label htmlFor="admin-key">Admin key</Label>
            <Input
              id="admin-key"
              value={adminKeyInput}
              onChange={(event) => setAdminKeyInput(event.target.value)}
              type="password"
            />
            {adminError ? <p className="text-sm font-semibold text-rose-300">{adminError}</p> : null}
            <Button type="submit" disabled={adminLoading}>
              {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Unlock
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-emerald-300" />
              New Cinema Pass
            </CardTitle>
            <CardDescription>Generate a household pass with a personal 🍀 allowance</CardDescription>
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
                <Label htmlFor="member-name">Member name</Label>
                <Input id="member-name" value={memberName} onChange={(event) => setMemberName(event.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="member-days">Days</Label>
                <Input
                  id="member-days"
                  min={1}
                  max={365}
                  type="number"
                  value={memberDays}
                  onChange={(event) => setMemberDays(Number(event.target.value))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="member-credits">🍀 Total</Label>
                  <Input
                    id="member-credits"
                    min={0}
                    max={10000}
                    type="number"
                    value={memberCredits}
                    onChange={(event) => setMemberCredits(Number(event.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="member-five-hour-limit">5h limit</Label>
                  <Input
                    id="member-five-hour-limit"
                    min={0}
                    max={10000}
                    type="number"
                    value={memberFiveHourLimit}
                    onChange={(event) => setMemberFiveHourLimit(Number(event.target.value))}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="member-week-limit">Week limit</Label>
                  <Input
                    id="member-week-limit"
                    min={0}
                    max={10000}
                    type="number"
                    value={memberWeekLimit}
                    onChange={(event) => setMemberWeekLimit(Number(event.target.value))}
                  />
                </div>
              </div>
              {adminError ? <p className="text-sm font-semibold text-rose-300">{adminError}</p> : null}
              <Button type="submit" disabled={adminLoading}>
                {adminLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                Generate
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-3">
          {memberCodes.length === 0 ? (
            <EmptyState icon={<Users className="h-5 w-5" />} title="No Cinema Passes" />
          ) : (
            memberCodes.map((code) => (
              <Card key={code.id}>
                <CardContent className="grid gap-3 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-50">{code.name}</p>
                      <Badge variant={code.status === "active" ? "default" : "danger"}>{code.status}</Badge>
                    </div>
                    <p className="mt-1 truncate font-mono text-sm text-slate-300">
                      {code.code ?? code.codePreview}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Expires {formatLongDate(code.expiresAt)}</p>
                    <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                      <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
                        <p className="text-slate-500">Allowance</p>
                        <p className="mt-1 font-semibold text-emerald-200">{creditsLabel(code)}</p>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
                        <p className="text-slate-500">5h limit</p>
                        <p className="mt-1 font-semibold">
                          {creditWindowLabel(code.credits.fiveHour.used, code.credits.fiveHour.limit)}
                        </p>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950/70 p-2">
                        <p className="text-slate-500">Week limit</p>
                        <p className="mt-1 font-semibold">
                          {creditWindowLabel(code.credits.week.used, code.credits.week.limit)}
                        </p>
                      </div>
                    </div>
                    {!code.code ? (
                      <p className="mt-1 text-xs text-amber-200">
                        Full code is shown only when generated.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:justify-end">
                    <div className="flex items-center gap-2">
                      <Input
                        className="h-9 w-20"
                        min={1}
                        max={10000}
                        type="number"
                        value={memberTopUps[code.id] ?? 10}
                        onChange={(event) => setMemberTopUp(code.id, Number(event.target.value))}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onTopUp(code.id)}
                        disabled={adminLoading || code.status !== "active"}
                      >
                        +🍀
                      </Button>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onClick={() => code.code && onCopy(code.code)}
                      disabled={!code.code || adminLoading}
                    >
                      <Copy className="h-4 w-4" />
                      <span className="sr-only">Copy</span>
                    </Button>
                    {code.status === "active" ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onRevoke(code.id)}
                        disabled={adminLoading}
                      >
                        Revoke
                      </Button>
                    ) : null}
                    {code.status !== "active" ? (
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => onDelete(code.id)}
                        disabled={adminLoading}
                      >
                        Delete
                      </Button>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <AdminCacheJobsPanel jobs={cacheJobs} loading={cacheJobsLoading} onRefresh={onRefreshJobs} />
    </div>
  );
}

function AdminCacheJobsPanel({
  jobs,
  loading,
  onRefresh
}: {
  jobs: AdminCacheJobEntry[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-emerald-300" />
            Recent cache jobs
          </CardTitle>
          <CardDescription>Worker state, asset keys, and request ids for cache debugging.</CardDescription>
        </div>
        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </CardHeader>
      <CardContent>
        {jobs.length === 0 ? (
          <div className="grid place-items-center rounded-md border border-slate-800 bg-slate-950/70 p-8 text-center text-sm font-semibold text-slate-500">
            No cache jobs recorded
          </div>
        ) : (
          <div className="grid gap-3">
            {jobs.map(({ job, asset }) => (
              <div key={job.id} className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-slate-50">{job.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-400">{jobMessageLabel(job)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant={jobVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
                    <Badge variant="secondary">{job.progress}%</Badge>
                  </div>
                </div>

                <Progress value={job.progress} />

                <div className="grid gap-3 text-sm md:grid-cols-4">
                  <Metric label="Job" value={job.id} />
                  <Metric label="Request" value={job.lastRequestId ?? job.requestId ?? "not captured"} />
                  <Metric label="Asset" value={job.assetKey} />
                  <Metric label="Updated" value={formatDateTime(job.lastRequestedAt ?? job.updatedAt)} />
                  <Metric label="Blob" value={asset?.media?.blobName ?? "not ready"} />
                  <Metric label="Size" value={formatBytes(asset?.media?.contentLength)} />
                  <Metric label="Range" value={booleanLabel(asset?.media?.rangeSupported)} />
                  <Metric label="MP4" value={mp4StatusLabel(asset?.media)} />
                </div>

                {job.error ? <p className="text-sm font-semibold text-rose-300">{cacheErrorLabel(job.error)}</p> : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
