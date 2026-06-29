import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  CacheAsset,
  CacheJob,
  MediaDiagnostics,
  MediaVariant,
  PlaybackResponse,
  SearchResult
} from "@wwpdw/shared";
import {
  checkAccess,
  clearAccessKey,
  ensureCache,
  errorMessage,
  getCacheStatus,
  getAccessKey,
  getPlayback,
  isUnauthorizedError,
  searchAssets,
  setAccessKey
} from "./api";

type ResultWithCache = SearchResult & { cache?: CacheAsset };

function formatDate(value?: string) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function cacheLabel(asset?: CacheAsset) {
  if (!asset) {
    return "not cached";
  }

  if (asset.status === "ready") {
    return "ready";
  }

  return asset.status;
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

function MediaDiagnosticsView({ media }: { media?: MediaDiagnostics }) {
  if (!media) {
    return null;
  }

  return (
    <section className="diagnostics">
      <p className="eyebrow">Media</p>
      <dl className="diagnostics-grid">
        <div>
          <dt>Type</dt>
          <dd>{media.contentType ?? "unknown"}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatBytes(media.contentLength)}</dd>
        </div>
        <div>
          <dt>Range</dt>
          <dd>{booleanLabel(media.rangeSupported)}</dd>
        </div>
        <div>
          <dt>MP4</dt>
          <dd>{mp4StatusLabel(media)}</dd>
        </div>
        {media.mp4 ? (
          <div>
            <dt>Boxes</dt>
            <dd>
              moov {offsetLabel(media.mp4.moovOffset)} / mdat {offsetLabel(media.mp4.mdatOffset)}
            </dd>
          </div>
        ) : null}
        {media.blobName ? (
          <div className="diagnostics-wide">
            <dt>Blob</dt>
            <dd className="mono">{media.blobName}</dd>
          </div>
        ) : null}
      </dl>
      {media.mp4?.notes ? <p className="message">{media.mp4.notes}</p> : null}
    </section>
  );
}

