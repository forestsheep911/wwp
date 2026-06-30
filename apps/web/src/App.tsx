import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccessRole,
  AdminCacheJobEntry,
  AuthCheckResponse,
  CacheAsset,
  CacheJob,
  MediaVariant,
  PlaybackResponse,
  SearchResult
} from "@wwpdw/shared";
import {
  checkAccess,
  clearAccessKey,
  createMemberAccessCode,
  deleteCachedAsset,
  deleteCacheJob,
  deleteMemberAccessCode,
  ensureCache,
  errorMessage,
  getAccessKey,
  getCacheAsset,
  getCacheStatus,
  getPlayback,
  isUnauthorizedError,
  listCachedAssets,
  listCacheJobs,
  listMemberCodes,
  revokeMemberAccessCode,
  retryCacheJob,
  searchAssets,
  setMemberCredits as setMemberCreditsApi,
  setAccessKey
} from "./api";
import { AccessGate } from "./cinema/components/AccessGate";
import { AdminPanel } from "./cinema/components/AdminPanel";
import { CachedShelf } from "./cinema/components/CachedShelf";
import { CinemaLayout } from "./cinema/components/CinemaLayout";
import { HistoryPanel } from "./cinema/components/HistoryPanel";
import { LibraryTab } from "./cinema/components/LibraryTab";
import { Player } from "./cinema/components/Player";
import { StatusPanel } from "./cinema/components/StatusPanel";
import { cacheErrorLabel } from "./cinema/format";
import { historyStorageKey, readJsonStorage, writeJsonStorage } from "./cinema/storage";
import type {
  AppTab,
  HistoryAssetStatusMap,
  LibraryViewMode,
  ManagedMemberCode,
  PlaybackHistoryEntry,
  ResultWithCache,
  TrackedCacheItem
} from "./cinema/types";

interface CinemaRoute {
  tab: AppTab;
  query: string;
  playerAssetKey?: string;
}

interface CinemaHistoryState {
  app: "wwpdw-cinema";
  route: CinemaRoute;
}

const routeTabs: AppTab[] = ["library", "cached", "history", "admin", "tasks"];

function isAppTab(value: string | null): value is AppTab {
  return Boolean(value && routeTabs.includes(value as AppTab));
}

function routeFromLocation(): CinemaRoute {
  if (typeof window === "undefined") {
    return {
      tab: "library",
      query: ""
    };
  }

  const params = new URLSearchParams(window.location.search);
  const tab = isAppTab(params.get("tab")) ? params.get("tab") as AppTab : "library";
  return {
    tab,
    query: params.get("q") ?? "",
    playerAssetKey: params.get("play") ?? undefined
  };
}

function historyStateRoute(state: unknown): CinemaRoute | undefined {
  const candidate = state as Partial<CinemaHistoryState> | undefined;
  return candidate?.app === "wwpdw-cinema" && candidate.route
    ? candidate.route
    : undefined;
}

function routeUrl(route: CinemaRoute) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (route.tab !== "library") {
    url.searchParams.set("tab", route.tab);
  }
  if (route.query.trim()) {
    url.searchParams.set("q", route.query.trim());
  }
  if (route.playerAssetKey) {
    url.searchParams.set("play", route.playerAssetKey);
  }
  return `${url.pathname}${url.search}`;
}

function sameRoute(left: CinemaRoute | undefined, right: CinemaRoute) {
  return Boolean(
    left &&
      left.tab === right.tab &&
      left.query === right.query &&
      left.playerAssetKey === right.playerAssetKey
  );
}

