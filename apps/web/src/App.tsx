import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  CacheAsset,
  CacheJob,
  PlaybackResponse,
  SearchResult
} from "@wwpdw/shared";
import {
  ensureCache,
  getCacheStatus,
  getPlayback,
  searchAssets
} from "./api";

type ResultWithCache = SearchResult & { cache?: CacheAsset };

const accessCode = import.meta.env.VITE_ACCESS_CODE ?? "family";
const sessionKey = "wwpdw-access-ok";

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

function AccessGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (value.trim() === accessCode) {
      sessionStorage.setItem(sessionKey, "1");
      onUnlock();
      return;
    }
    setError("Access key did not match.");
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
        <button className="primary" type="submit">
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
      <p className="expiry">Signed URL expires {formatDate(playback.expiresAt)}</p>
    </section>
  );
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(sessionKey) === "1");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultWithCache[]>([]);
  const [job, setJob] = useState<CacheJob | undefined>();
  const [asset, setAsset] = useState<CacheAsset | undefined>();
  const [playback, setPlayback] = useState<PlaybackResponse | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const readyCount = useMemo(
    () => results.filter((item) => item.cache?.status === "ready").length,
    [results]
  );

  async function runSearch(event?: FormEvent) {
    event?.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await searchAssets(query);
      setResults(response.results);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "Search failed.");
    } finally {
      setLoading(false);
    }
  }

  async function selectResult(result: ResultWithCache) {
    setLoading(true);
    setError("");
    setPlayback(undefined);
    try {
      const response = await ensureCache(result.assetKey);
      setJob(response.job);
      setAsset(response.asset);
      if (response.asset.status === "ready") {
        await openPlayer(response.asset.assetKey);
      }
      await runSearch();
    } catch (cacheError) {
      setError(cacheError instanceof Error ? cacheError.message : "Cache request failed.");
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
      setError(playbackError instanceof Error ? playbackError.message : "Playback is not ready.");
    }
  }

  useEffect(() => {
    if (unlocked) {
      void runSearch();
    }
  }, [unlocked]);

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
        setError(statusError instanceof Error ? statusError.message : "Status refresh failed.");
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
            {results.map((result) => (
              <article className="result-row" key={result.assetKey}>
                <button type="button" onClick={() => void selectResult(result)}>
                  <span className="result-title">{result.title}</span>
                  <span className="result-meta">
                    {result.source} / {result.durationLabel} / {formatDate(result.updatedAt)}
                  </span>
                  <span className="result-summary">{result.summary}</span>
                </button>
                <span className={`pill pill-${cacheLabel(result.cache).replace(" ", "-")}`}>
                  {cacheLabel(result.cache)}
                </span>
              </article>
            ))}
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
