import { useEffect, useRef, useState } from "react";
import { Cloud, Loader2, Play, RefreshCw, Search, Square, Trash2 } from "lucide-react";
import type { SearchResult } from "@wwpdw/shared";

import {
  cancelAdminOssPreparation,
  createAdminOssPreparation,
  deleteAdminOssPreparation,
  errorMessage,
  getAdminOssPlaybackPocStatus,
  listAdminOssPreparations,
  searchAssets,
  type AdminOssPreparationJob,
  type AdminOssPlaybackPocStatus
} from "../../api";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ensureOssPlaybackServiceWorker } from "../../oss-playback-service-worker";
import { Metric } from "./MediaDiagnosticsView";

interface OssPlaybackDiagnostic {
  contentRange?: string | null;
  error?: string;
  forceDownload?: string | null;
  phase: "upstream" | "error";
  range?: string | null;
  status?: number;
}

function isOssPlaybackDiagnostic(value: unknown): value is OssPlaybackDiagnostic & {
  source: "wwpdw-oss-playback-poc";
} {
  return Boolean(
    value
    && typeof value === "object"
    && "source" in value
    && value.source === "wwpdw-oss-playback-poc"
    && "phase" in value
  );
}

interface PreparationChoice {
  assetKey: string;
  label: string;
  size?: number;
  title: string;
}

function preparationChoices(results: SearchResult[]): PreparationChoice[] {
  return results.flatMap((result) => {
    if (result.variants?.length) {
      return result.variants.map((variant) => ({
        assetKey: variant.assetKey,
        label: variant.label,
        size: variant.metadata?.exactByteSize,
        title: result.title
      }));
    }
    return [{
      assetKey: result.assetKey,
      label: result.durationLabel || "默认片源",
      title: result.title
    }];
  });
}

