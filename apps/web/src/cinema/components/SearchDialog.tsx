import { entityPath } from "../public-identities";
import { followInternalLink } from "../internal-link";
import { readSession, writeSession } from "../session-state";
import { useEffect, useMemo, useRef, useState, type ReactNode, type FormEvent } from "react";
import { ArrowLeft, Film, Loader2, Search, UserRound } from "lucide-react";
import type { PublicPersonSummary, SearchResult } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { basicInfoLine, bestSummary, formatDate, metadataLine, titleInitial, visibleTags } from "../format";
import { genreBadgeClass } from "../genre-style";
import { copy } from "../i18n";
import type { ResultWithCache } from "../types";
import { PosterImage } from "./PosterImage";
import { createSearchSubmitGuard } from "../search-submit-guard";

interface SearchDialogProps {
  standalone?: boolean;
  scope: string;
  onScopeChange: (scope: string) => void;
  error: string;
  loading: boolean;
  open: boolean;
  query: string;
  submittedQuery?: string;
  results: ResultWithCache[];
  people: PublicPersonSummary[];
  onOpenChange: (open: boolean) => void;
  onQueryChange: (value: string) => void;
  onSearch: (event?: FormEvent<HTMLFormElement>) => void;
  onSelectResult: (result: ResultWithCache) => void;
  onSelectPerson: (personId: string) => void;
}

type SearchScope = "all" | "movie" | "tv" | "animation" | "ready";

const searchScopes: Array<{ id: SearchScope; label: string }> = [
  { id: "all", label: "全部" },
  { id: "movie", label: "电影" },
  { id: "tv", label: "剧集" },
  { id: "animation", label: "动画" },
  { id: "ready", label: "已可播放" }
];

