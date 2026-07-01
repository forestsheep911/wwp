import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type {
  AccessRole,
  AdminCacheJobEntry,
  AdminLoginAuditEntry,
  AuthCheckResponse,
  CacheAsset,
  CacheJob,
  CreditPolicyResponse,
  CreditPreviewResponse,
  MediaVariant,
  MemberCreditUsageResponse,
  MovieRequestEntry,
  MovieRequestStatus,
  PlaybackResponse,
  SearchResult
} from "@wwpdw/shared";
import {
  adjustMemberCredits as adjustMemberCreditsApi,
  browseAssets,
  checkAccess,
  clearAccessKey,
  createResetInvitation,
  createSignupInvitation,
  createMovieRequest,
  deleteCachedAsset,
  deleteCacheJob,
  deleteMemberAccessCode,
  ensureCache,
  errorMessage,
  getAccessKey,
  getCacheAsset,
  getCacheStatus,
  getCreditPolicy,
  getPlayback,
  isUnauthorizedError,
  listCachedAssets,
  listCacheJobs,
  listMemberInvitations,
  listLoginAudit,
  listMemberCodes,
  listMemberCreditUsage,
  listMovieRequests,
  listOwnMovieRequests,
  listOwnCreditUsage,
  previewCredit,
  revokeMemberAccessCode,
  retryCacheJob,
  searchAssets,
  setMemberCredits as setMemberCreditsApi,
  updateMemberProfile,
  updateMovieRequestStatus as updateMovieRequestStatusApi,
  setAccessKey
} from "./api";
import { AccessGate } from "./cinema/components/AccessGate";
import { AdminPanel } from "./cinema/components/AdminPanel";
import { CacheTasksPanel } from "./cinema/components/CacheTasksPanel";
import { CachedShelf } from "./cinema/components/CachedShelf";
import { CinemaLayout } from "./cinema/components/CinemaLayout";
import { CreditConfirmDialog } from "./cinema/components/CreditConfirmDialog";
import { CreditUsageDialog } from "./cinema/components/CreditUsageDialog";
import { HelpPanel } from "./cinema/components/HelpPanel";
import { HistoryPanel } from "./cinema/components/HistoryPanel";
import { LibraryTab } from "./cinema/components/LibraryTab";
import { MovieRequestDialog } from "./cinema/components/MovieRequestDialog";
import { Player } from "./cinema/components/Player";
import { ProfileDialog } from "./cinema/components/ProfileDialog";
import { SearchDialog } from "./cinema/components/SearchDialog";
import { TaskDock } from "./cinema/components/TaskDock";
import { cacheErrorLabel } from "./cinema/format";
import { historyStorageKey, readJsonStorage, writeJsonStorage } from "./cinema/storage";
import type {
  AppTab,
  BrowseChannel,
  HistoryAssetStatusMap,
  LibraryViewMode,
  ManagedMemberCode,
  ManagedMemberInvitation,
  PlaybackHistoryEntry,
  ResultWithCache,
  TrackedCacheItem
} from "./cinema/types";
import { defaultCreditPolicy } from "./cinema/types";

interface CinemaRoute {
  tab: AppTab;
  browseChannel: BrowseChannel;
  query: string;
  playerAssetKey?: string;
}

interface CinemaHistoryState {
  app: "wwpdw-cinema";
  route: CinemaRoute;
}

type PendingCreditAction =
  | {
    kind: "cache";
    target: SearchResult;
    after?: "historyRecache";
  }
  | {
    kind: "playback";
    assetKey: string;
    result?: SearchResult;
    options?: { syncHistory?: boolean };
  };

const routeTabs: AppTab[] = ["library", "cached", "history", "help", "admin", "tasks"];
const browseChannels: BrowseChannel[] = ["recommended", "movie", "tv", "animation"];
const browsePageLimit = 48;

function isAppTab(value: string | null): value is AppTab {
  return Boolean(value && routeTabs.includes(value as AppTab));
}

function isBrowseChannel(value: string | null): value is BrowseChannel {
  return Boolean(value && browseChannels.includes(value as BrowseChannel));
}

function routeFromLocation(): CinemaRoute {
  if (typeof window === "undefined") {
    return {
      tab: "library",
      browseChannel: "recommended",
      query: ""
    };
  }

  const params = new URLSearchParams(window.location.search);
  const tab = isAppTab(params.get("tab")) ? params.get("tab") as AppTab : "library";
  const browseChannel = isBrowseChannel(params.get("channel")) ? params.get("channel") as BrowseChannel : "recommended";
  return {
    tab,
    browseChannel,
    query: params.get("q") ?? "",
    playerAssetKey: params.get("play") ?? undefined
  };
}