function bytesLabel(value?: number) {
  if (!value) return "大小未知";
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function preparationStatusLabel(status: AdminOssPreparationJob["status"]) {
  return {
    queued: "排队中",
    running: "准备中",
    ready: "已完成",
    failed: "失败",
    cancelling: "取消中",
    cancelled: "已取消"
  }[status];
}

export function OssPlaybackPocPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<AdminOssPlaybackPocStatus>();
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [message, setMessage] = useState("正在读取测试配置…");
  const [error, setError] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [requestCount, setRequestCount] = useState(0);
  const [diagnostic, setDiagnostic] = useState<OssPlaybackDiagnostic>();
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState<PreparationChoice[]>([]);
  const [searching, setSearching] = useState(false);
  const [preparations, setPreparations] = useState<AdminOssPreparationJob[]>([]);
  const [preparationsEnabled, setPreparationsEnabled] = useState(false);
  const [preparationConcurrency, setPreparationConcurrency] = useState(2);
  const [loadingPreparations, setLoadingPreparations] = useState(true);
  const [actionId, setActionId] = useState("");

  async function refreshStatus() {
    setLoading(true);
    setError("");
    try {
      const next = await getAdminOssPlaybackPocStatus();
      setStatus(next);
      setMessage(next.enabled ? "测试视频已经就绪。" : next.reason ?? "国内线路测试尚未启用。");
    } catch (nextError) {
      setError(errorMessage(nextError, "无法读取国内线路测试配置。"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
    void refreshPreparations();
  }, []);

  useEffect(() => {
    if (!preparations.some((job) => ["queued", "running", "cancelling"].includes(job.status))) {
      return;
    }
    const timer = window.setInterval(() => void refreshPreparations(false), 5_000);
    return () => window.clearInterval(timer);
  }, [preparations]);

  useEffect(() => {
    function onMessage(event: MessageEvent<unknown>) {
      if (!isOssPlaybackDiagnostic(event.data)) return;
      setDiagnostic(event.data);
      if (event.data.phase === "upstream") {
        setRequestCount((count) => count + 1);
      }
      if (event.data.error) setError(event.data.error);
    }
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const player = videoRef.current;
    if (!player || !mediaUrl) return;
    player.src = mediaUrl;
    player.load();
    void player.play().catch((playError) => {
      setMessage("浏览器阻止了自动播放，请手动点击播放器。");
      setError(playError instanceof Error ? playError.message : "");
    });
  }, [mediaUrl]);

  async function startTest() {
    setStarting(true);
    setError("");
    setDiagnostic(undefined);
    setRequestCount(0);
    setCurrentTime(0);
    setDuration(0);
    setMessage("正在启动浏览器播放适配器…");
    try {
      const currentStatus = status?.enabled ? status : await getAdminOssPlaybackPocStatus();
      setStatus(currentStatus);
      if (!currentStatus.enabled || !currentStatus.mediaUrl) {
        throw new Error(currentStatus.reason ?? "国内线路测试尚未配置完成。");
      }
      await ensureOssPlaybackServiceWorker();
      setMessage("正在向国内线路请求视频数据…");
      setMediaUrl(`${currentStatus.mediaUrl}?run=${Date.now()}`);
    } catch (nextError) {
      setError(errorMessage(nextError, "国内线路播放测试启动失败。"));
      setMessage("测试未启动。");
    } finally {
      setStarting(false);
    }
  }

  async function refreshPreparations(showLoading = true) {
    if (showLoading) setLoadingPreparations(true);
    try {
      const response = await listAdminOssPreparations();
      setPreparations(response.jobs);
      setPreparationsEnabled(response.enabled);
      setPreparationConcurrency(response.concurrency);
    } catch (nextError) {
      setError(errorMessage(nextError, "无法读取国内线路准备任务。"));
    } finally {
      if (showLoading) setLoadingPreparations(false);
    }
  }

  async function runSearch(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setError("");
    try {
      const response = await searchAssets(query.trim());
      setChoices(preparationChoices(response.results));
      if (response.results.length === 0) setMessage("没有找到可准备的片源。");
    } catch (nextError) {
      setError(errorMessage(nextError, "搜索片源失败。"));
    } finally {
      setSearching(false);
    }
  }

  async function prepare(choice: PreparationChoice) {
    setActionId(choice.assetKey);
    setError("");
    try {
      await createAdminOssPreparation(choice.assetKey);
      setMessage(`“${choice.title} / ${choice.label}”已进入准备队列。`);
      await refreshPreparations(false);
    } catch (nextError) {
      setError(errorMessage(nextError, "无法创建国内线路准备任务。"));
    } finally {
      setActionId("");
    }
  }

  async function cancelPreparation(job: AdminOssPreparationJob) {
    setActionId(job.id);
    setError("");
    try {
      await cancelAdminOssPreparation(job.id);
      await refreshPreparations(false);
    } catch (nextError) {
      setError(errorMessage(nextError, "无法取消准备任务。"));
    } finally {
      setActionId("");
    }
  }

  async function deletePreparation(job: AdminOssPreparationJob) {
    setActionId(job.id);
    setError("");
    try {
      await deleteAdminOssPreparation(job.id);
      if (mediaUrl.includes(job.id)) {
        setMediaUrl("");
        videoRef.current?.removeAttribute("src");
        videoRef.current?.load();
      }
      await refreshPreparations(false);
    } catch (nextError) {
      setError(errorMessage(nextError, "无法删除国内线路文件。"));
    } finally {
      setActionId("");
    }
  }

  async function playPreparation(job: AdminOssPreparationJob) {
    setActionId(job.id);
    setError("");
    setMessage("正在启动国内线路播放…");
    setDiagnostic(undefined);
    setRequestCount(0);
    try {
      await ensureOssPlaybackServiceWorker();
      setMediaUrl(`/api/admin/oss-preparations/${encodeURIComponent(job.id)}/media?run=${Date.now()}`);
    } catch (nextError) {
      setError(errorMessage(nextError, "无法启动国内线路播放。"));
    } finally {
      setActionId("");
    }
  }

  return (
    <div className="grid gap-4">
      <Card className="rounded-xl border-cyan-400/20 sm:rounded-lg">
        <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5 text-cyan-300" />
              实际片源灰度准备
            </CardTitle>
            <CardDescription>
              仅管理员可见。片源直接从 Notion 进入国内线路；最多 {preparationConcurrency} 路同时准备，超出的任务会显示“排队中”并自动接续。
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void refreshPreparations()}
            disabled={loadingPreparations}
          >
            <RefreshCw className={`h-4 w-4 ${loadingPreparations ? "animate-spin" : ""}`} />
            刷新任务
          </Button>
        </CardHeader>
        <CardContent className="grid gap-5">
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={runSearch}>
            <input
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-cyan-400"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索一部片，例如：冲出宁静号"
              aria-label="搜索实际片源"
            />
            <Button type="submit" disabled={searching || !query.trim()}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              搜索片源
            </Button>
          </form>

          {choices.length > 0 ? (
            <div className="grid gap-2">
              {choices.map((choice) => (
                <div
                  className="flex flex-col justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3 sm:flex-row sm:items-center"
                  key={choice.assetKey}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">{choice.title}</p>
                    <p className="text-xs text-slate-400">{choice.label} · {bytesLabel(choice.size)}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void prepare(choice)}
                    disabled={!preparationsEnabled || Boolean(actionId)}
                  >
                    {actionId === choice.assetKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Cloud className="h-4 w-4" />}
                    准备到国内线路
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid gap-2">
            {preparations.length === 0 && !loadingPreparations ? (
              <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-400">
                还没有实际片源准备任务。
              </p>
            ) : preparations.map((job) => (
              <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/60 p-3" key={job.id}>
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-100">{job.title}</p>
                    <p className="text-xs text-slate-400">
                      {preparationStatusLabel(job.status)} · {bytesLabel(job.contentLength ?? job.expectedBytes)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {job.status === "ready" ? (
                      <Button type="button" size="sm" onClick={() => void playPreparation(job)} disabled={Boolean(actionId)}>
                        <Play className="h-4 w-4" />
                        播放
                      </Button>
                    ) : null}
                    {["queued", "running"].includes(job.status) ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => void cancelPreparation(job)} disabled={Boolean(actionId)}>
                        <Square className="h-4 w-4" />
                        取消
                      </Button>
                    ) : null}
                    {["ready", "failed", "cancelled"].includes(job.status) ? (
                      <Button type="button" size="sm" variant="outline" onClick={() => void deletePreparation(job)} disabled={Boolean(actionId)}>
                        <Trash2 className="h-4 w-4" />
                        删除
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${job.status === "failed" ? "bg-rose-400" : "bg-cyan-400"}`}
                    style={{ width: `${job.progress}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400" role="status">{job.error || job.message}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-xl sm:rounded-lg">
        <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5 text-emerald-300" />
              国内线路播放验证
            </CardTitle>
            <CardDescription>
              管理员专用小视频。验证国内线路经过浏览器响应适配后能否播放和拖动，不影响现有国际线路。
            </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => void refreshStatus()} disabled={loading || starting}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            刷新配置
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric label="配置状态" value={status?.enabled ? "已启用" : "未启用"} />
            <Metric label="测试对象" value={status?.objectKey ?? "未配置"} />
            <Metric label="签名有效期" value={status ? `${status.expiresMinutes} 分钟` : "—"} />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button type="button" onClick={() => void startTest()} disabled={loading || starting || !status?.enabled}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              开始国内线路测试
            </Button>
            <p className="text-sm text-slate-400" role="status">{message}</p>
          </div>
          {error ? (
            <p className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200">
              {error}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="rounded-xl sm:rounded-lg">
        <CardHeader>
          <CardTitle>实际播放器</CardTitle>
          <CardDescription>可直接拖动进度条；拖动后继续播放即表示国内线路的分段读取链路成立。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <video
            className="aspect-video w-full rounded-lg border border-slate-800 bg-black"
            controls
            muted
            playsInline
            ref={videoRef}
            onError={() => {
              const playerError = videoRef.current?.error;
              setError(playerError?.message ?? `播放器错误代码 ${playerError?.code ?? "未知"}`);
              setMessage("视频未能播放。");
            }}
            onLoadedMetadata={(event) => {
              setDuration(event.currentTarget.duration);
              setMessage(`已读取视频，时长 ${event.currentTarget.duration.toFixed(1)} 秒。`);
            }}
            onPlaying={() => setMessage("正在通过国内线路分段请求播放。")}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="播放位置" value={`${currentTime.toFixed(1)} / ${duration.toFixed(1)} 秒`} />
            <Metric label="国内线路请求数" value={String(requestCount)} />
            <Metric label="上游状态" value={diagnostic?.status ? String(diagnostic.status) : "—"} />
            <Metric label="原始强制下载" value={diagnostic?.forceDownload === "true" ? "是（已移除）" : "否/未返回"} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Metric label="Range 请求" value={diagnostic?.range ?? "—"} />
            <Metric label="Content-Range" value={diagnostic?.contentRange ?? "—"} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
