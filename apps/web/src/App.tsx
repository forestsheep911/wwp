import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  Film,
  History,
  KeyRound,
  Loader2,
  LockKeyhole,
  Play,
  Search,
  ShieldCheck,
  UserPlus,
  Users
} from "lucide-react";
import type {
  AccessRole,
  AuthCheckResponse,
  CacheAsset,
  CacheJob,
  GeneratedMemberAccessCode,
  MediaDiagnostics,
  MediaVariant,
  MemberAccessCode,
  PlaybackResponse,
  SearchResult
} from "@wwpdw/shared";
import {
  checkAccess,
  clearAccessKey,
  createMemberAccessCode,
  ensureCache,
  errorMessage,
  getAccessKey,
  getCacheStatus,
  getPlayback,
  isUnauthorizedError,
  listMemberCodes,
  revokeMemberAccessCode,
  searchAssets,
  setAccessKey
} from "./api";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import { Progress } from "./components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";

type ResultWithCache = SearchResult & { cache?: CacheAsset };
type AppTab = "library" | "cached" | "history" | "admin";

interface PlaybackHistoryEntry {
  assetKey: string;
  title: string;
  playedAt: string;
  contentType?: string;
  contentLength?: number;
}

type ManagedMemberCode = MemberAccessCode & { code?: string };

const historyStorageKey = "wwpdw-playback-history";

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value));
}