export function SearchDialog({
  standalone = false,
  scope,
  onScopeChange: setScope,
  error,
  loading,
  open,
  query,
  submittedQuery,
  results,
  people,
  onOpenChange,
  onQueryChange,
  onSearch,
  onSelectResult,
  onSelectPerson
}: SearchDialogProps) {
  const normalizedQuery = submittedQuery?.trim() ?? "";
  const hasQuery = normalizedQuery.length > 0;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submitGuard = useRef(createSearchSubmitGuard());
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copyMessage, setCopyMessage] = useState("");
  const [activeAssetKey, setActiveAssetKey] = useState<string | undefined>(() => readSession<string | undefined>("search-active", undefined));
  const visibleResults = useMemo(
    () => results.filter((result) => resultMatchesScope(result, scope)),
    [results, scope]
  );
  const activeResult = useMemo(
    () => visibleResults.find((result) => result.assetKey === activeAssetKey) ?? visibleResults[0],
    [activeAssetKey, visibleResults]
  );

  useEffect(() => {
    setActiveAssetKey(current => visibleResults.some(result => result.assetKey === current) ? current : visibleResults[0]?.assetKey);
  }, [normalizedQuery, visibleResults]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!submitGuard.current.accept(query, loading)) return;
    onSearch(event);
    // Blur the input only; do not discard keyboard focus on the submit button.
    inputRef.current?.blur();
  }

  useEffect(() => {
    if (!open) submitGuard.current = createSearchSubmitGuard();
  }, [open]);

  useEffect(() => { if (open) requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = readSession("search-scroll", 0); }); }, [open, visibleResults.length]);
  useEffect(() => { writeSession("search-active", activeAssetKey); }, [activeAssetKey]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SearchSurface standalone={standalone}
        className="inset-0 h-[100dvh] max-h-[100dvh] w-full gap-0 overflow-hidden rounded-none border-0 p-0 sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto sm:h-[min(86vh,780px)] sm:w-[min(96vw,1040px)] sm:rounded-lg sm:border"
        hideCloseButton
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{copy.search.title}</DialogTitle>
          <DialogDescription>{copy.search.description}</DialogDescription>
        </DialogHeader>
        <form action="/" method="get" role="search" className="grid h-full min-h-0 grid-rows-[auto_auto_auto_minmax(0,1fr)]" onSubmit={submit}>
          <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950/95 px-2 pt-[env(safe-area-inset-top)] sm:gap-3 sm:px-4 sm:pt-0 sm:pr-14">
            <DialogClose type="button" className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-slate-300 active:bg-slate-800 sm:hidden">
              <ArrowLeft className="h-5 w-5" />
              <span className="sr-only">返回</span>
            </DialogClose>
            <Search className="h-5 w-5 shrink-0 text-slate-500" />
            <textarea
              ref={inputRef}
              rows={1}
              wrap="off"
              name="q"
              aria-label="搜索片名、导演或演员"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              className="block h-16 w-full min-w-0 resize-none overflow-hidden border-0 bg-transparent px-0 py-5 text-lg leading-6 text-slate-100 shadow-none outline-none placeholder:text-slate-500 focus-visible:ring-0"
              enterKeyHint="search"
              placeholder="片名、导演或演员"
              value={query}
              onChange={(event) => onQueryChange(event.target.value.replace(/[\r\n]+/g, " "))}
              onCompositionStart={() => submitGuard.current.compositionStart()}
              onCompositionEnd={() => submitGuard.current.compositionEnd()}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (event.repeat || submitGuard.current.blocksEnter(event.nativeEvent.isComposing, event.nativeEvent.keyCode)) return;
                event.currentTarget.form?.requestSubmit();
              }}
            />
            <Button className="min-h-11 shrink-0 px-4" type="submit" disabled={!query.trim() || loading}>
              <span className="grid h-5 w-5 shrink-0 place-items-center">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}</span>
              搜索
            </Button>
          </div>

          <div className="flex items-center justify-between px-4 py-1 text-xs text-slate-400"><span>{submittedQuery ? `搜索结果：${submittedQuery}` : "输入关键词并搜索"}{submittedQuery && query.trim() !== submittedQuery ? "（输入尚未提交）" : ""}</span><button type="button" disabled={!submittedQuery} onClick={async () => { if (!submittedQuery) return; try { const url = new URL("/search", location.origin); url.searchParams.set("q", submittedQuery); if (scope !== "all") url.searchParams.set("scope", scope); await navigator.clipboard.writeText(url.href); setCopyMessage("已复制"); } catch { setCopyMessage("复制失败，请重试"); } }}>{copyMessage || "复制搜索链接"}</button></div>
          <div className="scrollbar-none flex min-h-13 items-center gap-2 overflow-x-auto border-b border-slate-900 bg-slate-950 px-3 py-2 sm:px-4">
            {searchScopes.map((option) => (
              <button
                className={`min-h-9 flex-none rounded-full border px-3.5 text-sm font-semibold transition ${
                  scope === option.id
                    ? "border-emerald-300/40 bg-emerald-300 text-slate-950"
                    : "border-slate-800 bg-slate-900 text-slate-400 active:bg-slate-800"
                }`}
                key={option.id}
                type="button"
                onClick={() => setScope(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid min-h-0 bg-slate-950 lg:min-h-[420px] lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="flex min-h-0 flex-col border-slate-800 lg:border-r">
              <div className="flex h-12 items-center justify-between gap-3 border-b border-slate-900 px-4">
                <p className="truncate text-sm font-semibold text-slate-400">
                  {hasQuery
                    ? loading && visibleResults.length === 0 && people.length === 0
                      ? copy.search.searching
                      : copy.search.resultCount(visibleResults.length + (scope === "all" ? people.length : 0))
                    : copy.search.start}
                </p>
              </div>

              <div ref={scrollRef} onScroll={event => writeSession("search-scroll", event.currentTarget.scrollTop)} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] sm:h-full sm:max-h-none sm:min-h-0 sm:pb-2 sm:[scrollbar-gutter:stable]">
                {error ? (
                  <div className="m-2 rounded-md border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-200">
                    {error} <button type="button" onClick={() => onSearch()}>重试搜索</button>
                  </div>
                ) : null}
                {!hasQuery ? (
                  <SearchIdleState />
                ) : loading && visibleResults.length === 0 && people.length === 0 ? (
                  <SearchLoadingRows />
                ) : visibleResults.length === 0 && (scope !== "all" || people.length === 0) ? (
                  <SearchEmptyState query={normalizedQuery} />
                ) : (
                  <div className="grid gap-3">
                    {scope === "all" && people.length > 0 ? (
                      <section className="grid gap-1" aria-label="人物搜索结果">
                        <p className="px-3 pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">人物</p>
                        {people.map((person) => (
                          <a href={entityPath("person", person.personId)} className="grid min-h-16 w-full grid-cols-[40px_minmax(0,1fr)] items-center gap-3 rounded-xl px-3 py-2 text-left text-slate-300 transition-colors hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400" key={person.personId} onClick={event => followInternalLink(event, () => onSelectPerson(person.personId))}>
                            <span className="grid h-10 w-10 place-items-center rounded-full border border-slate-800 bg-slate-900"><UserRound className="h-5 w-5 text-emerald-300" /></span>
                            <span className="min-w-0">
                              <span className="flex min-w-0 items-baseline gap-2"><span className="truncate font-semibold text-slate-100">{person.names.primary}</span>{person.names.english && person.names.english !== person.names.primary ? <span className="truncate text-xs text-slate-500">{person.names.english}</span> : null}</span>
                              <span className="mt-1 block truncate text-xs text-slate-500">{[person.departments.map(personDepartmentLabel).join(" / "), person.representativeWorks.slice(0, 2).join(" · ")].filter(Boolean).join(" · ") || `WWP 收录作品 ${person.workCount} 部`}</span>
                            </span>
                          </a>
                        ))}
                      </section>
                    ) : null}
                    {visibleResults.length > 0 ? <section className="grid gap-1" aria-label="影视搜索结果">
                      {scope === "all" && people.length > 0 ? <p className="px-3 pt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">影视</p> : null}
                    {visibleResults.map((result) => (
                      <SearchResultRow
                        active={activeResult?.assetKey === result.assetKey}
                        key={result.assetKey}
                        result={result}
                        onFocus={() => setActiveAssetKey(result.assetKey)}
                        onSelect={() => onSelectResult(result)}
                      />
                    ))}
                    </section> : null}
                  </div>
                )}
              </div>
            </section>

            <aside className="hidden min-h-0 bg-slate-950/80 lg:block">
              {activeResult ? (
                <SearchPreview result={activeResult} />
              ) : (
                <div className="grid h-full min-h-[420px] place-items-center px-6 text-center">
                  <div className="grid gap-3">
                    <div className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-slate-800 bg-slate-900 text-slate-500">
                      <Film className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-400">{copy.search.chooseResult}</p>
                  </div>
                </div>
              )}
            </aside>
          </div>
        </form>
      </SearchSurface>
    </Dialog>
  );
}

function personDepartmentLabel(value: PublicPersonSummary["departments"][number]) {
  return ({
    directing: "导演", writing: "编剧", acting: "演员", production: "制片", camera: "摄影",
    music: "音乐", editing: "剪辑", art: "美术", sound: "声音", visual_effects: "视效",
    costume: "服装", makeup: "化妆", crew: "主创", other: "其他"
  } as const)[value];
}

function resultMatchesScope(result: ResultWithCache, scope: string) {
  if (scope === "all") {
    return true;
  }
  if (scope === "ready") {
    return result.cache?.status === "ready"
      || result.variants?.some((variant) => variant.cache?.status === "ready") === true;
  }

  const metadata = result.metadata;
  const kind = metadata?.work?.kind ?? metadata?.kind;
  const text = [
    result.title,
    kind,
    metadata?.type,
    metadata?.genres?.join(" "),
    metadata?.work?.genres?.join(" "),
    metadata?.external?.omdb?.type,
    metadata?.external?.omdb?.genres?.join(" ")
  ].filter(Boolean).join(" ").toLowerCase();

  if (scope === "animation") {
    return /动画|動畫|动漫|動漫|番剧|番劇|anime|animation|animated/.test(text);
  }
  if (scope === "tv") {
    return kind === "series"
      || kind === "season"
      || kind === "episode"
      || /电视|电视剧|剧集|影集|\btv\b|\bseries\b|\bseason\b|\bshow\b/.test(text);
  }
  return kind === "movie"
    || kind === "short"
    || kind === "special"
    || (/电影|\bmovie\b|\bfilm\b/.test(text) && !/\btv series\b|\bseries\b|电视剧|剧集/.test(text));
}

function SearchResultRow({
  active,
  result,
  onFocus,
  onSelect
}: {
  active: boolean;
  result: ResultWithCache;
  onFocus: () => void;
  onSelect: () => void;
}) {
  const genres = visibleTags(result.metadata?.genres).slice(0, 2);
  const variantCount = result.variants?.length ?? 0;

  return (
    <a href={entityPath("work", result.assetKey)}
      className={`grid min-h-20 w-full grid-cols-[52px_minmax(0,1fr)] gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:grid-cols-[44px_minmax(0,1fr)] sm:rounded-md sm:py-2.5 ${
        active ? "bg-slate-800/80 text-slate-50" : "text-slate-300 hover:bg-slate-900"
      }`}
      onClick={event => followInternalLink(event, onSelect)}
      onFocus={onFocus}
      onMouseEnter={onFocus}
    >
      <MiniPoster result={result} />
      <span className="grid min-w-0 gap-1">
        <span className="truncate font-semibold leading-5">{result.title}</span>
        <span className="truncate text-sm text-slate-500">{metadataLine(result)}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {genres.map((genre) => (
            <Badge className={genreBadgeClass(genre)} key={`${result.assetKey}-${genre}`} variant="secondary">{genre}</Badge>
          ))}
          {variantCount > 0 ? <Badge variant="muted">{copy.library.variantCount(variantCount)}</Badge> : null}
          {result.cache?.status === "ready" ? <Badge variant="default">{copy.cache.status.ready}</Badge> : null}
        </span>
      </span>
    </a>
  );
}

function SearchPreview({ result }: { result: ResultWithCache }) {
  const summary = bestSummary(result);
  const info = basicInfoLine(result);
  const variantCount = result.variants?.length ?? 0;
  const playableVariantCount = result.variants?.filter((variant) => variant.cache?.status === "ready").length ?? 0;

  return (
    <div className="grid max-h-full gap-4 overflow-y-auto p-4 [scrollbar-gutter:stable]">
      <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-900">
        <Poster result={result} />
      </div>
      <div className="grid gap-3">
        <div className="min-w-0">
          <h3 className="line-clamp-3 text-xl font-semibold leading-tight text-slate-50">{result.title}</h3>
          <p className="mt-2 text-sm text-slate-400">{metadataLine(result)}</p>
          {info ? <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-500">{info}</p> : null}
        </div>
        <p className="line-clamp-5 text-sm leading-6 text-slate-400">{summary}</p>
        {variantCount > 0 ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-3 py-2">
            <Badge variant="muted">{copy.library.variantCount(variantCount)}</Badge>
            {playableVariantCount > 0 ? <Badge variant="default">{copy.library.playableVariantCount(playableVariantCount)}</Badge> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SearchIdleState() {
  return (
    <div className="grid min-h-[320px] place-items-center px-6 text-center">
      <div className="grid max-w-sm gap-3">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-slate-800 bg-slate-900 text-emerald-200">
          <Search className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-slate-300">输入片名、导演或演员，点击搜索查找影片</p>
      </div>
    </div>
  );
}

function SearchEmptyState({ query }: { query: string }) {
  return (
    <div className="grid min-h-[320px] place-items-center px-6 text-center">
      <div className="grid max-w-sm gap-3">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-slate-800 bg-slate-900 text-slate-500">
          <Film className="h-5 w-5" />
        </div>
        <p className="text-sm font-semibold text-slate-300">{copy.search.empty(query)}</p>
      </div>
    </div>
  );
}

function SearchLoadingRows() {
  return (
    <div className="grid gap-2 p-2" aria-busy="true" aria-label={copy.search.searching}>
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-3 rounded-md px-3 py-2.5" key={index}>
          <div className="h-16 animate-pulse rounded-md bg-slate-800/70" />
          <div className="grid content-center gap-2">
            <div className="h-4 w-4/5 animate-pulse rounded bg-slate-800/70" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-slate-800/50" />
            <div className="h-5 w-28 animate-pulse rounded-full bg-slate-800/40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function MiniPoster({ result }: { result: SearchResult }) {
  return (
    <span className="relative aspect-[2/3] h-[4.75rem] overflow-hidden rounded-lg border border-slate-800 bg-slate-900 sm:h-16 sm:rounded-md">
      <span className="absolute inset-0 grid place-items-center text-lg font-black text-emerald-100">
        {titleInitial(result.title)}
      </span>
      <PosterImage
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        result={result}
      />
    </span>
  );
}

function Poster({ result }: { result: SearchResult }) {
  return (
    <div className="relative aspect-[16/10] overflow-hidden bg-slate-900">
      <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950 text-5xl font-black text-emerald-100">
        {titleInitial(result.title)}
      </div>
      <PosterImage
        alt={result.title}
        className="absolute inset-0 h-full w-full object-cover"
        result={result}
      />
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 to-transparent p-3">
        <p className="text-xs font-semibold uppercase tracking-normal text-slate-300">{formatDate(result.updatedAt)}</p>
      </div>
    </div>
  );
}

function SearchSurface({ standalone, children, className }: { standalone: boolean; children: ReactNode; className: string; hideCloseButton?: boolean }) {
  return standalone ? <section aria-label="搜索" className="h-[calc(100dvh-10rem)] min-h-[480px] overflow-hidden rounded-lg border border-slate-800">{children}</section>
    : <DialogContent hideCloseButton className={className}>{children}</DialogContent>;
}
