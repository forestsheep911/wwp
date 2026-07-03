import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  BarChart3,
  CalendarDays,
  Clapperboard,
  ExternalLink,
  Flame,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Ticket
} from "lucide-react";
import type { NowPlayingMovie, NowPlayingResponse, UpcomingMovie } from "@wwpdw/shared";
import { errorMessage, getNowPlaying } from "../../api";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { formatDateTime } from "../format";
import { copy } from "../i18n";
import { EmptyState } from "./EmptyState";

function percentNumber(value?: string) {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value.replace("%", ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatCount(value?: number) {
  if (!value || !Number.isFinite(value)) {
    return copy.common.unknown;
  }

  if (value >= 10000) {
    return `${(value / 10000).toFixed(value >= 100000 ? 0 : 1)}万`;
  }

  return value.toLocaleString("zh-CN");
}

function compactCount(value?: number) {
  return value ? formatCount(value) : copy.common.unknown;
}

function doubanRatingNumber(movie: NowPlayingMovie) {
  const parsed = Number(movie.douban?.rating);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cacheLabel(status: NowPlayingResponse["cache"]["status"]) {
  switch (status) {
    case "hit":
      return copy.nowPlaying.cacheHit;
    case "stale":
      return copy.nowPlaying.cacheStale;
    default:
      return copy.nowPlaying.cacheRefresh;
  }
}

function recommendationTags(movie: NowPlayingMovie) {
  const boxRate = percentNumber(movie.boxRate);
  const showRate = percentNumber(movie.showCountRate);
  const doubanRating = doubanRatingNumber(movie);
  const tags: string[] = [];

  if ((doubanRating ?? 0) >= 7.5) {
    tags.push(`${copy.nowPlaying.doubanRating} ${doubanRating!.toFixed(1)}`);
  }
  if ((boxRate ?? 0) >= 20) {
    tags.push(copy.nowPlaying.recommendation.heat);
  }
  if (boxRate !== undefined && showRate !== undefined && boxRate > showRate + 3) {
    tags.push(copy.nowPlaying.recommendation.efficient);
  }
  if (movie.releaseInfo?.includes("首日") || movie.releaseInfo?.includes("上映2天")) {
    tags.push(copy.nowPlaying.recommendation.newRelease);
  }

  return tags.length > 0 ? tags : [copy.nowPlaying.recommendation.stable];
}

function isBigScreenCandidate(movie: NowPlayingMovie) {
  const boxRate = percentNumber(movie.boxRate) ?? 0;
  const showRate = percentNumber(movie.showCountRate) ?? 0;
  const doubanRating = doubanRatingNumber(movie) ?? 0;
  return movie.rank <= 3 || boxRate >= 8 || boxRate > showRate + 3 || doubanRating >= 7.8;
}

function isCautionCandidate(movie: NowPlayingMovie) {
  const boxRate = percentNumber(movie.boxRate);
  const showRate = percentNumber(movie.showCountRate);
  const seatRate = percentNumber(movie.avgSeatView);
  const doubanRating = doubanRatingNumber(movie);
  const voteCount = movie.douban?.voteCount ?? 0;
  if (boxRate === undefined || showRate === undefined) {
    return doubanRating !== undefined && doubanRating < 6.5 && voteCount >= 500;
  }

  return movie.rank > 3 && (
    showRate > boxRate + 2 ||
    (seatRate ?? 0) < 0.8 ||
    (doubanRating !== undefined && doubanRating < 6.5 && voteCount >= 500)
  );
}

export function NowPlayingPanel() {
  const [data, setData] = useState<NowPlayingResponse | undefined>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  async function loadNowPlaying(options: { refresh?: boolean } = {}) {
    if (options.refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }

    try {
      const response = await getNowPlaying(options);
      setData(response);
      setError("");
    } catch (loadError) {
      setError(errorMessage(loadError, copy.fallbackErrors.nowPlaying));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadNowPlaying();
  }, []);

  const movies = data?.movies ?? [];
  const leaders = useMemo(() => movies.slice(0, 3), [movies]);
  const bigScreenMovies = useMemo(
    () => movies.filter(isBigScreenCandidate).slice(0, 4),
    [movies]
  );
  const cautionMovies = useMemo(
    () => movies.filter(isCautionCandidate).slice(0, 4),
    [movies]
  );
  const upcomingMovies = useMemo(
    () => [...(data?.upcomingMovies ?? [])].sort((left, right) => (right.wishCount ?? 0) - (left.wishCount ?? 0)).slice(0, 6),
    [data?.upcomingMovies]
  );

  return (
    <section className="grid gap-4">
      <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Flame className="h-5 w-5 text-amber-300" />
              <h2 className="text-xl font-semibold text-slate-50">{copy.nowPlaying.title}</h2>
              {data ? (
                <Badge variant={data.cache.status === "stale" ? "warning" : "secondary"}>
                  {cacheLabel(data.cache.status)}
                </Badge>
              ) : null}
            </div>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">{copy.nowPlaying.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadNowPlaying({ refresh: true })}
              disabled={loading || refreshing}
              title={copy.nowPlaying.refresh}
            >
              {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {refreshing ? copy.nowPlaying.refreshing : copy.common.refresh}
            </Button>
            <Button asChild type="button" variant="outline" size="sm">
              <a href={data?.sourceUrl ?? "https://piaofang.maoyan.com/dashboard/movie"} rel="noreferrer" target="_blank">
                <ExternalLink className="h-4 w-4" />
                {copy.nowPlaying.source}
              </a>
            </Button>
            <Button asChild type="button" variant="outline" size="sm">
              <a href={data?.douban?.sourceUrl ?? "https://movie.douban.com/cinema/nowplaying/shanghai/"} rel="noreferrer" target="_blank">
                <ExternalLink className="h-4 w-4" />
                {copy.nowPlaying.doubanSource}
              </a>
            </Button>
          </div>
        </div>

        {data ? (
          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-slate-400">
            {data.observedAt ? <Badge variant="muted">{copy.nowPlaying.observedAt(formatDateTime(data.observedAt))}</Badge> : null}
            <Badge variant="muted">{copy.nowPlaying.fetchedAt(formatDateTime(data.fetchedAt))}</Badge>
            {data.douban ? <Badge variant="muted">{copy.nowPlaying.doubanSource} {data.douban.nowPlayingCount}</Badge> : null}
            <Badge variant="muted">{copy.nowPlaying.sourceHint}</Badge>
          </div>
        ) : null}

        {data?.degraded ? (
          <div className="mt-4 rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-semibold text-amber-100">
            {copy.nowPlaying.stale}
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-200">
          {error}
        </div>
      ) : null}

      {loading && movies.length === 0 ? (
        <div className="flex min-h-48 items-center justify-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 text-sm font-semibold text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          {copy.nowPlaying.loading}
        </div>
      ) : movies.length === 0 ? (
        <EmptyState icon={<BarChart3 className="h-5 w-5" />} title={copy.nowPlaying.empty} />
      ) : (
        <div className="grid gap-3">
          <div className="grid gap-3 md:grid-cols-4">
            <GuideCard
              icon={<Flame className="h-4 w-4" />}
              title={copy.nowPlaying.guide.current.title}
              detail={copy.nowPlaying.guide.current.detail}
              value={`${movies.length}`}
              items={movies.slice(0, 3).map((movie) => movie.title)}
              href="#now-playing-current"
            />
            <GuideCard
              icon={<Clapperboard className="h-4 w-4" />}
              title={copy.nowPlaying.guide.bigScreen.title}
              detail={copy.nowPlaying.guide.bigScreen.detail}
              value={`${bigScreenMovies.length}`}
              items={bigScreenMovies.slice(0, 3).map((movie) => movie.title)}
              href="#now-playing-big-screen"
            />
            <GuideCard
              icon={<ShieldAlert className="h-4 w-4" />}
              title={copy.nowPlaying.guide.caution.title}
              detail={copy.nowPlaying.guide.caution.detail}
              value={`${cautionMovies.length}`}
              items={cautionMovies.length > 0
                ? cautionMovies.slice(0, 3).map((movie) => movie.title)
                : [copy.nowPlaying.noCaution]}
              href="#now-playing-caution"
            />
            <GuideCard
              icon={<CalendarDays className="h-4 w-4" />}
              title={copy.nowPlaying.guide.upcoming.title}
              detail={copy.nowPlaying.guide.upcoming.detail}
              value={`${data?.upcomingMovies?.length ?? 0}`}
              items={upcomingMovies.slice(0, 3).map((movie) => movie.title)}
              href="#now-playing-upcoming"
            />
          </div>

          {leaders.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-3">
              {leaders.map((movie) => (
                <TopMovieCard key={`leader-${movie.id}`} movie={movie} />
              ))}
            </div>
          ) : null}

          <GuideSection id="now-playing-big-screen" title={copy.nowPlaying.sections.bigScreen} icon={<Sparkles className="h-4 w-4" />}>
            <div className="grid gap-3 lg:grid-cols-2">
              {bigScreenMovies.map((movie) => (
                <CompactDecisionCard key={`big-screen-${movie.id}`} movie={movie} tone="positive" />
              ))}
            </div>
          </GuideSection>

          <GuideSection id="now-playing-caution" title={copy.nowPlaying.sections.caution} icon={<ShieldAlert className="h-4 w-4" />}>
            {cautionMovies.length > 0 ? (
              <div className="grid gap-3 lg:grid-cols-2">
                {cautionMovies.map((movie) => (
                  <CompactDecisionCard key={`caution-${movie.id}`} movie={movie} tone="caution" />
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-slate-800 bg-slate-950/80 px-4 py-3 text-sm font-semibold text-slate-400">
                {copy.nowPlaying.noCaution}
              </div>
            )}
          </GuideSection>

          <GuideSection id="now-playing-upcoming" title={copy.nowPlaying.sections.upcoming} icon={<CalendarDays className="h-4 w-4" />}>
            <div className="grid gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/80 p-4">
                <p className="max-w-3xl text-sm leading-6 text-slate-400">{copy.nowPlaying.upcomingBody}</p>
                <Button asChild type="button" variant="outline" size="sm">
                  <a href={data?.douban?.laterSourceUrl ?? "https://movie.douban.com/cinema/later/shanghai/"} rel="noreferrer" target="_blank">
                    <ExternalLink className="h-4 w-4" />
                    {copy.nowPlaying.doubanSource}
                  </a>
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {upcomingMovies.map((movie) => (
                  <UpcomingMovieCard key={movie.id} movie={movie} />
                ))}
              </div>
            </div>
          </GuideSection>

          <GuideSection id="now-playing-current" title={copy.nowPlaying.sections.current} icon={<BarChart3 className="h-4 w-4" />}>
            <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-950/70">
              <div className="grid gap-0">
                {movies.map((movie) => (
                  <MovieObservationRow key={movie.id} movie={movie} />
                ))}
              </div>
            </div>
          </GuideSection>
        </div>
      )}
    </section>
  );
}

function GuideCard({
  detail,
  href,
  icon,
  items,
  title,
  value
}: {
  detail: string;
  href?: string;
  icon: ReactNode;
  items?: string[];
  title: string;
  value: string;
}) {
  const content = (
    <div className="grid h-full min-h-36 content-between gap-3 rounded-lg border border-slate-800 bg-slate-950/80 p-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-950">
      <div className="flex items-center justify-between gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-md border border-amber-300/20 bg-amber-300/10 text-amber-200">
          {icon}
        </span>
        <span className="text-xl font-bold text-slate-100">{value}</span>
      </div>
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold text-slate-50">{title}</h3>
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{detail}</p>
      </div>
      {items && items.length > 0 ? (
        <div className="grid gap-1">
          {items.map((item) => (
            <p className="truncate text-xs font-semibold text-slate-300" key={`${title}-${item}`}>
              {item}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );

  return href ? (
    <a href={href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400">
      {content}
    </a>
  ) : content;
}

function GuideSection({ children, icon, id, title }: { children: ReactNode; icon: ReactNode; id: string; title: string }) {
  return (
    <section className="scroll-mt-24 grid gap-3" id={id}>
      <div className="flex items-center gap-2">
        <span className="text-emerald-300">{icon}</span>
        <h3 className="text-sm font-semibold text-slate-200">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function CompactDecisionCard({ movie, tone }: { movie: NowPlayingMovie; tone: "positive" | "caution" }) {
  const boxRate = percentNumber(movie.boxRate);
  const showRate = percentNumber(movie.showCountRate);
  const gap = boxRate !== undefined && showRate !== undefined ? boxRate - showRate : undefined;
  const toneClass = tone === "positive"
    ? "border-emerald-400/20 bg-emerald-400/5"
    : "border-amber-400/20 bg-amber-400/5";

  return (
    <article className={`grid gap-3 rounded-lg border p-4 ${toneClass}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={movie.rank <= 3 ? "warning" : "secondary"}>{copy.nowPlaying.rank(movie.rank)}</Badge>
            {movie.releaseInfo ? <Badge variant="muted">{movie.releaseInfo}</Badge> : null}
          </div>
          <h4 className="mt-2 truncate text-base font-semibold text-slate-50">{movie.title}</h4>
        </div>
        <Badge variant={tone === "positive" ? "default" : "warning"}>
          {gap === undefined ? copy.common.unknown : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}%`}
        </Badge>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Metric label={copy.nowPlaying.boxRate} value={movie.boxRate ?? copy.common.unknown} />
        <Metric label={copy.nowPlaying.showRate} value={movie.showCountRate ?? copy.common.unknown} />
        <Metric label={copy.nowPlaying.doubanRating} value={movie.douban?.rating ?? copy.nowPlaying.noRating} />
      </div>
      <div className="flex flex-wrap gap-2">
        {movie.douban?.voteCount ? (
          <Badge variant="muted">{copy.nowPlaying.doubanVotes(compactCount(movie.douban.voteCount))}</Badge>
        ) : null}
        <Button asChild type="button" variant="outline" size="sm">
          <a href={movie.sourceUrl} rel="noreferrer" target="_blank">
            <BarChart3 className="h-4 w-4" />
            {copy.nowPlaying.proData}
          </a>
        </Button>
        {movie.ticketUrl ? (
          <Button asChild type="button" variant="secondary" size="sm">
            <a href={movie.ticketUrl} rel="noreferrer" target="_blank">
              <Ticket className="h-4 w-4" />
              {copy.nowPlaying.ticket}
            </a>
          </Button>
        ) : null}
        {movie.douban ? (
          <Button asChild type="button" variant="outline" size="sm">
            <a href={movie.douban.url} rel="noreferrer" target="_blank">
              <ExternalLink className="h-4 w-4" />
              {copy.nowPlaying.doubanRating}
            </a>
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function UpcomingMovieCard({ movie }: { movie: UpcomingMovie }) {
  return (
    <article className="grid min-h-36 content-between gap-3 rounded-lg border border-slate-800 bg-slate-950/80 p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">{movie.releaseDate}</Badge>
          {movie.region ? <Badge variant="muted">{movie.region}</Badge> : null}
        </div>
        <h4 className="mt-2 line-clamp-2 text-base font-semibold leading-tight text-slate-50">{movie.title}</h4>
        {movie.genres.length > 0 ? (
          <p className="mt-2 truncate text-xs font-semibold text-slate-500">{movie.genres.join(" / ")}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="secondary">{copy.nowPlaying.doubanWish(compactCount(movie.wishCount))}</Badge>
        <div className="flex flex-wrap gap-2">
          {movie.trailerUrl ? (
            <Button asChild type="button" variant="outline" size="sm">
              <a href={movie.trailerUrl} rel="noreferrer" target="_blank">
                <ExternalLink className="h-4 w-4" />
                预告片
              </a>
            </Button>
          ) : null}
          <Button asChild type="button" variant="outline" size="sm">
            <a href={movie.sourceUrl} rel="noreferrer" target="_blank">
              <ExternalLink className="h-4 w-4" />
              {copy.nowPlaying.doubanRating}
            </a>
          </Button>
        </div>
      </div>
    </article>
  );
}

function TopMovieCard({ movie }: { movie: NowPlayingMovie }) {
  const tags = recommendationTags(movie).slice(0, 2);

  return (
    <article className="grid min-h-40 content-between gap-4 rounded-lg border border-slate-800 bg-slate-950 p-4">
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-3">
          <Badge variant="warning">{copy.nowPlaying.rank(movie.rank)}</Badge>
          <span className="text-xs font-semibold text-slate-500">{movie.releaseInfo}</span>
        </div>
        <h3 className="mt-3 line-clamp-2 text-lg font-semibold leading-tight text-slate-50">{movie.title}</h3>
      </div>
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <Metric label={copy.nowPlaying.totalBox} value={movie.totalBoxOffice ?? copy.common.unknown} />
          <Metric label={copy.nowPlaying.boxRate} value={movie.boxRate ?? copy.common.unknown} />
          <Metric label={copy.nowPlaying.doubanRating} value={movie.douban?.rating ?? copy.nowPlaying.noRating} />
        </div>
        <div className="flex flex-wrap gap-2">
          {movie.douban?.voteCount ? <Badge variant="muted">{copy.nowPlaying.doubanVotes(compactCount(movie.douban.voteCount))}</Badge> : null}
          {tags.map((tag) => <Badge key={`${movie.id}-${tag}`} variant="secondary">{tag}</Badge>)}
        </div>
      </div>
    </article>
  );
}

function MovieObservationRow({ movie }: { movie: NowPlayingMovie }) {
  const boxRate = percentNumber(movie.boxRate);
  const showRate = percentNumber(movie.showCountRate);
  const performanceGap = boxRate !== undefined && showRate !== undefined ? boxRate - showRate : undefined;
  const tags = recommendationTags(movie);

  return (
    <article className="grid gap-4 border-b border-slate-900 px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1.2fr)_minmax(360px,1fr)_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={movie.rank <= 3 ? "warning" : "secondary"}>{copy.nowPlaying.rank(movie.rank)}</Badge>
          {movie.releaseInfo ? <Badge variant="muted">{movie.releaseInfo}</Badge> : null}
          {tags.map((tag) => <Badge key={`${movie.id}-row-${tag}`} variant="secondary">{tag}</Badge>)}
        </div>
        <h3 className="mt-2 truncate text-base font-semibold text-slate-50">{movie.title}</h3>
        <p className="mt-1 text-xs font-semibold text-slate-500">
          {copy.nowPlaying.totalBox} {movie.totalBoxOffice ?? copy.common.unknown}
          {movie.douban?.rating ? ` / ${copy.nowPlaying.doubanRating} ${movie.douban.rating}` : ""}
        </p>
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label={copy.nowPlaying.boxRate} value={movie.boxRate ?? copy.common.unknown} />
          <Metric label={copy.nowPlaying.showRate} value={movie.showCountRate ?? copy.common.unknown} />
          <Metric label={copy.nowPlaying.doubanRating} value={movie.douban?.rating ?? copy.nowPlaying.noRating} />
          <Metric label={copy.nowPlaying.avgShow} value={movie.avgShowView ?? copy.common.unknown} />
        </div>
        {performanceGap !== undefined ? (
          <div className="h-2 overflow-hidden rounded-full bg-slate-900">
            <div
              className={`h-full rounded-full ${performanceGap >= 0 ? "bg-emerald-400" : "bg-amber-300"}`}
              style={{ width: `${Math.max(8, Math.min(100, Math.abs(performanceGap) * 4 + 12))}%` }}
              title={`${copy.nowPlaying.boxRate} ${movie.boxRate} / ${copy.nowPlaying.showRate} ${movie.showCountRate}`}
            />
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 lg:justify-end">
        <Badge variant="muted">{copy.nowPlaying.showCount} {formatCount(movie.showCount)}</Badge>
        {movie.douban?.voteCount ? <Badge variant="muted">{copy.nowPlaying.doubanVotes(compactCount(movie.douban.voteCount))}</Badge> : null}
        <Button asChild type="button" variant="outline" size="sm">
          <a href={movie.sourceUrl} rel="noreferrer" target="_blank">
            <BarChart3 className="h-4 w-4" />
            {copy.nowPlaying.proData}
          </a>
        </Button>
        {movie.ticketUrl ? (
          <Button asChild type="button" variant="secondary" size="sm">
            <a href={movie.ticketUrl} rel="noreferrer" target="_blank">
              <Ticket className="h-4 w-4" />
              {copy.nowPlaying.ticket}
            </a>
          </Button>
        ) : null}
        {movie.douban ? (
          <Button asChild type="button" variant="outline" size="sm">
            <a href={movie.douban.url} rel="noreferrer" target="_blank">
              <ExternalLink className="h-4 w-4" />
              {copy.nowPlaying.doubanRating}
            </a>
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-slate-800 bg-slate-950/80 px-3 py-2">
      <div className="truncate text-[11px] font-semibold text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-bold text-slate-100">{value}</div>
    </div>
  );
}