function historyStateRoute(state: unknown): CinemaRoute | undefined {
  const candidate = state as Partial<CinemaHistoryState> | undefined;
  const route = candidate?.route as Partial<CinemaRoute> | undefined;
  if (candidate?.app !== "wwpdw-cinema" || !route || !route.tab) {
    return undefined;
  }

  const rawBrowseChannel = route.browseChannel ?? null;
  const browseChannel: BrowseChannel = isBrowseChannel(rawBrowseChannel)
    ? rawBrowseChannel
    : "recommended";

  return {
    tab: route.tab,
    browseChannel,
    query: route.query ?? "",
    playerAssetKey: route.playerAssetKey
  };
}

function routeUrl(route: CinemaRoute) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  if (route.tab !== "library") {
    url.searchParams.set("tab", route.tab);
  }
  if (route.tab === "library" && route.browseChannel !== "recommended") {
    url.searchParams.set("channel", route.browseChannel);
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
      left.browseChannel === right.browseChannel &&
      left.query === right.query &&
      left.playerAssetKey === right.playerAssetKey
  );
}

export default function App() {
  const [initialRoute] = useState<CinemaRoute>(() => routeFromLocation());
  const [unlocked, setUnlocked] = useState(() => Boolean(getAccessKey()));
  const [role, setRole] = useState<AccessRole | undefined>();
  const [member, setMember] = useState<AuthCheckResponse["member"]>();
  const [activeTab, setActiveTab] = useState<AppTab>(initialRoute.tab);
  const [browseChannel, setBrowseChannel] = useState<BrowseChannel>(initialRoute.browseChannel);
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>("gallery");
  const [query, setQuery] = useState(initialRoute.query);
  const [results, setResults] = useState<ResultWithCache[]>([]);
  const [browseResults, setBrowseResults] = useState<ResultWithCache[]>([]);
  const [browseLoading, setBrowseLoading] = useState(
    () => initialRoute.tab === "library" && initialRoute.query.trim().length === 0
  );
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseNextOffset, setBrowseNextOffset] = useState(0);
  const [job, setJob] = useState<CacheJob | undefined>();
  const [asset, setAsset] = useState<CacheAsset | undefined>();
  const [trackedItems, setTrackedItems] = useState<TrackedCacheItem[]>([]);
  const [playback, setPlayback] = useState<PlaybackResponse | undefined>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [creditUsageOpen, setCreditUsageOpen] = useState(false);
  const [creditUsageLoading, setCreditUsageLoading] = useState(false);
  const [creditUsageError, setCreditUsageError] = useState("");
  const [creditUsage, setCreditUsage] = useState<MemberCreditUsageResponse | undefined>();
  const [creditConfirmOpen, setCreditConfirmOpen] = useState(false);
  const [creditConfirmLoading, setCreditConfirmLoading] = useState(false);
  const [creditPreview, setCreditPreview] = useState<CreditPreviewResponse | undefined>();
  const [pendingCreditAction, setPendingCreditAction] = useState<PendingCreditAction | undefined>();
  const [creditPolicy, setCreditPolicy] = useState<CreditPolicyResponse>(defaultCreditPolicy);
  const [movieRequestOpen, setMovieRequestOpen] = useState(false);
  const [movieRequestText, setMovieRequestText] = useState("");
  const [movieRequestLoading, setMovieRequestLoading] = useState(false);
  const [movieRequestError, setMovieRequestError] = useState("");
  const [ownMovieRequests, setOwnMovieRequests] = useState<MovieRequestEntry[]>([]);
  const [ownMovieRequestsLoaded, setOwnMovieRequestsLoaded] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPreviewLoading, setSearchPreviewLoading] = useState(false);
  const [searchPreviewResults, setSearchPreviewResults] = useState<ResultWithCache[]>([]);
  const [searchDialogError, setSearchDialogError] = useState("");
  const [focusedLibraryAssetKey, setFocusedLibraryAssetKey] = useState<string | undefined>();
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
  const [memberCredits, setMemberCredits] = useState(20);
  const [memberBulkCredits, setMemberBulkCredits] = useState(1);
  const [memberCreditEdits, setMemberCreditEdits] = useState<Record<string, number>>({});
  const [memberCodes, setMemberCodes] = useState<ManagedMemberCode[]>([]);
  const [memberInvitations, setMemberInvitations] = useState<ManagedMemberInvitation[]>([]);
  const [cacheJobs, setCacheJobs] = useState<AdminCacheJobEntry[]>([]);
  const [loginAudit, setLoginAudit] = useState<AdminLoginAuditEntry[]>([]);
  const [loginAuditLoading, setLoginAuditLoading] = useState(false);
  const [adminMovieRequests, setAdminMovieRequests] = useState<MovieRequestEntry[]>([]);
  const [adminMovieRequestsLoading, setAdminMovieRequestsLoading] = useState(false);
  const adminCacheJobLimit = 100;
  const loginAuditLimit = 100;
  const movieRequestLimit = 100;
  const historyInitializedRef = useRef(false);
  const ownMovieRequestsRefreshRef = useRef<Promise<void> | undefined>(undefined);
  const searchPreviewRequestRef = useRef(0);

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
      browseChannel,
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

  function openBrowseChannel(nextChannel: BrowseChannel) {
    setBrowseChannel(nextChannel);
    setError("");
    setQuery("");
    setResults([]);
    setPlayback(undefined);
    setActiveTab("library");
    writeRoute({
      tab: "library",
      browseChannel: nextChannel,
      query: "",
      playerAssetKey: undefined
    }, "push");
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
      setFocusedLibraryAssetKey(undefined);
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
      browseChannel,
      query: normalizedQuery
    }, "push");
  }

  async function runDialogSearch(event?: FormEvent<HTMLFormElement>) {
    await runSearch(event);
    if (query.trim()) {
      setSearchOpen(false);
    }
  }

  function openSearchDialog() {
    setSearchDialogError("");
    if (query.trim() && results.length > 0) {
      setSearchPreviewResults(results);
    }
    setSearchOpen(true);
  }

  function openSearchResult(result: ResultWithCache) {
    const normalizedQuery = query.trim() || result.title;
    setError("");
    setSearchDialogError("");
    setResults((currentResults) => {
      const sourceResults = searchPreviewResults.length > 0 ? searchPreviewResults : currentResults;
      return sourceResults.some((item) => item.assetKey === result.assetKey)
        ? sourceResults
        : [result, ...sourceResults];
    });
    setQuery(normalizedQuery);
    setActiveTab("library");
    setPlayback(undefined);
    setFocusedLibraryAssetKey(result.assetKey);
    setSearchOpen(false);
    writeRoute({
      tab: "library",
      browseChannel,
      query: normalizedQuery,
      playerAssetKey: undefined
    }, "push");
  }

  async function refreshResultsInBackground() {
    await refreshResults({ showLoading: false, activateLibrary: false });
  }

  function updateCurrentMemberCreditsFromPreview(preview: CreditPreviewResponse) {
    if (preview.remaining === undefined) {
      return;
    }

    updateCurrentMemberCredits({
      unit: "clover",
      unitSymbol: preview.unitSymbol,
      remaining: preview.remaining
    });
  }

  async function previewCreditAction(action: PendingCreditAction) {
    const request = action.kind === "cache"
      ? {
        action: "cache" as const,
        assetKey: action.target.assetKey,
        title: action.target.title,
        result: action.target
      }
      : {
        action: "playback" as const,
        assetKey: action.assetKey
      };

    const preview = await previewCredit(request);
    updateCurrentMemberCreditsFromPreview(preview);
    return preview;
  }

  function closeCreditConfirm() {
    if (creditConfirmLoading) {
      return;
    }

    setCreditConfirmOpen(false);
    setCreditPreview(undefined);
    setPendingCreditAction(undefined);
  }

  async function requestCreditAction(action: PendingCreditAction) {
    setError("");
    try {
      const preview = await previewCreditAction(action);
      setPendingCreditAction(action);
      setCreditPreview(preview);
      setCreditConfirmOpen(true);
    } catch (previewError) {
      handleRequestError(previewError, "Could not check credit cost.");
    }
  }

  async function confirmCreditAction() {
    if (!pendingCreditAction) {
      return;
    }

    setCreditConfirmLoading(true);
    try {
      await executeCreditAction(pendingCreditAction);
      setCreditConfirmOpen(false);
      setCreditPreview(undefined);
      setPendingCreditAction(undefined);
    } catch (confirmError) {
      handleRequestError(confirmError, "Credit action failed.");
    } finally {
      setCreditConfirmLoading(false);
    }
  }

  async function executeCreditAction(action: PendingCreditAction) {
    if (action.kind === "cache") {
      await executeCache(action.target, action.after);
      return;
    }

    await executeOpenPlayer(action.assetKey, action.result, action.options);
  }

  async function selectResult(result: ResultWithCache, variant: MediaVariant) {
    const target = variantToResult(result, variant);
    if (variant.cache?.status === "ready") {
      await requestCreditAction({
        kind: "playback",
        assetKey: variant.assetKey,
        result: target
      });
      return;
    }

    await requestCreditAction({
      kind: "cache",
      target
    });
  }

  async function executeCache(target: SearchResult, after?: "historyRecache") {
    setError("");
    setPlayback(undefined);
    setCacheRequestAssetKeys((currentKeys) => (
      currentKeys.includes(target.assetKey) ? currentKeys : [...currentKeys, target.assetKey]
    ));
    try {
      const response = await ensureCache(target);
      updateCurrentMemberCredits(response.memberCredits);
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
      if (after === "historyRecache") {
        navigateToTab("library");
        await refreshHistoryAssetStatus();
      }
    } catch (cacheError) {
      handleRequestError(cacheError, "Cache request failed.");
    } finally {
      setCacheRequestAssetKeys((currentKeys) => currentKeys.filter((assetKey) => assetKey !== target.assetKey));
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

    await requestCreditAction({
      kind: "playback",
      assetKey,
      result,
      options
    });
  }

  async function executeOpenPlayer(
    assetKey = asset?.assetKey,
    result?: SearchResult,
    options: { syncHistory?: boolean } = {}
  ) {
    if (!assetKey) {
      return;
    }

    try {
      const response = await getPlayback(assetKey);
      updateCurrentMemberCredits(response.memberCredits);
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

  async function refreshBrowseAssets(options: { append?: boolean } = {}) {
    const append = options.append === true;
    if (append) {
      if (browseLoadingMore || !browseHasMore) {
        return;
      }
      setBrowseLoadingMore(true);
    } else {
      setBrowseLoading(true);
    }

    try {
      const response = await browseAssets(browsePageLimit, append ? browseNextOffset : 0);
      setBrowseResults((currentResults) => {
        if (!append) {
          return response.results;
        }

        const currentKeys = new Set(currentResults.map((result) => result.assetKey));
        const nextResults = response.results.filter((result) => !currentKeys.has(result.assetKey));
        return [...currentResults, ...nextResults];
      });
      setBrowseHasMore(Boolean(response.hasMore));
      setBrowseNextOffset(response.nextOffset ?? 0);
    } catch (browseError) {
      handleRequestError(browseError, "Could not load browse titles.");
    } finally {
      if (append) {
        setBrowseLoadingMore(false);
      } else {
        setBrowseLoading(false);
      }
    }
  }

  async function recacheHistoryEntry(entry: PlaybackHistoryEntry) {
    if (!entry.result) {
      setError("Search this title again before re-caching it.");
      return;
    }

    await requestCreditAction({
      kind: "cache",
      target: entry.result,
      after: "historyRecache"
    });
  }

  function applyAuth(auth: AuthCheckResponse) {
    setRole(auth.role);
    setMember(auth.member);
    setAdminUnlocked(auth.role === "admin");
  }

  function updateCurrentMemberCredits(credits: NonNullable<AuthCheckResponse["member"]>["credits"]) {
    if (!credits) {
      return;
    }

    setMember((currentMember) => (
      currentMember
        ? {
          ...currentMember,
          credits
        }
        : currentMember
    ));
  }

  async function refreshMemberCodes() {
    if (!adminUnlocked) {
      return;
    }

    try {
      const [codesResponse, invitationsResponse] = await Promise.all([
        listMemberCodes(),
        listMemberInvitations()
      ]);
      setMemberCodes(codesResponse.codes);
      setMemberInvitations((currentInvitations) => invitationsResponse.invitations.map((invitation) => {
        const currentInvitation = currentInvitations.find((item) => item.id === invitation.id);
        return {
          ...invitation,
          code: currentInvitation?.code
        };
      }));
      setAdminError("");
    } catch (adminListError) {
      setAdminError(errorMessage(adminListError, "Could not load member access."));
    }
  }

  async function refreshLoginAudit() {
    if (!adminUnlocked) {
      return;
    }

    setLoginAuditLoading(true);
    try {
      const response = await listLoginAudit(loginAuditLimit);
      setLoginAudit(response.events);
      setAdminError("");
    } catch (auditError) {
      setAdminError(errorMessage(auditError, "Could not load login audit."));
    } finally {
      setLoginAuditLoading(false);
    }
  }

  async function refreshAdminMovieRequests() {
    if (!adminUnlocked) {
      return;
    }

    setAdminMovieRequestsLoading(true);
    try {
      const response = await listMovieRequests(movieRequestLimit);
      setAdminMovieRequests(response.requests);
      setAdminError("");
    } catch (requestError) {
      setAdminError(errorMessage(requestError, "Could not load movie requests."));
    } finally {
      setAdminMovieRequestsLoading(false);
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

  async function updateAdminMovieRequestStatus(id: string, status: MovieRequestStatus) {
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await updateMovieRequestStatusApi(id, { status });
      setAdminMovieRequests((currentRequests) => currentRequests.map((request) => (
        request.id === id ? response.request : request
      )));
    } catch (requestError) {
      setAdminError(errorMessage(requestError, "Could not update movie request."));
    } finally {
      setAdminLoading(false);
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
      const [codesResponse, invitationsResponse] = await Promise.all([
        listMemberCodes(),
        listMemberInvitations()
      ]);
      setMemberCodes(codesResponse.codes);
      setMemberInvitations(invitationsResponse.invitations);
      await refreshCachedAssets();
      try {
        const jobsResponse = await listCacheJobs(adminCacheJobLimit);
        setCacheJobs(jobsResponse.jobs);
      } catch (cacheJobError) {
        setAdminError(errorMessage(cacheJobError, "Could not load cache jobs."));
      }
      try {
        setAdminMovieRequestsLoading(true);
        const requestsResponse = await listMovieRequests(movieRequestLimit);
        setAdminMovieRequests(requestsResponse.requests);
      } catch (requestError) {
        setAdminError(errorMessage(requestError, "Could not load movie requests."));
      } finally {
        setAdminMovieRequestsLoading(false);
      }
      try {
        setLoginAuditLoading(true);
        const auditResponse = await listLoginAudit(loginAuditLimit);
        setLoginAudit(auditResponse.events);
      } catch (auditError) {
        setAdminError(errorMessage(auditError, "Could not load login audit."));
      } finally {
        setLoginAuditLoading(false);
      }
    } catch (adminAccessError) {
      setAccessKey(previousKey);
      setAdminError(errorMessage(adminAccessError, "Admin key did not match."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function generateSignupInvitation() {
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await createSignupInvitation({
        credits: Number.isFinite(memberCredits) && memberCredits >= 0 ? memberCredits : 20
      });
      setMemberInvitations((currentInvitations) => [
        response.invitation,
        ...currentInvitations.filter((invitation) => invitation.id !== response.invitation.id)
      ]);
      setMemberCredits(20);
    } catch (generateError) {
      setAdminError(errorMessage(generateError, "Could not generate invitation."));
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

  async function adjustMemberCredits(delta: number) {
    const normalizedDelta = Math.trunc(delta);
    if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
      setAdminError("Credit adjustment must be a non-zero number.");
      return;
    }

    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await adjustMemberCreditsApi({ delta: normalizedDelta });
      setMemberCodes((currentCodes) => response.codes.map((code) => {
        const currentCode = currentCodes.find((item) => item.id === code.id);
        return {
          ...code,
          code: currentCode?.code
        };
      }));
      setMemberCreditEdits({});
    } catch (creditUpdateError) {
      setAdminError(errorMessage(creditUpdateError, "Could not adjust member credits."));
    } finally {
      setAdminLoading(false);
    }
  }

  async function generateResetInvitation(id: string) {
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await createResetInvitation(id);
      setMemberInvitations((currentInvitations) => [
        response.invitation,
        ...currentInvitations.filter((invitation) => invitation.id !== response.invitation.id)
      ]);
    } catch (passcodeUpdateError) {
      setAdminError(errorMessage(passcodeUpdateError, "Could not create reset invitation."));
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

  async function openOwnCreditUsage() {
    setCreditUsageOpen(true);
    setCreditUsageLoading(true);
    setCreditUsageError("");
    setCreditUsage(undefined);
    try {
      const response = await listOwnCreditUsage(100);
      setCreditUsage(response);
      updateCurrentMemberCredits(response.member?.credits);
    } catch (usageError) {
      if (isUnauthorizedError(usageError)) {
        handleRequestError(usageError, "Could not load spending record.");
        return;
      }
      setCreditUsageError(errorMessage(usageError, "Could not load spending record."));
    } finally {
      setCreditUsageLoading(false);
    }
  }

  async function refreshOwnMovieRequests(showLoading = false) {
    if (role !== "member" && role !== "admin") {
      return;
    }

    if (ownMovieRequestsRefreshRef.current) {
      if (showLoading && !ownMovieRequestsLoaded) {
        setMovieRequestLoading(true);
      }
      try {
        await ownMovieRequestsRefreshRef.current;
      } finally {
        if (showLoading) {
          setMovieRequestLoading(false);
        }
      }
      return;
    }

    if (showLoading) {
      setMovieRequestLoading(true);
    }
    setMovieRequestError("");

    const refreshPromise = (async () => {
      const response = await listOwnMovieRequests(movieRequestLimit);
      setOwnMovieRequests(response.requests);
      setOwnMovieRequestsLoaded(true);
    })();
    ownMovieRequestsRefreshRef.current = refreshPromise;

    try {
      await refreshPromise;
    } catch (requestError) {
      if (isUnauthorizedError(requestError)) {
        handleRequestError(requestError, "Could not load requests.");
        return;
      }
      if (showLoading || movieRequestOpen) {
        setMovieRequestError(errorMessage(requestError, "Could not load requests."));
      }
    } finally {
      ownMovieRequestsRefreshRef.current = undefined;
      if (showLoading) {
        setMovieRequestLoading(false);
      }
    }
  }

  function openMovieRequestDialog() {
    setMovieRequestOpen(true);
    void refreshOwnMovieRequests(!ownMovieRequestsLoaded);
  }

  async function submitMovieRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = movieRequestText.trim();
    if (!text) {
      setMovieRequestError("Describe what you want to watch.");
      return;
    }

    setMovieRequestLoading(true);
    setMovieRequestError("");
    try {
      const response = await createMovieRequest({ text });
      setOwnMovieRequests((currentRequests) => [
        response.request,
        ...currentRequests.filter((request) => request.id !== response.request.id)
      ]);
      setOwnMovieRequestsLoaded(true);
      setMovieRequestText("");
    } catch (requestError) {
      if (isUnauthorizedError(requestError)) {
        handleRequestError(requestError, "Could not submit request.");
        return;
      }
      setMovieRequestError(errorMessage(requestError, "Could not submit request."));
    } finally {
      setMovieRequestLoading(false);
    }
  }

  async function openMemberCreditUsage(id: string) {
    setCreditUsageOpen(true);
    setCreditUsageLoading(true);
    setCreditUsageError("");
    setCreditUsage(undefined);
    try {
      const response = await listMemberCreditUsage(id, 100);
      setCreditUsage(response);
      setMemberCodes((currentCodes) => currentCodes.map((code) => (
        code.id === id && response.member
          ? { ...code, credits: response.member.credits }
          : code
      )));
    } catch (usageError) {
      if (isUnauthorizedError(usageError)) {
        handleRequestError(usageError, "Could not load member spending record.");
        return;
      }
      setCreditUsageError(errorMessage(usageError, "Could not load member spending record."));
    } finally {
      setCreditUsageLoading(false);
    }
  }

  async function saveOwnProfile(name: string, newPasscode?: string) {
    setProfileLoading(true);
    setProfileError("");
    try {
      const response = await updateMemberProfile({
        name,
        newPasscode
      });
      if (newPasscode) {
        setAccessKey(newPasscode);
      }
      setMember({
        id: response.code.id,
        name: response.code.name,
        credits: response.code.credits
      });
      setProfileOpen(false);
    } catch (profileUpdateError) {
      setProfileError(errorMessage(profileUpdateError, "Could not update profile."));
    } finally {
      setProfileLoading(false);
    }
  }

  function lockCinema() {
    clearAccessKey();
    setUnlocked(false);
    setRole(undefined);
    setMember(undefined);
    setProfileOpen(false);
    setProfileError("");
    setCreditUsageOpen(false);
    setCreditUsageError("");
    setCreditUsage(undefined);
    setCreditConfirmOpen(false);
    setCreditConfirmLoading(false);
    setCreditPreview(undefined);
    setPendingCreditAction(undefined);
    setMovieRequestOpen(false);
    setMovieRequestText("");
    setMovieRequestError("");
    setOwnMovieRequests([]);
    setOwnMovieRequestsLoaded(false);
    setAdminUnlocked(false);
    setActiveTab("library");
    setBrowseChannel("recommended");
    setQuery("");
    setResults([]);
    setBrowseResults([]);
    setBrowseLoading(false);
    setBrowseLoadingMore(false);
    setBrowseHasMore(false);
    setBrowseNextOffset(0);
    setPlayback(undefined);
    setJob(undefined);
    setAsset(undefined);
    setMemberCodes([]);
    setMemberInvitations([]);
    setMemberBulkCredits(1);
    setCacheJobs([]);
    setLoginAudit([]);
    setAdminMovieRequests([]);
    setTrackedItems([]);
    setCacheRequestAssetKeys([]);
    setCachedAssets([]);
    historyInitializedRef.current = false;
    writeRoute({
      tab: "library",
      browseChannel: "recommended",
      query: ""
    }, "replace");
  }

  useEffect(() => {
    if (!unlocked) {
      return;
    }

    function handleSearchShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openSearchDialog();
      }
    }

    window.addEventListener("keydown", handleSearchShortcut);
    return () => window.removeEventListener("keydown", handleSearchShortcut);
  }, [unlocked]);

  useEffect(() => {
    if (!searchOpen) {
      searchPreviewRequestRef.current += 1;
      setSearchDialogError("");
      setSearchPreviewLoading(false);
      return;
    }

    const normalizedQuery = query.trim();
    const requestId = searchPreviewRequestRef.current + 1;
    searchPreviewRequestRef.current = requestId;

    if (!normalizedQuery) {
      setSearchPreviewResults([]);
      setSearchDialogError("");
      setSearchPreviewLoading(false);
      return;
    }

    setSearchDialogError("");
    setSearchPreviewLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await searchAssets(normalizedQuery);
        if (searchPreviewRequestRef.current !== requestId) {
          return;
        }
        setSearchPreviewResults(response.results);
      } catch (previewError) {
        if (searchPreviewRequestRef.current !== requestId) {
          return;
        }
        if (isUnauthorizedError(previewError)) {
          handleRequestError(previewError, "Search failed.");
          return;
        }
        setSearchDialogError(cacheErrorLabel(errorMessage(previewError, "Search failed.")));
        setSearchPreviewResults([]);
      } finally {
        if (searchPreviewRequestRef.current === requestId) {
          setSearchPreviewLoading(false);
        }
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, searchOpen]);

  useEffect(() => {
    if (!unlocked) {
      return;
    }

    getCreditPolicy()
      .then(setCreditPolicy)
      .catch(() => {
        setCreditPolicy(defaultCreditPolicy);
      });
  }, [unlocked]);

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
      browseChannel: initialRoute.browseChannel,
      query,
      playerAssetKey: initialRoute.playerAssetKey
    });
    setActiveTab(initialPermittedRoute.tab);
    setBrowseChannel(initialPermittedRoute.browseChannel);
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
      setBrowseChannel(nextRoute.browseChannel);
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
      void refreshAdminMovieRequests();
      void refreshLoginAudit();
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
    if (activeTab === "cached" || activeTab === "tasks") {
      void refreshCachedAssets();
    }
  }, [activeTab]);

  useEffect(() => {
    if ((role === "member" || role === "admin") && !ownMovieRequestsLoaded) {
      void refreshOwnMovieRequests(false);
    }
  }, [role, ownMovieRequestsLoaded]);

  useEffect(() => {
    if (activeTab === "library" && cachedAssets.length === 0 && !cachedAssetsLoading) {
      void refreshCachedAssets();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "library" && query.trim().length === 0 && browseResults.length === 0) {
      void refreshBrowseAssets();
    }
  }, [activeTab, query]);

  if (!unlocked) {
    return <AccessGate onUnlock={(auth, options) => {
      setUnlocked(true);
      applyAuth(auth);
      if (options?.openProfile) {
        setProfileOpen(true);
      }
    }} />;
  }

  if (playback) {
    return <Player playback={playback} onClose={closePlayer} />;
  }

  const showAdmin = role === "admin";
  const accountLabel = role === "admin" ? "Admin" : member?.name ?? "Member";
  const accountDetail = role === "admin"
    ? "Admin"
    : member?.credits
      ? `${member.credits.remaining}${member.credits.unitSymbol}`
      : "Cinema member";

  return (
    <>
      <SearchDialog
        error={searchDialogError}
        loading={searchPreviewLoading || searchLoading}
        open={searchOpen}
        query={query}
        results={searchPreviewResults}
        onOpenChange={setSearchOpen}
        onQueryChange={setQuery}
        onSearch={(event) => void runDialogSearch(event)}
        onSelectResult={openSearchResult}
      />
      <ProfileDialog
        error={profileError}
        loading={profileLoading}
        member={member}
        open={profileOpen}
        onOpenChange={(open) => {
          setProfileOpen(open);
          if (!open) {
            setProfileError("");
          }
        }}
        onSubmit={(name, newPasscode) => void saveOwnProfile(name, newPasscode)}
      />
      <CreditUsageDialog
        error={creditUsageError}
        loading={creditUsageLoading}
        open={creditUsageOpen}
        usage={creditUsage}
        onOpenChange={(open) => {
          setCreditUsageOpen(open);
          if (!open) {
            setCreditUsageError("");
          }
        }}
      />
      <CreditConfirmDialog
        policy={creditPolicy}
        loading={creditConfirmLoading}
        open={creditConfirmOpen}
        preview={creditPreview}
        onCancel={closeCreditConfirm}
        onConfirm={() => void confirmCreditAction()}
      />
      <MovieRequestDialog
        error={movieRequestError}
        loading={movieRequestLoading}
        open={movieRequestOpen}
        requestText={movieRequestText}
        requests={ownMovieRequests}
        onOpenChange={(open) => {
          setMovieRequestOpen(open);
          if (!open) {
            setMovieRequestError("");
          }
        }}
        onRequestTextChange={setMovieRequestText}
        onSubmit={(event) => void submitMovieRequest(event)}
      />
      <CinemaLayout
        activeTab={activeTab}
        activeBrowseChannel={browseChannel}
        accountDetail={accountDetail}
        accountLabel={accountLabel}
        canChangePasscode={role === "member"}
        canRequestMovie={role === "member" || role === "admin"}
        showAdmin={showAdmin}
        onActiveTabChange={navigateToTab}
        onBrowseChannelChange={openBrowseChannel}
        onLock={lockCinema}
        onOpenHome={() => openBrowseChannel("recommended")}
        onOpenHelp={() => navigateToTab("help")}
        onOpenHistory={() => navigateToTab("history")}
        onOpenMovieRequest={openMovieRequestDialog}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenSpending={() => void openOwnCreditUsage()}
        onOpenTasks={() => navigateToTab("tasks")}
        onOpenSearch={openSearchDialog}
        library={(
          <LibraryTab
            creditPolicy={creditPolicy}
            query={query}
            error={error}
            focusedAssetKey={focusedLibraryAssetKey}
            viewMode={libraryViewMode}
            results={results}
            browseChannel={browseChannel}
            browseResults={browseResults}
            browseLoading={browseLoading}
            browseLoadingMore={browseLoadingMore}
            browseHasMore={browseHasMore}
            cachedAssets={cachedAssets}
            historyItems={history}
            trackedItems={trackedItems}
            pendingAssetKeys={cacheRequestAssetKeys}
            trackedByAssetKey={trackedByAssetKey}
            onOpenCachedAsset={(assetKey) => void openPlayer(assetKey)}
            onFocusedAssetHandled={() => setFocusedLibraryAssetKey(undefined)}
            onLoadMoreBrowse={() => void refreshBrowseAssets({ append: true })}
            onViewModeChange={setLibraryViewMode}
            onSelect={(selectedResult, variant) => void selectResult(selectedResult, variant)}
          />
        )}
        cached={(
          <CachedShelf
            cachedAssets={cachedAssets}
            creditPolicy={creditPolicy}
            loading={cachedAssetsLoading}
            onOpen={(assetKey) => void openPlayer(assetKey)}
            onRefresh={() => void refreshCachedAssets()}
          />
        )}
        history={(
          <HistoryPanel
            creditPolicy={creditPolicy}
            items={history}
            statusByAssetKey={historyAssetStatus}
            onClear={clearHistory}
            onPlay={(assetKey, result) => void openPlayer(assetKey, result)}
            onRecache={(entry) => void recacheHistoryEntry(entry)}
          />
        )}
        help={<HelpPanel />}
        tasks={(
          <CacheTasksPanel
            cachedAssets={cachedAssets}
            creditPolicy={creditPolicy}
            currentMemberId={member?.id}
            loadingCached={cachedAssetsLoading}
            preparingItems={trackedItems}
            onOpenPlayer={(assetKey, result) => void openPlayer(assetKey, result)}
            onRefreshCached={() => void refreshCachedAssets()}
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
            loginAudit={loginAudit}
            loginAuditLoading={loginAuditLoading}
            movieRequests={adminMovieRequests}
            movieRequestsLoading={adminMovieRequestsLoading}
            adminKeyInput={adminKeyInput}
            memberCredits={memberCredits}
            memberBulkCredits={memberBulkCredits}
            memberCreditEdits={memberCreditEdits}
            memberCodes={memberCodes}
            memberInvitations={memberInvitations}
            setAdminKeyInput={setAdminKeyInput}
            setMemberCredits={setMemberCredits}
            setMemberBulkCredits={setMemberBulkCredits}
            setMemberCreditEdit={setMemberCreditEdit}
            onUnlock={unlockAdmin}
            onGenerate={generateSignupInvitation}
            onCopy={(code) => void copyMemberCode(code)}
            onDelete={deleteMemberCode}
            onRefreshJobs={() => void refreshCacheJobs()}
            onRefreshCachedAssets={() => void refreshCachedAssets()}
            onRefreshLoginAudit={() => void refreshLoginAudit()}
            onRefreshMovieRequests={() => void refreshAdminMovieRequests()}
            onRetryCacheJob={(jobId) => void retryAdminCacheJob(jobId)}
            onDeleteCacheJob={(jobId) => void deleteAdminCacheJob(jobId)}
            onDeleteCachedAsset={(assetKey) => void deleteAdminCachedAsset(assetKey)}
            onUpdateCredits={updateMemberCredits}
            onAdjustCredits={(delta) => void adjustMemberCredits(delta)}
            onCreateResetInvitation={generateResetInvitation}
            onUpdateMovieRequestStatus={(id, status) => void updateAdminMovieRequestStatus(id, status)}
            onViewCreditUsage={(id) => void openMemberCreditUsage(id)}
            onRevoke={revokeMemberCode}
          />
        ) : undefined}
      />
      {activeTab !== "tasks" ? (
        <TaskDock
          creditPolicy={creditPolicy}
          items={trackedItems}
          onOpenPlayer={(assetKey, result) => void openPlayer(assetKey, result)}
          onOpenTasks={() => navigateToTab("tasks")}
        />
      ) : null}
    </>
  );
}