function AccessGate({ onUnlock }: { onUnlock: () => void }) {
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
      await checkAccess();
      onUnlock();
      return;
    } catch (accessError) {
      clearAccessKey();
      setError(errorMessage(accessError, "Access key did not match."));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="gate">
      <form className="gate-panel" onSubmit={submit}>
        <div>
          <p className="eyebrow">Private cache</p>
          <h1>WW Player</h1>
        </div>
        <label className="field">
          <span>Access key</span>
          <input
            autoFocus
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
            type="password"
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary" type="submit" disabled={loading}>
          Enter
        </button>
      </form>
    </main>
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
      <aside className="status-panel">
        <p className="eyebrow">Cache</p>
        <h2>No active item</h2>
      </aside>
    );
  }

  return (
    <aside className="status-panel">
      <p className="eyebrow">Cache</p>
      <h2>{job.title}</h2>
      <div className="progress-track" aria-label={`Cache progress ${job.progress}%`}>
        <div className="progress-fill" style={{ width: `${job.progress}%` }} />
      </div>
      <div className="status-row">
        <span>{job.status}</span>
        <strong>{job.progress}%</strong>
      </div>
      <p className="message">{job.message}</p>
      {job.resolve ? (
        <p className="message">
          Resolver: {job.resolve.layer} / {job.resolve.kind}
        </p>
      ) : null}
      {job.error ? <p className="error">{job.error}</p> : null}
      {asset.expiresAt ? (
        <p className="expiry">Expires {formatDate(asset.expiresAt)}</p>
      ) : null}
      <MediaDiagnosticsView media={asset.media} />
      {asset.status === "ready" ? (
        <button className="primary" type="button" onClick={onOpenPlayer}>
          {playback ? "Open player" : "Prepare player"}
        </button>
      ) : null}
    </aside>
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
    <section className="player-view">
      <div className="player-topbar">
        <button className="secondary" type="button" onClick={onClose}>
          Back
        </button>
        <div>
          <p className="eyebrow">Ready</p>
          <h2>{playback.title}</h2>
        </div>
      </div>
      {isMock ? (
        <div className="mock-player">
          <div className="mock-play">Play</div>
          <p>{playback.assetKey}</p>
        </div>
      ) : (
        <video className="video-player" src={playback.playbackUrl} controls />
      )}
      <MediaDiagnosticsView media={playback.media} />
      <p className="expiry">Signed URL expires {formatDate(playback.expiresAt)}</p>
    </section>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => Boolean(getAccessKey()));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultWithCache[]>([]);
  const [job, setJob] = useState<CacheJob | undefined>();
  const [asset, setAsset] = useState<CacheAsset | undefined>();
  const [playback, setPlayback] = useState<PlaybackResponse | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const readyCount = useMemo(
    () =>
      results.reduce((count, item) => {
        const resultReady = item.cache?.status === "ready" ? 1 : 0;
        const variantReady = item.variants?.filter((variant) => variant.cache?.status === "ready").length ?? 0;
        return count + resultReady + variantReady;
      }, 0),
    [results]
  );

  function variantToResult(result: SearchResult, variant: MediaVariant): SearchResult {
    return {
      assetKey: variant.assetKey,
      title: `${result.title} / ${variant.label}`,
      source: result.source,
      sourceUrl: variant.sourceUrl,
      durationLabel: result.durationLabel,
      updatedAt: result.updatedAt,
      summary: variant.summary
    };
  }

  function handleRequestError(error: unknown, fallback: string) {
    if (isUnauthorizedError(error)) {
      clearAccessKey();
      setUnlocked(false);
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
    } catch (searchError) {
      handleRequestError(searchError, "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function selectResult(result: ResultWithCache, variant?: MediaVariant) {
    setLoading(true);
    setError("");
    setPlayback(undefined);
    try {
      const target = variant ? variantToResult(result, variant) : result;
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

  async function openPlayer(assetKey = asset?.assetKey) {
    if (!assetKey) {
      return;
    }

    try {
      const response = await getPlayback(assetKey);
      setPlayback(response);
    } catch (playbackError) {
      handleRequestError(playbackError, "Playback is not ready.");
    }
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

  if (!unlocked) {
    return <AccessGate onUnlock={() => setUnlocked(true)} />;
  }

  if (playback) {
    return <Player playback={playback} onClose={() => setPlayback(undefined)} />;
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">Private cache</p>
          <h1>WW Player</h1>
        </div>
        <div className="metrics">
          <span>{results.length} found</span>
          <strong>{readyCount} ready</strong>
        </div>
      </header>

      <section className="workspace">
        <div className="search-surface">
          <form className="search-bar" onSubmit={runSearch}>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search collection"
            />
            <button className="primary" type="submit" disabled={loading}>
              Search
            </button>
          </form>

          {error ? <p className="error">{error}</p> : null}

          <div className="results-list">
            {results.map((result) => {
              const variants = result.variants ?? [];
              return (
                <article className="result-row" key={result.assetKey}>
                  <div className="result-content">
                    <span className="result-title">{result.title}</span>
                    <span className="result-meta">
                      {result.source} / {result.durationLabel} / {formatDate(result.updatedAt)}
                    </span>
                    <span className="result-summary">{result.summary}</span>
                  </div>
                  <div className="variant-actions">
                    {variants.length > 0 ? (
                      variants.map((variant) => (
                        <button
                          className="variant-button"
                          key={variant.assetKey}
                          type="button"
                          onClick={() => void selectResult(result, variant)}
                          disabled={loading}
                        >
                          <span>{variant.label}</span>
                          <strong className={`state-${cacheLabel(variant.cache).replace(" ", "-")}`}>
                            {cacheLabel(variant.cache)}
                          </strong>
                        </button>
                      ))
                    ) : (
                      <span className="empty-specs">No specs</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <StatusPanel
          job={job}
          asset={asset}
          playback={playback}
          onOpenPlayer={() => void openPlayer()}
        />
      </section>
    </main>
  );
}