function formatDate(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function formatLongDate(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(date);
}

function cacheLabel(asset?: CacheAsset) {
  if (!asset) {
    return "not cached";
  }

  return asset.status === "ready" ? "ready" : asset.status;
}

function cacheVariant(asset?: CacheAsset): "default" | "secondary" | "warning" | "danger" | "muted" {
  if (!asset) {
    return "muted";
  }

  if (asset.status === "ready") {
    return "default";
  }

  if (asset.status === "failed") {
    return "danger";
  }

  return "warning";
}

function formatBytes(value?: number) {
  if (!Number.isFinite(value)) {
    return "unknown";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value ?? 0;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function booleanLabel(value?: boolean) {
  if (value === undefined) {
    return "unknown";
  }

  return value ? "yes" : "no";
}

function mp4StatusLabel(media?: MediaDiagnostics) {
  switch (media?.mp4?.status) {
    case "faststart":
      return "faststart";
    case "late_moov":
      return "late moov";
    case "not_mp4":
      return "not mp4";
    case "unknown":
      return "unknown";
    default:
      return "not checked";
  }
}

function offsetLabel(value?: number) {
  return value === undefined ? "unknown" : value.toLocaleString();
}

function titleInitial(title: string) {
  return title.match(/[\u3400-\u9fff]/)?.[0] ?? title.trim().charAt(0).toUpperCase() ?? "W";
}

function metadataLine(result: SearchResult) {
  const metadata = result.metadata;
  const parts = [
    metadata?.year,
    metadata?.type,
    metadata?.ratingLevel?.[0],
    formatLongDate(metadata?.releaseDate)
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : `${result.source} / ${formatDate(result.updatedAt)}`;
}

function bestSummary(result: SearchResult) {
  return result.metadata?.description ?? result.metadata?.info ?? result.summary;
}

function mediaQuality(media?: MediaDiagnostics) {
  if (!media) {
    return "Media not checked";
  }

  if (media.mp4?.status === "faststart" && media.rangeSupported) {
    return "Seek ready";
  }

  if (media.mp4?.status === "late_moov") {
    return "Seek may be slow";
  }

  return "Playback checked";
}

function MediaDiagnosticsView({ media }: { media?: MediaDiagnostics }) {
  if (!media) {
    return null;
  }

  return (
    <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase text-slate-500">Media</span>
        <Badge variant={media.mp4?.status === "late_moov" ? "warning" : "secondary"}>
          {mediaQuality(media)}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Metric label="Type" value={media.contentType ?? "unknown"} />
        <Metric label="Size" value={formatBytes(media.contentLength)} />
        <Metric label="Range" value={booleanLabel(media.rangeSupported)} />
        <Metric label="MP4" value={mp4StatusLabel(media)} />
      </div>
      {media.mp4 ? (
        <p className="text-xs leading-5 text-slate-500">
          moov {offsetLabel(media.mp4.moovOffset)} / mdat {offsetLabel(media.mp4.mdatOffset)}
        </p>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="truncate text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}

function AccessGate({ onUnlock }: { onUnlock: (auth: AuthCheckResponse) => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const candidate = value.trim();
    if (!candidate) {
      setError("Enter an access key.");
      return;
    }

    setLoading(true);
    setError("");
    setAccessKey(candidate);
    try {
      const auth = await checkAccess();
      onUnlock(auth);
    } catch (accessError) {
      clearAccessKey();
      setError(errorMessage(accessError, "Access key did not match."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-400/15 text-emerald-200">
            <LockKeyhole className="h-6 w-6" />
          </div>
          <CardTitle className="text-2xl">WW Family Cinema</CardTitle>
          <CardDescription>Private household screening room</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="access-key">Access key</Label>
              <Input
                id="access-key"
                autoFocus
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError("");
                }}
                type="password"
              />
            </div>
            {error ? <p className="text-sm font-semibold text-rose-300">{error}</p> : null}
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Enter
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}

function MoviePoster({ result }: { result: SearchResult }) {
  return (
    <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-slate-900">
      <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 to-emerald-950 text-4xl font-black text-emerald-100">
        {titleInitial(result.title)}
      </div>
      {result.metadata?.posterUrl ? (
        <img
          alt={result.title}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          src={result.metadata.posterUrl}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
    </div>
  );
}

function MovieCard({
  result,
  loading,
  onSelect
}: {
  result: ResultWithCache;
  loading: boolean;
  onSelect: (result: ResultWithCache, variant: MediaVariant) => void;
}) {
  const variants = result.variants ?? [];

  return (
    <article className="grid overflow-hidden rounded-lg border border-slate-800 bg-slate-950/80 shadow-2xl shadow-black/20 md:grid-cols-[180px_minmax(0,1fr)]">
      <MoviePoster result={result} />
      <div className="grid min-w-0 gap-4 p-4">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight text-slate-50">{result.title}</h2>
              <p className="mt-1 text-sm text-slate-400">{metadataLine(result)}</p>
            </div>
            <Badge variant="secondary">
              <Film className="h-3.5 w-3.5" />
              {variants.length} {variants.length === 1 ? "spec" : "specs"}
            </Badge>
          </div>

          {result.metadata?.ratings?.length ? (
            <div className="flex flex-wrap gap-2">
              {result.metadata.ratings.map((rating) => (
                <Badge key={`${rating.label}-${rating.value}`} variant="warning">
                  {rating.label} <span className="text-slate-50">{rating.value}</span>
                </Badge>
              ))}
            </div>
          ) : null}

          {result.metadata?.genres?.length || result.metadata?.people?.length ? (
            <div className="flex flex-wrap gap-2">
              {result.metadata.genres?.slice(0, 4).map((tag) => (
                <Badge key={`genre-${tag}`} variant="secondary">{tag}</Badge>
              ))}
              {result.metadata.people?.slice(0, 3).map((tag) => (
                <Badge key={`people-${tag}`} variant="muted">{tag}</Badge>
              ))}
            </div>
          ) : null}

          <p className="line-clamp-4 text-sm leading-6 text-slate-400">{bestSummary(result)}</p>
        </div>

        <div className="grid gap-2">
          {variants.length > 0 ? (
            variants.map((variant) => (
              <Button
                className="h-auto justify-between px-3 py-2 text-left"
                key={variant.assetKey}
                type="button"
                variant={variant.cache?.status === "ready" ? "default" : "secondary"}
                onClick={() => onSelect(result, variant)}
                disabled={loading}
              >
                <span className="min-w-0 truncate">{variant.label}</span>
                <Badge variant={cacheVariant(variant.cache)}>{cacheLabel(variant.cache)}</Badge>
              </Button>
            ))
          ) : (
            <Badge variant="danger">No specs</Badge>
          )}
        </div>
      </div>
    </article>
  );
}

function StatusPanel({
  job,
  asset,
  playback,
  onOpenPlayer
}: {
  job?: CacheJob;
  asset?: CacheAsset;
  playback?: PlaybackResponse;
  onOpenPlayer: () => void;
}) {
  if (!job || !asset) {
    return (
      <Card className="sticky top-5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4 text-emerald-300" />
            Cache
          </CardTitle>
          <CardDescription>No active item</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="sticky top-5">
      <CardHeader>
        <CardTitle className="text-base">{job.title}</CardTitle>
        <CardDescription>{job.message}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <Progress value={job.progress} />
        <div className="flex items-center justify-between text-sm">
          <Badge variant={cacheVariant(asset)}>{job.status}</Badge>
          <span className="font-semibold text-slate-200">{job.progress}%</span>
        </div>
        {job.resolve ? (
          <p className="text-xs text-slate-500">
            Resolver: {job.resolve.layer} / {job.resolve.kind}
          </p>
        ) : null}
        {job.error ? <p className="text-sm font-semibold text-rose-300">{job.error}</p> : null}
        {asset.expiresAt ? <p className="text-xs text-slate-500">Expires {formatLongDate(asset.expiresAt)}</p> : null}
        <MediaDiagnosticsView media={asset.media} />
        {asset.status === "ready" ? (
          <Button type="button" onClick={onOpenPlayer}>
            <Play className="h-4 w-4" />
            {playback ? "Open player" : "Prepare player"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Player({
  playback,
  onClose
}: {
  playback: PlaybackResponse;
  onClose: () => void;
}) {
  const isMock = playback.playbackUrl.startsWith("mock://");

  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto grid max-w-6xl gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-emerald-300">Now Playing</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-50">{playback.title}</h1>
          </div>
          <Button type="button" variant="outline" onClick={onClose}>
            Back to cinema
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-black shadow-2xl">
          {isMock ? (
            <div className="grid aspect-video place-items-center text-slate-400">
              <div className="grid place-items-center gap-3">
                <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-400 text-slate-950">
                  <Play className="h-9 w-9" />
                </div>
                <p className="text-sm">{playback.assetKey}</p>
              </div>
            </div>
          ) : (
            <video className="aspect-video w-full bg-black" src={playback.playbackUrl} controls />
          )}
        </div>
        <MediaDiagnosticsView media={playback.media} />
        <p className="text-xs text-slate-500">Signed URL expires {formatLongDate(playback.expiresAt)}</p>
      </div>
    </main>
  );
}

function CachedShelf({
  cachedItems,
  onOpen
}: {
  cachedItems: Array<{ asset: CacheAsset; result: SearchResult }>;
  onOpen: (assetKey: string) => void;
}) {
  if (cachedItems.length === 0) {
    return <EmptyState icon={<Database className="h-5 w-5" />} title="No cached titles in current view" />;
  }

  return (
    <div className="grid gap-3">
      {cachedItems.map(({ asset, result }) => (
        <Card key={asset.assetKey}>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-50">{asset.title}</p>
              <p className="mt-1 text-sm text-slate-400">
                {mediaQuality(asset.media)} / {formatBytes(asset.media?.contentLength)} / {metadataLine(result)}
              </p>
            </div>
            <Button type="button" onClick={() => onOpen(asset.assetKey)}>
              <Play className="h-4 w-4" />
              Play
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function HistoryPanel({
  items,
  onClear
}: {
  items: PlaybackHistoryEntry[];
  onClear: () => void;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<History className="h-5 w-5" />} title="No playback history" />;
  }

  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button type="button" variant="outline" size="sm" onClick={onClear}>
          Clear history
        </Button>
      </div>
      {items.map((item) => (
        <Card key={`${item.assetKey}-${item.playedAt}`}>
          <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="truncate font-semibold text-slate-50">{item.title}</p>
              <p className="mt-1 text-sm text-slate-400">
                {formatLongDate(item.playedAt)} / {item.contentType ?? "unknown"} / {formatBytes(item.contentLength)}
              </p>
            </div>
            <Badge variant="secondary">
              <Clock3 className="h-3.5 w-3.5" />
              played
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function AdminPanel({
  adminUnlocked,
  adminError,
  adminLoading,
  adminKeyInput,
  memberName,
  memberDays,
  memberCodes,
  setAdminKeyInput,
  setMemberName,
  setMemberDays,
  onUnlock,
  onGenerate,
  onCopy,
  onRevoke
}: {
  adminUnlocked: boolean;
  adminError: string;
  adminLoading: boolean;
  adminKeyInput: string;
  memberName: string;
  memberDays: number;
  memberCodes: ManagedMemberCode[];
  setAdminKeyInput: (value: string) => void;
  setMemberName: (value: string) => void;
  setMemberDays: (value: number) => void;
  onUnlock: () => void;
  onGenerate: () => void;
  onCopy: (code: string) => void;
  onRevoke: (id: string) => void;
}) {
  if (!adminUnlocked) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            Administrator
          </CardTitle>
          <CardDescription>Enter the administrator key to manage household member codes.</CardDescription>
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
    <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5 text-emerald-300" />
            New member code
          </CardTitle>
          <CardDescription>Generate a household viewing key</CardDescription>
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
          <EmptyState icon={<Users className="h-5 w-5" />} title="No member codes" />
        ) : (
          memberCodes.map((code) => (
            <Card key={code.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-50">{code.name}</p>
                    <Badge variant={code.status === "active" ? "default" : "danger"}>{code.status}</Badge>
                  </div>
                  <p className="mt-1 font-mono text-sm text-slate-300">
                    {code.code ?? code.codePreview}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">Expires {formatLongDate(code.expiresAt)}</p>
                  {!code.code ? (
                    <p className="mt-1 text-xs text-amber-200">
                      Full code is shown only when generated.
                    </p>
                  ) : null}
                </div>
                <div className="flex gap-2">
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
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <Card>
      <CardContent className="grid place-items-center gap-3 p-10 text-center text-slate-500">
        <div className="grid h-10 w-10 place-items-center rounded-lg border border-slate-800 bg-slate-950">
          {icon}
        </div>
        <p className="font-semibold">{title}</p>
      </CardContent>
    </Card>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => Boolean(getAccessKey()));
  const [role, setRole] = useState<AccessRole | undefined>();
  const [activeTab, setActiveTab] = useState<AppTab>("library");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultWithCache[]>([]);
  const [job, setJob] = useState<CacheJob | undefined>();
  const [asset, setAsset] = useState<CacheAsset | undefined>();
  const [playback, setPlayback] = useState<PlaybackResponse | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<PlaybackHistoryEntry[]>(() => readJsonStorage(historyStorageKey, []));
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberDays, setMemberDays] = useState(30);
  const [memberCodes, setMemberCodes] = useState<ManagedMemberCode[]>([]);

  const readyCount = useMemo(
    () =>
      results.reduce((count, item) => {
        const resultReady = item.cache?.status === "ready" ? 1 : 0;
        const variantReady = item.variants?.filter((variant) => variant.cache?.status === "ready").length ?? 0;
        return count + resultReady + variantReady;
      }, 0),
    [results]
  );

  const cachedItems = useMemo(() => {
    const items: Array<{ asset: CacheAsset; result: SearchResult }> = [];
    for (const result of results) {
      if (result.cache?.status === "ready") {
        items.push({ asset: result.cache, result });
      }
      for (const variant of result.variants ?? []) {
        if (variant.cache?.status === "ready") {
          items.push({
            asset: variant.cache,
            result: variantToResult(result, variant)
          });
        }
      }
    }
    return items;
  }, [results]);

  function variantToResult(result: SearchResult, variant: MediaVariant): SearchResult {
    return {
      assetKey: variant.assetKey,
      title: `${result.title} / ${variant.label}`,
      source: result.source,
      sourceUrl: variant.sourceUrl,
      durationLabel: result.durationLabel,
      updatedAt: result.updatedAt,
      summary: variant.summary,
      metadata: result.metadata
    };
  }

  function handleRequestError(error: unknown, fallback: string) {
    if (isUnauthorizedError(error)) {
      clearAccessKey();
      setUnlocked(false);
      setRole(undefined);
      setAdminUnlocked(false);
      setPlayback(undefined);
      setJob(undefined);
      setAsset(undefined);
      return;
    }

    setError(errorMessage(error, fallback));
  }

  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setResults([]);
      setError("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const response = await searchAssets(normalizedQuery);
      setResults(response.results);
      setActiveTab("library");
    } catch (searchError) {
      handleRequestError(searchError, "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function selectResult(result: ResultWithCache, variant: MediaVariant) {
    setLoading(true);
    setError("");
    setPlayback(undefined);
    try {
      const target = variantToResult(result, variant);
      const response = await ensureCache(target);
      setJob(response.job);
      setAsset(response.asset);
      if (response.asset.status === "ready") {
        await openPlayer(response.asset.assetKey);
      }
      await runSearch();
    } catch (cacheError) {
      handleRequestError(cacheError, "Cache request failed.");
    } finally {
      setLoading(false);
    }
  }

  function rememberPlayback(response: PlaybackResponse) {
    const next = [
      {
        assetKey: response.assetKey,
        title: response.title,
        playedAt: new Date().toISOString(),
        contentType: response.media?.contentType,
        contentLength: response.media?.contentLength
      },
      ...history.filter((item) => item.assetKey !== response.assetKey)
    ].slice(0, 20);
    setHistory(next);
    writeJsonStorage(historyStorageKey, next);
  }

  async function openPlayer(assetKey = asset?.assetKey) {
    if (!assetKey) {
      return;
    }

    try {
      const response = await getPlayback(assetKey);
      setPlayback(response);
      rememberPlayback(response);
    } catch (playbackError) {
      handleRequestError(playbackError, "Playback is not ready.");
    }
  }

  function clearHistory() {
    setHistory([]);
    writeJsonStorage(historyStorageKey, []);
  }

  function applyAuth(auth: AuthCheckResponse) {
    setRole(auth.role);
    setAdminUnlocked(auth.role === "admin");
  }

  async function refreshMemberCodes() {
    if (!adminUnlocked) {
      return;
    }

    try {
      const response = await listMemberCodes();
      setMemberCodes(response.codes);
      setAdminError("");
    } catch (adminListError) {
      setAdminError(errorMessage(adminListError, "Could not load member codes."));
    }
  }

  async function unlockAdmin() {
    const candidate = adminKeyInput.trim();
    if (!candidate) {
      setAdminError("Enter an administrator key.");
      return;
    }

    const previousKey = getAccessKey();
    setAdminLoading(true);
    setAdminError("");
    setAccessKey(candidate);
    try {
      const auth = await checkAccess();
      if (auth.role !== "admin") {
        setAccessKey(previousKey);
        setAdminError("This key is valid, but it is not an administrator key.");
        return;
      }

      applyAuth(auth);
      setAdminKeyInput("");
      const response = await listMemberCodes();
      setMemberCodes(response.codes);
    } catch (adminAccessError) {
      setAccessKey(previousKey);
      setAdminError(errorMessage(adminAccessError, "Admin key did not match."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function generateMemberCode() {
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await createMemberAccessCode({
        name: memberName.trim() || "Family member",
        days: Number.isFinite(memberDays) && memberDays > 0 ? memberDays : 30
      });
      setMemberCodes([response.code, ...memberCodes.filter((code) => code.id !== response.code.id)]);
      setMemberName("");
      setMemberDays(30);
    } catch (generateError) {
      setAdminError(errorMessage(generateError, "Could not generate member code."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function revokeMemberCode(id: string) {
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await revokeMemberAccessCode(id);
      setMemberCodes(memberCodes.map((code) => (
        code.id === id
          ? { ...response.code, code: code.code }
          : code
      )));
    } catch (revokeError) {
      setAdminError(errorMessage(revokeError, "Could not revoke member code."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function copyMemberCode(code: string) {
    await navigator.clipboard?.writeText(code);
  }

  useEffect(() => {
    if (!job || job.status === "ready" || job.status === "failed") {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const response = await getCacheStatus(job.id);
        setJob(response.job);
        setAsset(response.asset);
        if (response.job.status === "ready" || response.job.status === "failed") {
          window.clearInterval(timer);
          await runSearch();
        }
      } catch (statusError) {
        handleRequestError(statusError, "Status refresh failed.");
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [job?.id, job?.status]);

  useEffect(() => {
    if (!unlocked || role) {
      return;
    }

    checkAccess()
      .then((auth) => {
        applyAuth(auth);
      })
      .catch((authError) => {
        handleRequestError(authError, "Access key did not match.");
      });
  }, [unlocked, role]);

  useEffect(() => {
    if (activeTab === "admin" && adminUnlocked) {
      void refreshMemberCodes();
    }
  }, [activeTab, adminUnlocked]);

  if (!unlocked) {
    return <AccessGate onUnlock={(auth) => {
      setUnlocked(true);
      applyAuth(auth);
    }} />;
  }

  if (playback) {
    return <Player playback={playback} onClose={() => setPlayback(undefined)} />;
  }

  return (
    <main className="min-h-screen px-5 py-6 md:px-8">
      <div className="mx-auto grid max-w-7xl gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-emerald-300">Private household cinema</p>
            <h1 className="mt-1 text-3xl font-semibold text-slate-50">WW Family Cinema</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{results.length} found</Badge>
            <Badge variant="default">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {readyCount} ready
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                clearAccessKey();
                setUnlocked(false);
                setRole(undefined);
                setAdminUnlocked(false);
                setMemberCodes([]);
              }}
            >
              Lock
            </Button>
          </div>
        </header>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as AppTab)}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <TabsList>
                  <TabsTrigger value="library">
                    <Film className="h-4 w-4" />
                    Library
                  </TabsTrigger>
                  <TabsTrigger value="cached">
                    <Database className="h-4 w-4" />
                    Cached
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    <History className="h-4 w-4" />
                    History
                  </TabsTrigger>
                  <TabsTrigger value="admin">
                    <ShieldCheck className="h-4 w-4" />
                    Admin
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="library">
                <div className="grid gap-5">
                  <Card>
                    <CardContent className="p-4">
                      <form className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]" onSubmit={runSearch}>
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                          <Input
                            className="pl-9"
                            value={query}
                            onChange={(event) => setQuery(event.target.value)}
                            placeholder="Search collection"
                          />
                        </div>
                        <Button type="submit" disabled={loading}>
                          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                          Search
                        </Button>
                      </form>
                      {error ? <p className="mt-3 text-sm font-semibold text-rose-300">{error}</p> : null}
                    </CardContent>
                  </Card>

                  <div className="grid gap-4">
                    {results.length === 0 ? (
                      <EmptyState icon={<Film className="h-5 w-5" />} title="No titles loaded" />
                    ) : (
                      results.map((result) => (
                        <MovieCard
                          key={result.assetKey}
                          result={result}
                          loading={loading}
                          onSelect={(selectedResult, variant) => void selectResult(selectedResult, variant)}
                        />
                      ))
                    )}
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="cached">
                <CachedShelf cachedItems={cachedItems} onOpen={(assetKey) => void openPlayer(assetKey)} />
              </TabsContent>

              <TabsContent value="history">
                <HistoryPanel items={history} onClear={clearHistory} />
              </TabsContent>

              <TabsContent value="admin">
                <AdminPanel
                  adminUnlocked={adminUnlocked}
                  adminError={adminError}
                  adminLoading={adminLoading}
                  adminKeyInput={adminKeyInput}
                  memberName={memberName}
                  memberDays={memberDays}
                  memberCodes={memberCodes}
                  setAdminKeyInput={setAdminKeyInput}
                  setMemberName={setMemberName}
                  setMemberDays={setMemberDays}
                  onUnlock={unlockAdmin}
                  onGenerate={generateMemberCode}
                  onCopy={(code) => void copyMemberCode(code)}
                  onRevoke={revokeMemberCode}
                />
              </TabsContent>
            </Tabs>
          </div>

          <StatusPanel
            job={job}
            asset={asset}
            playback={playback}
            onOpenPlayer={() => void openPlayer()}
          />
        </section>
      </div>
    </main>
  );
}
