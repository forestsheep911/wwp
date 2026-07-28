import { useEffect, useRef, useState } from "react";
import { Cloud, Loader2, Play, RefreshCw } from "lucide-react";

import {
  errorMessage,
  getAdminOssPlaybackPocStatus,
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

  async function refreshStatus() {
    setLoading(true);
    setError("");
    try {
      const next = await getAdminOssPlaybackPocStatus();
      setStatus(next);
      setMessage(next.enabled ? "测试视频已经就绪。" : next.reason ?? "OSS 测试尚未启用。");
    } catch (nextError) {
      setError(errorMessage(nextError, "无法读取 OSS 测试配置。"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshStatus();
  }, []);

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
        throw new Error(currentStatus.reason ?? "OSS 测试尚未配置完成。");
      }
      await ensureOssPlaybackServiceWorker();
      setMessage("正在向 OSS 请求视频数据…");
      setMediaUrl(`${currentStatus.mediaUrl}?run=${Date.now()}`);
    } catch (nextError) {
      setError(errorMessage(nextError, "OSS 播放测试启动失败。"));
      setMessage("测试未启动。");
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Card className="rounded-xl sm:rounded-lg">
        <CardHeader className="flex flex-col items-start justify-between gap-4 sm:flex-row">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5 text-emerald-300" />
              国内 OSS 播放验证
            </CardTitle>
            <CardDescription>
              管理员专用小视频。验证默认 OSS 域名经过浏览器响应适配后能否播放和拖动，不影响现有 Blob 线路。
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
              开始 OSS 测试
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
          <CardDescription>可直接拖动进度条；拖动后继续播放即表示 OSS Range 链路成立。</CardDescription>
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
            onPlaying={() => setMessage("正在通过 OSS Range 请求播放。")}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="播放位置" value={`${currentTime.toFixed(1)} / ${duration.toFixed(1)} 秒`} />
            <Metric label="OSS 请求数" value={String(requestCount)} />
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