export default function App() {
  const [initialRoute] = useState<CinemaRoute>(() => routeFromLocation());
  const [unlocked, setUnlocked] = useState(() => Boolean(getAccessKey()));
  const [role, setRole] = useState<AccessRole | undefined>();
  const [activeTab, setActiveTab] = useState<AppTab>(initialRoute.tab);
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>("gallery");
  const [query, setQuery] = useState(initialRoute.query);
  const [results, setResults] = useState<ResultWithCache[]>([]);
  const [job, setJob] = useState<CacheJob | undefined>();
  const [asset, setAsset] = useState<CacheAsset | undefined>();
  const [trackedItems, setTrackedItems] = useState<TrackedCacheItem[]>([]);
  const [playback, setPlayback] = useState<PlaybackResponse | undefined>();
  const [searchLoading, setSearchLoading] = useState(false);
  const [cacheRequestAssetKeys, setCacheRequestAssetKeys] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<PlaybackHistoryEntry[]>(() => readJsonStorage(historyStorageKey, []));
  const [historyAssetStatus, setHistoryAssetStatus] = useState<HistoryAssetStatusMap>({});
  const [cachedAssets, setCachedAssets] = useState<CacheAsset[]>([]);
  const [cachedAssetsLoading, setCachedAssetsLoading] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [cacheJobsLoading, setCacheJobsLoading] = useState(false);
  const [adminKeyInput, setAdminKeyInput] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberCredits, setMemberCredits] = useState(20);
  const [memberCreditEdits, setMemberCreditEdits] = useState<Record<string, number>>({});
  const [memberCodes, setMemberCodes] = useState<ManagedMemberCode[]>([]);
  const [cacheJobs, setCacheJobs] = useState<AdminCacheJobEntry[]>([]);
  const adminCacheJobLimit = 100;
  const historyInitializedRef = useRef(false);

  const readyCount = useMemo(
    () =>
      results.reduce((count, item) => {
        const resultReady = item.cache?.status === "ready" ? 1 : 0;
        const variantReady = item.variants?.filter((variant) => variant.cache?.status === "ready").length ?? 0;
        return count + resultReady + variantReady;
      }, 0),
    [results]
  );

  const trackedPollKey = useMemo(
    () =>
      trackedItems
        .filter((item) => item.job.status !== "ready" && item.job.status !== "failed")
        .map((item) => `${item.job.id}:${item.job.status}`)
        .join("|"),
    [trackedItems]
  );

  const trackedByAssetKey = useMemo(() => {
    const itemsByAssetKey = new Map<string, TrackedCacheItem>();
    for (const item of trackedItems) {
      if (!itemsByAssetKey.has(item.job.assetKey)) {
        itemsByAssetKey.set(item.job.assetKey, item);
      }
    }
    return itemsByAssetKey;
  }, [trackedItems]);

  function permittedRoute(route: CinemaRoute): CinemaRoute {
    if (route.tab === "admin" && role && role !== "admin") {
      return {
        ...route,
        tab: "library"
      };
    }
    return route;
  }

  function writeRoute(route: CinemaRoute, mode: "push" | "replace") {
    const nextRoute = permittedRoute(route);
    const state: CinemaHistoryState = {
      app: "wwpdw-cinema",
      route: nextRoute
    };
    const url = routeUrl(nextRoute);
    const currentRoute = historyStateRoute(window.history.state);

    if (mode === "push" && !sameRoute(currentRoute, nextRoute)) {
      window.history.pushState(state, "", url);
      return;
    }

    window.history.replaceState(state, "", url);
  }

  function routeForCurrentView(overrides: Partial<CinemaRoute> = {}): CinemaRoute {
    return {
      tab: activeTab,
      query,
      playerAssetKey: playback?.assetKey,
      ...overrides
    };
  }

  function navigateToTab(nextTab: AppTab) {
    const nextRoute = permittedRoute(routeForCurrentView({
      tab: nextTab,
      playerAssetKey: undefined
    }));
    setPlayback(undefined);
    setActiveTab(nextRoute.tab);
    writeRoute(nextRoute, "push");
  }

  function variantToResult(result: SearchResult, variant: MediaVariant): SearchResult {
    return {
      assetKey: variant.assetKey,
      title: `${result.title} / ${variant.label}`,
      source: result.source,
      sourceUrl: variant.sourceUrl,
      sourcePageId: variant.sourcePageId ?? result.sourcePageId,
      sourceBreadcrumb: variant.sourceBreadcrumb ?? result.sourceBreadcrumb,
      durationLabel: result.durationLabel,
      updatedAt: result.updatedAt,
      summary: variant.summary,
      metadata: result.metadata
    };
  }

  function mergeTrackedItem(currentItem: TrackedCacheItem, nextItem: TrackedCacheItem): TrackedCacheItem {
    return {
      ...nextItem,
      job: {
        ...nextItem.job,
        progress: Math.max(currentItem.job.progress, nextItem.job.progress)
      }
    };
  }

  function upsertTrackedItem(nextItem: TrackedCacheItem) {
    setTrackedItems((currentItems) => {
      const existing = currentItems.find((item) => item.job.id === nextItem.job.id);
      const mergedItem = existing ? mergeTrackedItem(existing, nextItem) : nextItem;
      return [
        mergedItem,
        ...currentItems.filter((item) => item.job.id !== nextItem.job.id)
      ].slice(0, 10);
    });
  }

  function handleRequestError(errorValue: unknown, fallback: string) {
    if (isUnauthorizedError(errorValue)) {
      clearAccessKey();
      setUnlocked(false);
      setRole(undefined);
      setAdminUnlocked(false);
      setPlayback(undefined);
      setJob(undefined);
      setAsset(undefined);
      setTrackedItems([]);
      setCacheRequestAssetKeys([]);
      return;
    }

    setError(cacheErrorLabel(errorMessage(errorValue, fallback)));
  }

  async function refreshResults(
    options: { showLoading: boolean; activateLibrary: boolean },
    queryOverride = query
  ) {
    const normalizedQuery = queryOverride.trim();
    if (!normalizedQuery) {
      setResults([]);
      setError("");
      if (options.showLoading) {
        setSearchLoading(false);
      }
      return;
    }

    if (options.showLoading) {
      setSearchLoading(true);
      setError("");
    }
    try {
      const response = await searchAssets(normalizedQuery);
      setResults(response.results);
      if (options.activateLibrary) {
        setActiveTab("library");
      }
    } catch (searchError) {
      handleRequestError(searchError, "Search failed.");
    } finally {
      if (options.showLoading) {
        setSearchLoading(false);
      }
    }
  }

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const normalizedQuery = query.trim();
    await refreshResults({ showLoading: true, activateLibrary: true }, normalizedQuery);
    writeRoute({
      tab: "library",
      query: normalizedQuery
    }, "push");
  }

  async function refreshResultsInBackground() {
    await refreshResults({ showLoading: false, activateLibrary: false });
  }

  async function selectResult(result: ResultWithCache, variant: MediaVariant) {
    setError("");
    setPlayback(undefined);
    setCacheRequestAssetKeys((currentKeys) => (
      currentKeys.includes(variant.assetKey) ? currentKeys : [...currentKeys, variant.assetKey]
    ));
    try {
      const target = variantToResult(result, variant);
      const response = await ensureCache(target);
      setJob(response.job);
      setAsset(response.asset);
      upsertTrackedItem({
        job: response.job,
        asset: response.asset,
        result: target
      });
      if (response.asset.status === "ready") {
        await openPlayer(response.asset.assetKey, target);
      }
      await refreshResultsInBackground();
    } catch (cacheError) {
      handleRequestError(cacheError, "Cache request failed.");
    } finally {
      setCacheRequestAssetKeys((currentKeys) => currentKeys.filter((assetKey) => assetKey !== variant.assetKey));
    }
  }

  function rememberPlayback(response: PlaybackResponse, result?: SearchResult) {
    const entry = {
      assetKey: response.assetKey,
      title: response.title,
      playedAt: new Date().toISOString(),
      contentType: response.media?.contentType,
      contentLength: response.media?.contentLength,
      result
    };
    setHistory((currentHistory) => {
      const next = [entry, ...currentHistory.filter((item) => item.assetKey !== response.assetKey)].slice(0, 20);
      writeJsonStorage(historyStorageKey, next);
      return next;
    });
  }

  async function openPlayer(
    assetKey = asset?.assetKey,
    result?: SearchResult,
    options: { syncHistory?: boolean } = {}
  ) {
    if (!assetKey) {
      return;
    }

    try {
      const response = await getPlayback(assetKey);
      setPlayback(response);
      rememberPlayback(response, result);
      if (options.syncHistory !== false) {
        writeRoute(routeForCurrentView({
          playerAssetKey: response.assetKey
        }), "push");
      }
    } catch (playbackError) {
      handleRequestError(playbackError, "Playback is not ready.");
    }
  }

  function closePlayer() {
    setPlayback(undefined);
    writeRoute(routeForCurrentView({
      playerAssetKey: undefined
    }), "replace");
  }

  function clearHistory() {
    setHistory([]);
    writeJsonStorage(historyStorageKey, []);
    setHistoryAssetStatus({});
  }

  async function refreshHistoryAssetStatus() {
    const assetKeys = Array.from(new Set(history.map((item) => item.assetKey)));
    if (assetKeys.length === 0) {
      setHistoryAssetStatus({});
      return;
    }

    try {
      const statuses = await Promise.all(
        assetKeys.map(async (assetKey) => [assetKey, await getCacheAsset(assetKey)] as const)
      );
      setHistoryAssetStatus(Object.fromEntries(statuses));
    } catch (historyStatusError) {
      handleRequestError(historyStatusError, "Could not refresh history cache status.");
    }
  }

  async function refreshCachedAssets() {
    setCachedAssetsLoading(true);
    try {
      const response = await listCachedAssets(100);
      setCachedAssets(response.items.map((item) => item.asset));
    } catch (cachedAssetsError) {
      handleRequestError(cachedAssetsError, "Could not load cached titles.");
    } finally {
      setCachedAssetsLoading(false);
    }
  }

  async function recacheHistoryEntry(entry: PlaybackHistoryEntry) {
    if (!entry.result) {
      setError("Search this title again before re-caching it.");
      return;
    }

    setError("");
    setPlayback(undefined);
    setCacheRequestAssetKeys((currentKeys) => (
      currentKeys.includes(entry.assetKey) ? currentKeys : [...currentKeys, entry.assetKey]
    ));
    try {
      const response = await ensureCache(entry.result);
      setJob(response.job);
      setAsset(response.asset);
      upsertTrackedItem({
        job: response.job,
        asset: response.asset,
        result: entry.result
      });
      navigateToTab("library");
      await refreshHistoryAssetStatus();
    } catch (cacheError) {
      handleRequestError(cacheError, "Cache request failed.");
    } finally {
      setCacheRequestAssetKeys((currentKeys) => currentKeys.filter((assetKey) => assetKey !== entry.assetKey));
    }
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

  async function refreshCacheJobs() {
    if (!adminUnlocked) {
      return;
    }

    setCacheJobsLoading(true);
    try {
      const response = await listCacheJobs(adminCacheJobLimit);
      setCacheJobs(response.jobs);
      setAdminError("");
    } catch (cacheJobError) {
      setAdminError(errorMessage(cacheJobError, "Could not load cache jobs."));
    } finally {
      setCacheJobsLoading(false);
    }
  }

  async function retryAdminCacheJob(jobId: string) {
    setCacheJobsLoading(true);
    setAdminError("");
    try {
      const response = await retryCacheJob(jobId);
      upsertTrackedItem({
        job: response.job,
        asset: response.asset
      });
      await refreshCacheJobs();
    } catch (retryError) {
      setAdminError(errorMessage(retryError, "Could not retry cache job."));
    } finally {
      setCacheJobsLoading(false);
    }
  }

  async function deleteAdminCacheJob(jobId: string) {
    setCacheJobsLoading(true);
    setAdminError("");
    try {
      const response = await deleteCacheJob(jobId);
      if (response.jobId) {
        setTrackedItems((currentItems) => currentItems.filter((item) => item.job.id !== response.jobId));
      }
      if (response.assetKey) {
        setCachedAssets((currentAssets) => currentAssets.filter((item) => item.assetKey !== response.assetKey));
      }
      await refreshCacheJobs();
      await refreshCachedAssets();
    } catch (deleteError) {
      setAdminError(errorMessage(deleteError, "Could not delete cache entry."));
    } finally {
      setCacheJobsLoading(false);
    }
  }

  async function deleteAdminCachedAsset(assetKey: string) {
    setCachedAssetsLoading(true);
    setAdminError("");
    try {
      const response = await deleteCachedAsset(assetKey);
      if (response.assetKey) {
        setCachedAssets((currentAssets) => currentAssets.filter((item) => item.assetKey !== response.assetKey));
      }
      if (response.jobId) {
        setTrackedItems((currentItems) => currentItems.filter((item) => item.job.id !== response.jobId));
      }
      await refreshCacheJobs();
      await refreshCachedAssets();
    } catch (deleteError) {
      setAdminError(errorMessage(deleteError, "Could not delete cached video."));
    } finally {
      setCachedAssetsLoading(false);
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
      await refreshCachedAssets();
      try {
        const jobsResponse = await listCacheJobs(adminCacheJobLimit);
        setCacheJobs(jobsResponse.jobs);
      } catch (cacheJobError) {
        setAdminError(errorMessage(cacheJobError, "Could not load cache jobs."));
      }
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
        credits: Number.isFinite(memberCredits) && memberCredits >= 0 ? memberCredits : 20
      });
      setMemberCodes((currentCodes) => [
        response.code,
        ...currentCodes.filter((code) => code.id !== response.code.id)
      ]);
      setMemberName("");
      setMemberCredits(20);
    } catch (generateError) {
      setAdminError(errorMessage(generateError, "Could not generate member code."));
    } finally {
      setAdminLoading(false);
    }
  }

  function setMemberCreditEdit(id: string, value: number) {
    setMemberCreditEdits((currentCredits) => ({
      ...currentCredits,
      [id]: value
    }));
  }

  async function updateMemberCredits(id: string) {
    const currentCode = memberCodes.find((code) => code.id === id);
    const credits = memberCreditEdits[id] ?? currentCode?.credits.remaining ?? 0;
    if (!Number.isFinite(credits) || credits < 0) {
      setAdminError("Credit balance must be zero or greater.");
      return;
    }

    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await setMemberCreditsApi(id, { credits });
      setMemberCodes((currentCodes) => currentCodes.map((code) => (
        code.id === id
          ? { ...response.code, code: code.code }
          : code
      )));
      setMemberCreditEdit(id, response.code.credits.remaining);
    } catch (creditUpdateError) {
      setAdminError(errorMessage(creditUpdateError, "Could not update credits."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function revokeMemberCode(id: string) {
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await revokeMemberAccessCode(id);
      setMemberCodes((currentCodes) => currentCodes.map((code) => (
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

  async function deleteMemberCode(id: string) {
    setAdminLoading(true);
    setAdminError("");
    try {
      await deleteMemberAccessCode(id);
      setMemberCodes((currentCodes) => currentCodes.filter((code) => code.id !== id));
    } catch (deleteError) {
      setAdminError(errorMessage(deleteError, "Could not delete member code."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function copyMemberCode(code: string) {
    await navigator.clipboard?.writeText(code);
  }

  function lockCinema() {
    clearAccessKey();
    setUnlocked(false);
    setRole(undefined);
    setAdminUnlocked(false);
    setActiveTab("library");
    setQuery("");
    setResults([]);
    setPlayback(undefined);
    setJob(undefined);
    setAsset(undefined);
    setMemberCodes([]);
    setCacheJobs([]);
    setTrackedItems([]);
    setCacheRequestAssetKeys([]);
    setCachedAssets([]);
    historyInitializedRef.current = false;
    writeRoute({
      tab: "library",
      query: ""
    }, "replace");
  }

  useEffect(() => {
    const activeItems = trackedItems.filter((item) => item.job.status !== "ready" && item.job.status !== "failed");
    if (activeItems.length === 0) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const responses = await Promise.all(activeItems.map((item) => getCacheStatus(item.job.id)));
        const responseByJobId = new Map(responses.map((response) => [response.job.id, response]));

        setTrackedItems((currentItems) =>
          currentItems.map((item) => {
            const response = responseByJobId.get(item.job.id);
            return response
              ? mergeTrackedItem(item, {
                job: response.job,
                asset: response.asset,
                result: item.result
              })
              : item;
          })
        );

        const focusedResponse = job?.id ? responseByJobId.get(job.id) : undefined;
        if (focusedResponse) {
          setJob(focusedResponse.job);
          setAsset(focusedResponse.asset);
        }

        if (responses.some((response) => response.job.status === "ready" || response.job.status === "failed")) {
          await refreshResultsInBackground();
          if (activeTab === "cached") {
            await refreshCachedAssets();
          }
        }
      } catch (statusError) {
        handleRequestError(statusError, "Status refresh failed.");
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [trackedPollKey, job?.id, query, activeTab]);

  useEffect(() => {
    if (!unlocked || role) {
      return;
    }

    checkAccess()
      .then((auth) => {
        applyAuth(auth);
      })
      .catch((authError) => {
        handleRequestError(authError, "Cinema Pass did not match.");
      });
  }, [unlocked, role]);

  useEffect(() => {
    if (!unlocked || !role || historyInitializedRef.current) {
      return;
    }

    historyInitializedRef.current = true;
    const initialPermittedRoute = permittedRoute({
      tab: activeTab,
      query,
      playerAssetKey: initialRoute.playerAssetKey
    });
    setActiveTab(initialPermittedRoute.tab);
    setQuery(initialPermittedRoute.query);
    writeRoute(initialPermittedRoute, "replace");

    if (initialPermittedRoute.query.trim()) {
      void refreshResults({ showLoading: true, activateLibrary: false }, initialPermittedRoute.query);
    }

    if (initialPermittedRoute.playerAssetKey) {
      void openPlayer(initialPermittedRoute.playerAssetKey, undefined, { syncHistory: false });
    }
  }, [activeTab, initialRoute.playerAssetKey, query, role, unlocked]);

  useEffect(() => {
    function applyRouteFromHistory(event: PopStateEvent) {
      const requestedRoute = historyStateRoute(event.state) ?? routeFromLocation();
      const nextRoute = permittedRoute(requestedRoute);
      const nextQuery = nextRoute.query.trim();

      if (!sameRoute(requestedRoute, nextRoute)) {
        writeRoute(nextRoute, "replace");
      }

      setError("");
      setActiveTab(nextRoute.tab);
      setQuery(nextRoute.query);

      if (!nextRoute.playerAssetKey) {
        setPlayback(undefined);
      }

      if (nextQuery) {
        void refreshResults({ showLoading: true, activateLibrary: false }, nextQuery);
      } else {
        setResults([]);
      }

      if (nextRoute.tab === "cached") {
        void refreshCachedAssets();
      }

      if (nextRoute.tab === "history") {
        void refreshHistoryAssetStatus();
      }

      if (nextRoute.playerAssetKey) {
        void openPlayer(nextRoute.playerAssetKey, undefined, { syncHistory: false });
      }
    }

    window.addEventListener("popstate", applyRouteFromHistory);
    return () => window.removeEventListener("popstate", applyRouteFromHistory);
  }, [role, adminUnlocked, history.length]);

  useEffect(() => {
    if (activeTab === "admin" && adminUnlocked) {
      void refreshMemberCodes();
      void refreshCachedAssets();
      void refreshCacheJobs();
    }
  }, [activeTab, adminUnlocked]);

  useEffect(() => {
    if (activeTab === "admin" && role && role !== "admin") {
      const nextRoute = routeForCurrentView({
        tab: "library",
        playerAssetKey: undefined
      });
      setActiveTab(nextRoute.tab);
      writeRoute(nextRoute, "replace");
    }
  }, [activeTab, role]);

  useEffect(() => {
    if (activeTab === "history") {
      void refreshHistoryAssetStatus();
    }
  }, [activeTab, history.length]);

  useEffect(() => {
    if (activeTab === "cached") {
      void refreshCachedAssets();
    }
  }, [activeTab]);

  if (!unlocked) {
    return <AccessGate onUnlock={(auth) => {
      setUnlocked(true);
      applyAuth(auth);
    }} />;
  }

  if (playback) {
    return <Player playback={playback} onClose={closePlayer} />;
  }

  const showStatusPanel = activeTab === "library" || trackedItems.length > 0;
  const showAdmin = role === "admin";

  return (
    <CinemaLayout
      activeTab={activeTab}
      resultsCount={results.length}
      readyCount={readyCount}
      statusCount={trackedItems.length}
      showAdmin={showAdmin}
      onActiveTabChange={navigateToTab}
      onLock={lockCinema}
      status={showStatusPanel ? (
        <StatusPanel
          items={trackedItems}
          onOpenPlayer={(assetKey) => void openPlayer(assetKey)}
        />
      ) : null}
      library={(
        <LibraryTab
          query={query}
          searchLoading={searchLoading}
          error={error}
          viewMode={libraryViewMode}
          results={results}
          pendingAssetKeys={cacheRequestAssetKeys}
          trackedByAssetKey={trackedByAssetKey}
          onQueryChange={setQuery}
          onViewModeChange={setLibraryViewMode}
          onSearch={(event) => void runSearch(event)}
          onSelect={(selectedResult, variant) => void selectResult(selectedResult, variant)}
        />
      )}
      cached={(
        <CachedShelf
          cachedAssets={cachedAssets}
          loading={cachedAssetsLoading}
          onOpen={(assetKey) => void openPlayer(assetKey)}
          onRefresh={() => void refreshCachedAssets()}
        />
      )}
      history={(
        <HistoryPanel
          items={history}
          statusByAssetKey={historyAssetStatus}
          onClear={clearHistory}
          onPlay={(assetKey, result) => void openPlayer(assetKey, result)}
          onRecache={(entry) => void recacheHistoryEntry(entry)}
        />
      )}
      admin={showAdmin ? (
        <AdminPanel
          adminUnlocked={adminUnlocked}
          adminError={adminError}
          adminLoading={adminLoading}
          cacheJobs={cacheJobs}
          cacheJobsLoading={cacheJobsLoading}
          cachedAssets={cachedAssets}
          cachedAssetsLoading={cachedAssetsLoading}
          adminKeyInput={adminKeyInput}
          memberName={memberName}
          memberCredits={memberCredits}
          memberCreditEdits={memberCreditEdits}
          memberCodes={memberCodes}
          setAdminKeyInput={setAdminKeyInput}
          setMemberName={setMemberName}
          setMemberCredits={setMemberCredits}
          setMemberCreditEdit={setMemberCreditEdit}
          onUnlock={unlockAdmin}
          onGenerate={generateMemberCode}
          onCopy={(code) => void copyMemberCode(code)}
          onDelete={deleteMemberCode}
          onRefreshJobs={() => void refreshCacheJobs()}
          onRefreshCachedAssets={() => void refreshCachedAssets()}
          onRetryCacheJob={(jobId) => void retryAdminCacheJob(jobId)}
          onDeleteCacheJob={(jobId) => void deleteAdminCacheJob(jobId)}
          onDeleteCachedAsset={(assetKey) => void deleteAdminCachedAsset(assetKey)}
          onUpdateCredits={updateMemberCredits}
          onRevoke={revokeMemberCode}
        />
      ) : undefined}
    />
  );
}
