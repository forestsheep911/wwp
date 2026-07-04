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
  ForumThreadEntry,
  ForumThreadSummary,
  MemberCreditUsageResponse,
  MemberNoticeEntry,
  MovieRequestEntry,
  MovieRequestStatus,
  PlaybackResponse,
  SearchResponse,
  SearchResult
} from "@wwpdw/shared";
import {
  adjustMemberCredits as adjustMemberCreditsApi,
  browseAssets,
  browseHomeAssets,
  checkAccess,
  clearAccessKey,
  createAdminNotice,
  createForumReply,
  createForumThread,
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
  getDirectDownload,
  getForumThread,
  getCreditPolicy,
  getPlayback,
  isUnauthorizedError,
  listCachedAssets,
  listCacheJobs,
  listForumThreads,
  listMemberInvitations,
  listLoginAudit,
  listMemberCodes,
  listMemberCreditUsage,
  listAdminNotices,
  listMovieRequests,
  listOwnMovieRequests,
  listOwnNotices,
  listOwnCreditUsage,
  markOwnNoticeRead,
  previewCredit,
  revokeMemberAccessCode,
  retryCacheJob,
  searchAssets,
  setMemberCredits as setMemberCreditsApi,
  updateMemberProfile,
  updateMovieRequestStatus as updateMovieRequestStatusApi,
  setAccessKey,
  wakeBackend
} from "./api";
import { AccessGate } from "./cinema/components/AccessGate";
import { AdminPanel } from "./cinema/components/AdminPanel";
import { CacheTasksPanel } from "./cinema/components/CacheTasksPanel";
import { CachedShelf } from "./cinema/components/CachedShelf";
import { CinemaLayout } from "./cinema/components/CinemaLayout";
import { CreditConfirmDialog } from "./cinema/components/CreditConfirmDialog";
import { CreditUsageDialog } from "./cinema/components/CreditUsageDialog";
import { FavoritesPanel } from "./cinema/components/FavoritesPanel";
import { ForumPanel } from "./cinema/components/ForumPanel";
import { HelpPanel } from "./cinema/components/HelpPanel";
import { HistoryPanel } from "./cinema/components/HistoryPanel";
import { LibraryTab } from "./cinema/components/LibraryTab";
import { MovieRequestDialog } from "./cinema/components/MovieRequestDialog";
import { NoticeInboxDialog } from "./cinema/components/NoticeInboxDialog";
import { NowPlayingPanel } from "./cinema/components/NowPlayingPanel";
import { Player } from "./cinema/components/Player";
import { ProfileDialog } from "./cinema/components/ProfileDialog";
import { SearchDialog } from "./cinema/components/SearchDialog";
import { ServiceWakeDialog, serviceWakeDelayMs } from "./cinema/components/ServiceWakeDialog";
import { TaskDock } from "./cinema/components/TaskDock";
import { WatchlistPanel } from "./cinema/components/WatchlistPanel";
import { ToastProvider, useToast } from "./components/ui/toast";
import { cacheErrorLabel } from "./cinema/format";
import { copy } from "./cinema/i18n";
import { triggerDirectDownload } from "./cinema/download";
import {
  cinemaHistoryState,
  defaultBrowseView,
  historyStateRoute,
  routeFromLocation,
  routeUrl,
  sameRoute,
  type CinemaRoute
} from "./cinema/routing";
import {
  favoriteStorageKey,
  historyStorageKey,
  memberScopedStorageKey,
  readJsonStorage,
  themeStorageKey,
  writeJsonStorage
} from "./cinema/storage";
import type {
  AppTab,
  AppTheme,
  BrowseChannel,
  BrowseViewId,
  CollectionMark,
  FavoriteEntry,
  HistoryAssetStatusMap,
  LibraryViewMode,
  ManagedMemberCode,
  ManagedMemberInvitation,
  PlaybackHistoryEntry,
  ResultWithCache,
  TrackedCacheItem
} from "./cinema/types";
import { defaultCreditPolicy } from "./cinema/types";

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

const browsePageLimit = 48;
const browseCatalogPageLimit = 100;
const browseFullViewLimit = 300;
const tspdtBrowseCatalogLimit = 2000;
const browseCacheFallbackMs = 2200;
type BrowseLoadMode = "paged" | "random";
type BrowseOriginOutcome =
  | { ok: true; response: SearchResponse }
  | { ok: false; error: unknown };

function canPreviewServiceWakeDialog() {
  if (!import.meta.env.DEV) {
    return false;
  }

  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

function shouldOpenServiceWakePreview() {
  if (!canPreviewServiceWakeDialog()) {
    return false;
  }

  return new URLSearchParams(window.location.search).has("wake");
}

interface BrowseViewCacheEntry {
  results: ResultWithCache[];
  hasMore: boolean;
  nextOffset: number;
  mode: BrowseLoadMode;
}

function isAppTheme(value: unknown): value is AppTheme {
  return value === "dark" || value === "light";
}

function readStoredTheme(): AppTheme {
  const storedTheme = readJsonStorage<unknown>(themeStorageKey, "dark");
  return isAppTheme(storedTheme) ? storedTheme : "dark";
}

function favoriteKeyForIdentity(role?: AccessRole, memberId?: string) {
  return memberScopedStorageKey(favoriteStorageKey, memberId ?? role ?? "guest");
}

function normalizeFavorites(entries: FavoriteEntry[]) {
  return entries.map((entry) => {
    if (entry.favoriteAt || entry.wantToWatchAt || entry.watchedAt) {
      return entry;
    }

    return {
      ...entry,
      favoriteAt: entry.addedAt
    };
  });
}

function hasCollectionMarks(entry: FavoriteEntry) {
  return Boolean(entry.favoriteAt || entry.wantToWatchAt || entry.watchedAt);
}

function CinemaApp() {
  const { showToast } = useToast();
  const [initialRoute] = useState<CinemaRoute>(() => routeFromLocation());
  const [hasStoredAccessKey] = useState(() => Boolean(getAccessKey()));
  const [unlocked, setUnlocked] = useState(hasStoredAccessKey);
  const [authRestoring, setAuthRestoring] = useState(hasStoredAccessKey);
  const [role, setRole] = useState<AccessRole | undefined>();
  const [member, setMember] = useState<AuthCheckResponse["member"]>();
  const [activeTab, setActiveTab] = useState<AppTab>(initialRoute.tab);
  const [browseChannel, setBrowseChannel] = useState<BrowseChannel>(initialRoute.browseChannel);
  const [browseView, setBrowseView] = useState<BrowseViewId>(initialRoute.browseView);
  const [theme, setTheme] = useState<AppTheme>(() => readStoredTheme());
  const [libraryViewMode, setLibraryViewMode] = useState<LibraryViewMode>("gallery");
  const [query, setQuery] = useState(initialRoute.query);
  const [detailAssetKey, setDetailAssetKey] = useState<string | undefined>(initialRoute.detailAssetKey);
  const [results, setResults] = useState<ResultWithCache[]>([]);
  const [browseResults, setBrowseResults] = useState<ResultWithCache[]>([]);
  const [browseLoading, setBrowseLoading] = useState(
    () => initialRoute.tab === "library" && initialRoute.query.trim().length === 0
  );
  const [browseLoadingMore, setBrowseLoadingMore] = useState(false);
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseNextOffset, setBrowseNextOffset] = useState(0);
  const [browseLoadMode, setBrowseLoadMode] = useState<BrowseLoadMode>("random");
  const browseViewCacheRef = useRef(new Map<string, BrowseViewCacheEntry>());
  const [job, setJob] = useState<CacheJob | undefined>();
  const [asset, setAsset] = useState<CacheAsset | undefined>();
  const [trackedItems, setTrackedItems] = useState<TrackedCacheItem[]>([]);
  const [playback, setPlayback] = useState<PlaybackResponse | undefined>();
  const [downloadRequestAssetKeys, setDownloadRequestAssetKeys] = useState<string[]>([]);
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
  const [noticeInboxOpen, setNoticeInboxOpen] = useState(false);
  const [noticeLoading, setNoticeLoading] = useState(false);
  const [noticeError, setNoticeError] = useState("");
  const [ownNotices, setOwnNotices] = useState<MemberNoticeEntry[]>([]);
  const [ownNoticesLoaded, setOwnNoticesLoaded] = useState(false);
  const [adminNotices, setAdminNotices] = useState<MemberNoticeEntry[]>([]);
  const [adminNoticesLoading, setAdminNoticesLoading] = useState(false);
  const [forumThreads, setForumThreads] = useState<ForumThreadSummary[]>([]);
  const [forumThread, setForumThread] = useState<ForumThreadEntry | undefined>();
  const [forumThreadsLoaded, setForumThreadsLoaded] = useState(false);
  const [forumLoading, setForumLoading] = useState(false);
  const [forumThreadLoading, setForumThreadLoading] = useState(false);
  const [forumSubmitting, setForumSubmitting] = useState(false);
  const [forumReplySubmitting, setForumReplySubmitting] = useState(false);
  const [forumError, setForumError] = useState("");
  const [forumDraftTitle, setForumDraftTitle] = useState("");
  const [forumDraftBody, setForumDraftBody] = useState("");
  const [forumReplyText, setForumReplyText] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPreviewLoading, setSearchPreviewLoading] = useState(false);
  const [searchPreviewResults, setSearchPreviewResults] = useState<ResultWithCache[]>([]);
  const [searchDialogError, setSearchDialogError] = useState("");
  const [showServiceWakeDialog, setShowServiceWakeDialog] = useState(false);
  const [serviceWakePreviewOpen, setServiceWakePreviewOpen] = useState(() => shouldOpenServiceWakePreview());
  const [focusedLibraryAssetKey, setFocusedLibraryAssetKey] = useState<string | undefined>();
  const [cacheRequestAssetKeys, setCacheRequestAssetKeys] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [history, setHistory] = useState<PlaybackHistoryEntry[]>(() => readJsonStorage(historyStorageKey, []));
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
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
  const forumThreadLimit = 80;
  const historyInitializedRef = useRef(false);
  const ownMovieRequestsRefreshRef = useRef<Promise<void> | undefined>(undefined);
  const searchPreviewRequestRef = useRef(0);
  const forumThreadsAutoLoadRef = useRef(false);
  const browseRouteLoadRef = useRef("");

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

  const favoriteAssetKeys = useMemo(
    () => new Set(favorites.filter((item) => item.favoriteAt).map((item) => item.assetKey)),
    [favorites]
  );

  const collectionMarksByAssetKey = useMemo(() => {
    const marks = new Map<string, FavoriteEntry>();
    favorites.forEach((item) => marks.set(item.assetKey, item));
    return marks;
  }, [favorites]);

  const serviceWakeActive = unlocked && (
    authRestoring ||
    (activeTab === "library" && query.trim().length === 0 && browseLoading && browseResults.length === 0) ||
    (activeTab === "watchlist" && browseLoading && browseResults.length === 0) ||
    ((activeTab === "cached" || activeTab === "favorites" || activeTab === "tasks") && cachedAssetsLoading && cachedAssets.length === 0) ||
    (activeTab === "forum" && forumLoading && forumThreads.length === 0)
  );
  const serviceWakePreviewEnabled = canPreviewServiceWakeDialog();
  const serviceWakeDialogOpen = serviceWakePreviewOpen || (showServiceWakeDialog && serviceWakeActive);

  function handleServiceWakeDialogOpenChange(open: boolean) {
    setShowServiceWakeDialog(open);
    if (!open) {
      setServiceWakePreviewOpen(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    writeJsonStorage(themeStorageKey, theme);
  }, [theme]);

  useEffect(() => {
    if (!serviceWakeActive) {
      setShowServiceWakeDialog(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowServiceWakeDialog(true);
    }, serviceWakeDelayMs);

    return () => window.clearTimeout(timer);
  }, [serviceWakeActive]);

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
    const state = cinemaHistoryState(nextRoute);
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
      browseView,
      query,
      detailAssetKey,
      playerAssetKey: playback?.assetKey,
      ...overrides
    };
  }

  function navigateToTab(nextTab: AppTab) {
    const nextRoute = permittedRoute(routeForCurrentView({
      tab: nextTab,
      detailAssetKey: undefined,
      playerAssetKey: undefined
    }));
    setPlayback(undefined);
    setDetailAssetKey(undefined);
    setActiveTab(nextRoute.tab);
    writeRoute(nextRoute, "push");
  }

  function openBrowseChannel(nextChannel: BrowseChannel) {
    const nextBrowseView = defaultBrowseView(nextChannel);
    setBrowseChannel(nextChannel);
    setBrowseView(nextBrowseView);
    setDetailAssetKey(undefined);
    setError("");
    setQuery("");
    setResults([]);
    setPlayback(undefined);
    setActiveTab("library");
    browseRouteLoadRef.current = browseRouteLoadKey(nextChannel, nextBrowseView);
    writeRoute({
      tab: "library",
      browseChannel: nextChannel,
      browseView: nextBrowseView,
      query: "",
      detailAssetKey: undefined,
      playerAssetKey: undefined
    }, "push");
    void refreshBrowseAssets({ channel: nextChannel, view: nextBrowseView });
  }

  function browseLoadModeForView(view: BrowseViewId): BrowseLoadMode {
    return view === "lucky" ? "random" : "paged";
  }

  function browseLimitForView(view: BrowseViewId) {
    return view === "lucky"
      ? browsePageLimit
      : view === "tspdtRank"
        ? tspdtBrowseCatalogLimit
        : view === "popular" || view === "mostWatched"
          ? browseFullViewLimit
          : browseCatalogPageLimit;
  }

  function browseRouteLoadKey(channel: BrowseChannel, view: BrowseViewId) {
    return `${channel}:${view}`;
  }

  function openBrowseView(nextView: BrowseViewId, options: { refresh?: boolean } = {}) {
    const routeMode = options.refresh && nextView === browseView ? "replace" : "push";
    setBrowseView(nextView);
    setDetailAssetKey(undefined);
    setPlayback(undefined);
    browseRouteLoadRef.current = browseRouteLoadKey(browseChannel, nextView);
    writeRoute({
      tab: "library",
      browseChannel,
      browseView: nextView,
      query: "",
      detailAssetKey: undefined,
      playerAssetKey: undefined
    }, routeMode);
    void refreshBrowseAssets({
      mode: browseLoadModeForView(nextView),
      limit: browseLimitForView(nextView),
      view: nextView,
      force: options.refresh === true
    });
  }

  function openLibraryDetail(result: ResultWithCache) {
    setDetailAssetKey(result.assetKey);
    setFocusedLibraryAssetKey(result.assetKey);
    setPlayback(undefined);
    writeRoute(routeForCurrentView({
      tab: "library",
      detailAssetKey: result.assetKey,
      playerAssetKey: undefined
    }), "push");
  }

  function closeLibraryDetail() {
    setDetailAssetKey(undefined);
    writeRoute(routeForCurrentView({
      detailAssetKey: undefined,
      playerAssetKey: undefined
    }), "replace");
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
      setAuthRestoring(false);
      clearAccessKey();
      setUnlocked(false);
      setRole(undefined);
      setAdminUnlocked(false);
      setPlayback(undefined);
      setJob(undefined);
      setAsset(undefined);
      setTrackedItems([]);
      setCacheRequestAssetKeys([]);
      setDownloadRequestAssetKeys([]);
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
      handleRequestError(searchError, copy.fallbackErrors.searchFailed);
    } finally {
      if (options.showLoading) {
        setSearchLoading(false);
      }
    }
  }

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const normalizedQuery = query.trim();
    setDetailAssetKey(undefined);
    await refreshResults({ showLoading: true, activateLibrary: true }, normalizedQuery);
    writeRoute({
      tab: "library",
      browseChannel,
      browseView,
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
    setDetailAssetKey(result.assetKey);
    setSearchOpen(false);
    writeRoute({
      tab: "library",
      browseChannel,
      browseView,
      query: normalizedQuery,
      detailAssetKey: result.assetKey,
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
      handleRequestError(previewError, copy.fallbackErrors.checkCredit);
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
      handleRequestError(confirmError, copy.fallbackErrors.creditAction);
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

  async function downloadResult(result: ResultWithCache, variant: MediaVariant) {
    const target = variantToResult(result, variant);
    setError("");
    setDownloadRequestAssetKeys((currentKeys) => (
      currentKeys.includes(target.assetKey) ? currentKeys : [...currentKeys, target.assetKey]
    ));
    const pendingWindow = window.open("about:blank", "_blank");
    try {
      const response = await getDirectDownload(target);
      triggerDirectDownload(response.downloadUrl, pendingWindow, response.title);
    } catch (downloadError) {
      pendingWindow?.close();
      handleRequestError(downloadError, copy.fallbackErrors.directDownload);
    } finally {
      setDownloadRequestAssetKeys((currentKeys) => currentKeys.filter((assetKey) => assetKey !== target.assetKey));
    }
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
      handleRequestError(cacheError, copy.fallbackErrors.cacheRequest);
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
      handleRequestError(playbackError, copy.fallbackErrors.playbackNotReady);
    }
  }

  async function renewCurrentPlayback(assetKey: string) {
    try {
      const preview = await previewCreditAction({
        kind: "playback",
        assetKey,
        options: { syncHistory: false }
      });

      if (preview.chargeable) {
        setPendingCreditAction({
          kind: "playback",
          assetKey,
          options: { syncHistory: false }
        });
        setCreditPreview(preview);
        setCreditConfirmOpen(true);
        return undefined;
      }

      const response = await getPlayback(assetKey);
      updateCurrentMemberCredits(response.memberCredits);
      setPlayback((currentPlayback) => (
        currentPlayback?.assetKey === assetKey ? response : currentPlayback
      ));
      rememberPlayback(response);
      return response;
    } catch (renewError) {
      handleRequestError(renewError, copy.fallbackErrors.playbackNotReady);
      return undefined;
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

  function writeFavorites(nextFavorites: FavoriteEntry[]) {
    const storageKey = favoriteKeyForIdentity(role, member?.id);
    writeJsonStorage(storageKey, nextFavorites);
  }

  function updateCollectionMark(result: ResultWithCache, mark: CollectionMark) {
    setFavorites((currentFavorites) => {
      const now = new Date().toISOString();
      const currentEntry = currentFavorites.find((item) => item.assetKey === result.assetKey);
      const baseEntry: FavoriteEntry = currentEntry ?? {
        assetKey: result.assetKey,
        title: result.title,
        addedAt: now,
        result
      };
      const nextEntry: FavoriteEntry = {
        ...baseEntry,
        title: result.title,
        result
      };

      if (mark === "favorite") {
        nextEntry.favoriteAt = nextEntry.favoriteAt ? undefined : now;
      } else if (mark === "wantToWatch") {
        const active = Boolean(nextEntry.wantToWatchAt);
        nextEntry.wantToWatchAt = active ? undefined : now;
        if (!active) {
          nextEntry.watchedAt = undefined;
        }
      } else {
        const active = Boolean(nextEntry.watchedAt);
        nextEntry.watchedAt = active ? undefined : now;
        if (!active) {
          nextEntry.wantToWatchAt = undefined;
        }
      }

      const withoutCurrent = currentFavorites.filter((item) => item.assetKey !== result.assetKey);
      const nextFavorites = hasCollectionMarks(nextEntry) ? [nextEntry, ...withoutCurrent] : withoutCurrent;
      writeFavorites(nextFavorites);
      return nextFavorites;
    });
  }

  function toggleFavorite(result: ResultWithCache) {
    updateCollectionMark(result, "favorite");
  }

  function removeCollectionMark(assetKey: string, mark: CollectionMark) {
    setFavorites((currentFavorites) => {
      const nextFavorites = currentFavorites.flatMap((item) => {
        if (item.assetKey !== assetKey) {
          return [item];
        }

        const nextItem: FavoriteEntry = { ...item };
        if (mark === "favorite") {
          nextItem.favoriteAt = undefined;
        } else if (mark === "wantToWatch") {
          nextItem.wantToWatchAt = undefined;
        } else {
          nextItem.watchedAt = undefined;
        }

        return hasCollectionMarks(nextItem) ? [nextItem] : [];
      });
      writeFavorites(nextFavorites);
      return nextFavorites;
    });
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
      handleRequestError(historyStatusError, copy.fallbackErrors.historyStatus);
    }
  }

  async function refreshCachedAssets() {
    setCachedAssetsLoading(true);
    try {
      const response = await listCachedAssets(100);
      setCachedAssets(response.items.map((item) => item.asset));
    } catch (cachedAssetsError) {
      handleRequestError(cachedAssetsError, copy.fallbackErrors.cachedTitles);
    } finally {
      setCachedAssetsLoading(false);
    }
  }

  function browseViewCacheKey(channel: BrowseChannel, view?: BrowseViewId) {
    return view ? `${channel}:${view}` : undefined;
  }

  function applyBrowseCache(entry: BrowseViewCacheEntry) {
    setBrowseResults(entry.results);
    setBrowseHasMore(entry.hasMore);
    setBrowseNextOffset(entry.nextOffset);
    setBrowseLoadMode(entry.mode);
  }

  function applyBrowseResponse(
    response: { results: ResultWithCache[]; hasMore?: boolean; nextOffset?: number; mode?: BrowseLoadMode },
    append: boolean,
    mode: BrowseLoadMode,
    cacheKey?: string
  ) {
    setBrowseResults((currentResults) => {
      const currentKeys = new Set(currentResults.map((result) => result.assetKey));
      const nextResults = append
        ? [...currentResults, ...response.results.filter((result) => !currentKeys.has(result.assetKey))]
        : response.results;
      if (cacheKey) {
        browseViewCacheRef.current.set(cacheKey, {
          results: nextResults,
          hasMore: Boolean(response.hasMore),
          nextOffset: response.nextOffset ?? 0,
          mode: response.mode ?? mode
        });
      }
      return nextResults;
    });
    setBrowseHasMore(Boolean(response.hasMore));
    setBrowseNextOffset(response.nextOffset ?? 0);
    setBrowseLoadMode(response.mode ?? mode);
  }

  function browseCacheFallbackTimeout() {
    return new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("Browse cache fallback timed out.")), browseCacheFallbackMs);
    });
  }

  async function browseAssetsWithCacheFallback(
    limit: number,
    offset: number,
    options: { mode: BrowseLoadMode; channel: BrowseChannel; view?: BrowseViewId }
  ) {
    const originRequest = browseAssets(limit, offset, options);
    const cacheEligible = offset === 0 && options.mode === "paged" && options.view !== "lucky";
    if (cacheEligible) {
      const cachedRequest = browseHomeAssets(limit, offset, options).catch(() => undefined);
      const originOutcome: Promise<BrowseOriginOutcome> = originRequest
        .then((response) => ({ ok: true, response }) as const)
        .catch((error: unknown) => ({ ok: false, error }) as const);
      const firstOutcome = await Promise.race([
        originOutcome,
        browseCacheFallbackTimeout().catch(() => undefined)
      ]);

      if (firstOutcome?.ok) {
        return firstOutcome.response;
      }

      if (firstOutcome && !firstOutcome.ok && isUnauthorizedError(firstOutcome.error)) {
        throw firstOutcome.error;
      }

      const cachedResponse = await cachedRequest;
      if (cachedResponse) {
        return cachedResponse;
      }

      const finalOutcome = await originOutcome;
      if (finalOutcome.ok) {
        return finalOutcome.response;
      }

      throw finalOutcome.error;
    }

    try {
      return await originRequest;
    } catch (browseError) {
      if (isUnauthorizedError(browseError)) {
        throw browseError;
      }

      const cachedResponse = await Promise.race([
        browseHomeAssets(limit, offset, options),
        browseCacheFallbackTimeout()
      ]).catch(() => undefined);

      if (cachedResponse) {
        return cachedResponse;
      }

      throw browseError;
    }
  }

  async function refreshBrowseAssets(
    options: { append?: boolean; mode?: BrowseLoadMode; limit?: number; channel?: BrowseChannel; view?: BrowseViewId; force?: boolean } = {}
  ) {
    const append = options.append === true;
    const requestView = options.view ?? browseView;
    const mode = options.mode ?? (append || requestView !== "lucky" ? "paged" : "random");
    const limit = options.limit ?? (mode === "paged" ? browseCatalogPageLimit : browsePageLimit);
    const requestChannel = options.channel ?? browseChannel;
    const cacheKey = browseViewCacheKey(requestChannel, requestView);
    const cachedBrowseView = !append && !options.force && cacheKey ? browseViewCacheRef.current.get(cacheKey) : undefined;
    if (cachedBrowseView) {
      applyBrowseCache(cachedBrowseView);
      return;
    }
    if (append) {
      if (browseLoadingMore || !browseHasMore) {
        return;
      }
      setBrowseLoadingMore(true);
    } else {
      if (requestView === "lucky") {
        setBrowseResults([]);
        setBrowseHasMore(false);
        setBrowseNextOffset(0);
        setBrowseLoadMode("random");
      }
      setBrowseLoading(true);
    }

    try {
      const offset = append ? browseNextOffset : 0;
      const response = append
        ? await browseAssets(limit, offset, { mode, channel: requestChannel, view: requestView })
        : await browseAssetsWithCacheFallback(limit, offset, { mode, channel: requestChannel, view: requestView });

      applyBrowseResponse(response, append, mode, cacheKey);
    } catch (browseError) {
      handleRequestError(browseError, copy.fallbackErrors.browseTitles);
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
      setError(copy.history.recacheHint);
      return;
    }

    await requestCreditAction({
      kind: "cache",
      target: entry.result,
      after: "historyRecache"
    });
  }

  function applyAuth(auth: AuthCheckResponse) {
    setAuthRestoring(false);
    setRole(auth.role);
    setMember(auth.member);
    setAdminUnlocked(auth.role === "admin");
    setFavorites(normalizeFavorites(readJsonStorage<FavoriteEntry[]>(favoriteKeyForIdentity(auth.role, auth.member?.id), [])));
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
      setAdminError(errorMessage(adminListError, copy.fallbackErrors.memberAccess));
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
      setAdminError(errorMessage(auditError, copy.fallbackErrors.loginAudit));
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
      setAdminError(errorMessage(requestError, copy.fallbackErrors.movieRequests));
    } finally {
      setAdminMovieRequestsLoading(false);
    }
  }

  async function refreshAdminNotices() {
    if (!adminUnlocked) {
      return;
    }

    setAdminNoticesLoading(true);
    try {
      const response = await listAdminNotices(100);
      setAdminNotices(response.notices);
      setAdminError("");
    } catch (noticeListError) {
      setAdminError(errorMessage(noticeListError, "无法加载站内信。"));
    } finally {
      setAdminNoticesLoading(false);
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
      setAdminError(errorMessage(cacheJobError, copy.fallbackErrors.cacheJobs));
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
      setAdminError(errorMessage(retryError, copy.fallbackErrors.retryCacheJob));
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
      setAdminError(errorMessage(deleteError, copy.fallbackErrors.deleteCacheEntry));
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
      setAdminError(errorMessage(deleteError, copy.fallbackErrors.deleteCachedVideo));
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
      setAdminError(errorMessage(requestError, copy.fallbackErrors.updateMovieRequest));
    } finally {
      setAdminLoading(false);
    }
  }

  async function createMemberNotice(input: Parameters<typeof createAdminNotice>[0]) {
    setAdminLoading(true);
    setAdminError("");
    try {
      const response = await createAdminNotice(input);
      setAdminNotices((currentNotices) => [
        response.notice,
        ...currentNotices.filter((notice) => notice.id !== response.notice.id)
      ]);
      showToast({
        title: "站内信已发送",
        description: response.notice.audience === "all" ? "所有成员都会看到这条公告。" : "目标成员会在站内信里看到它。",
        variant: "success"
      });
    } catch (noticeError) {
      setAdminError(errorMessage(noticeError, "无法发送站内信。"));
    } finally {
      setAdminLoading(false);
    }
  }

  async function unlockAdmin() {
    const candidate = adminKeyInput.trim();
    if (!candidate) {
      setAdminError(copy.admin.errors.enterAdminKey);
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
        setAdminError(copy.admin.errors.notAdminKey);
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
        setAdminError(errorMessage(cacheJobError, copy.fallbackErrors.cacheJobs));
      }
      try {
        setAdminMovieRequestsLoading(true);
        const requestsResponse = await listMovieRequests(movieRequestLimit);
        setAdminMovieRequests(requestsResponse.requests);
      } catch (requestError) {
        setAdminError(errorMessage(requestError, copy.fallbackErrors.movieRequests));
      } finally {
        setAdminMovieRequestsLoading(false);
      }
      try {
        setAdminNoticesLoading(true);
        const noticesResponse = await listAdminNotices(100);
        setAdminNotices(noticesResponse.notices);
      } catch (noticeError) {
        setAdminError(errorMessage(noticeError, "无法加载站内信。"));
      } finally {
        setAdminNoticesLoading(false);
      }
      try {
        setLoginAuditLoading(true);
        const auditResponse = await listLoginAudit(loginAuditLimit);
        setLoginAudit(auditResponse.events);
      } catch (auditError) {
        setAdminError(errorMessage(auditError, copy.fallbackErrors.loginAudit));
      } finally {
        setLoginAuditLoading(false);
      }
    } catch (adminAccessError) {
      setAccessKey(previousKey);
      setAdminError(errorMessage(adminAccessError, copy.fallbackErrors.adminKey));
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
      showToast({
        title: copy.toast.signupInviteCreated.title,
        description: copy.toast.signupInviteCreated.description,
        variant: "success"
      });
    } catch (generateError) {
      setAdminError(errorMessage(generateError, copy.fallbackErrors.generateInvitation));
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
      setAdminError(copy.admin.errors.creditNonNegative);
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
      setAdminError(errorMessage(creditUpdateError, copy.fallbackErrors.updateCredits));
    } finally {
      setAdminLoading(false);
    }
  }

  async function adjustMemberCredits(delta: number) {
    const normalizedDelta = Math.trunc(delta);
    if (!Number.isFinite(normalizedDelta) || normalizedDelta === 0) {
      setAdminError(copy.admin.errors.creditAdjustment);
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
      setAdminError(errorMessage(creditUpdateError, copy.fallbackErrors.adjustCredits));
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
      showToast({
        title: copy.toast.resetInviteCreated.title,
        description: copy.toast.resetInviteCreated.description,
        variant: "success"
      });
    } catch (passcodeUpdateError) {
      setAdminError(errorMessage(passcodeUpdateError, copy.fallbackErrors.resetInvitation));
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
      setAdminError(errorMessage(revokeError, copy.fallbackErrors.revokeCode));
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
      setAdminError(errorMessage(deleteError, copy.fallbackErrors.deleteCode));
    } finally {
      setAdminLoading(false);
    }
  }

  async function copyMemberCode(code: string) {
    try {
      await navigator.clipboard?.writeText(code);
      showToast({
        title: copy.toast.copied.title,
        description: copy.toast.copied.description,
        variant: "success"
      });
    } catch {
      showToast({
        title: copy.toast.copyFailed.title,
        description: copy.toast.copyFailed.description,
        variant: "error"
      });
    }
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
        handleRequestError(usageError, copy.fallbackErrors.spendingRecord);
        return;
      }
      setCreditUsageError(errorMessage(usageError, copy.fallbackErrors.spendingRecord));
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
        handleRequestError(requestError, copy.fallbackErrors.movieRequests);
        return;
      }
      if (showLoading || movieRequestOpen) {
        setMovieRequestError(errorMessage(requestError, copy.fallbackErrors.movieRequests));
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

  async function refreshOwnNotices(showLoading = false) {
    if (role !== "member") {
      return;
    }

    if (showLoading) {
      setNoticeLoading(true);
    }
    setNoticeError("");
    try {
      const response = await listOwnNotices(100);
      setOwnNotices(response.notices);
      setOwnNoticesLoaded(true);
    } catch (noticeListError) {
      if (isUnauthorizedError(noticeListError)) {
        handleRequestError(noticeListError, "无法加载站内信。");
        return;
      }
      setNoticeError(errorMessage(noticeListError, "无法加载站内信。"));
    } finally {
      if (showLoading) {
        setNoticeLoading(false);
      }
    }
  }

  function openNoticeInbox() {
    setNoticeInboxOpen(true);
    void refreshOwnNotices(true);
  }

  async function markNoticeRead(id: string) {
    setNoticeLoading(true);
    setNoticeError("");
    try {
      const response = await markOwnNoticeRead(id);
      setOwnNotices((currentNotices) => currentNotices.map((notice) => (
        notice.id === id ? response.notice : notice
      )));
    } catch (noticeReadError) {
      setNoticeError(errorMessage(noticeReadError, "无法标记已读。"));
    } finally {
      setNoticeLoading(false);
    }
  }

  async function submitMovieRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = movieRequestText.trim();
    if (!text) {
      setMovieRequestError(copy.request.errors.describe);
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
      showToast({
        title: copy.toast.requestSubmitted.title,
        description: copy.toast.requestSubmitted.description,
        variant: "success"
      });
    } catch (requestError) {
      if (isUnauthorizedError(requestError)) {
        handleRequestError(requestError, copy.fallbackErrors.submitRequest);
        return;
      }
      setMovieRequestError(errorMessage(requestError, copy.fallbackErrors.submitRequest));
    } finally {
      setMovieRequestLoading(false);
    }
  }

  async function openForumThread(threadId: string, options: { showLoading?: boolean } = {}) {
    if (options.showLoading ?? true) {
      setForumThreadLoading(true);
    }
    setForumError("");
    try {
      const response = await getForumThread(threadId);
      setForumThread(response.thread);
      setForumReplyText("");
    } catch (forumThreadError) {
      if (isUnauthorizedError(forumThreadError)) {
        handleRequestError(forumThreadError, copy.fallbackErrors.forum);
        return;
      }
      setForumError(errorMessage(forumThreadError, copy.fallbackErrors.forum));
    } finally {
      setForumThreadLoading(false);
    }
  }

  async function refreshForumThreads(showLoading = true) {
    setForumThreadsLoaded(true);
    if (showLoading) {
      setForumLoading(true);
    }
    setForumError("");
    try {
      const response = await listForumThreads(forumThreadLimit);
      setForumThreads(response.threads);
      const currentThreadId = forumThread?.id;
      const nextThreadId = currentThreadId && response.threads.some((thread) => thread.id === currentThreadId)
        ? currentThreadId
        : response.threads[0]?.id;
      if (nextThreadId) {
        await openForumThread(nextThreadId, { showLoading: false });
      } else {
        setForumThread(undefined);
      }
    } catch (forumListError) {
      if (isUnauthorizedError(forumListError)) {
        handleRequestError(forumListError, copy.fallbackErrors.forum);
        return;
      }
      setForumError(errorMessage(forumListError, copy.fallbackErrors.forum));
    } finally {
      setForumLoading(false);
    }
  }

  async function submitForumThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = forumDraftTitle.trim();
    const body = forumDraftBody.trim();
    if (!title) {
      setForumError(copy.forum.errors.titleRequired);
      return;
    }
    if (!body) {
      setForumError(copy.forum.errors.bodyRequired);
      return;
    }

    setForumSubmitting(true);
    setForumError("");
    try {
      const response = await createForumThread({ title, body });
      setForumThreads((currentThreads) => [
        response.thread,
        ...currentThreads.filter((thread) => thread.id !== response.thread.id)
      ].slice(0, forumThreadLimit));
      setForumThread(response.thread);
      setForumThreadsLoaded(true);
      setForumDraftTitle("");
      setForumDraftBody("");
      setForumReplyText("");
    } catch (forumCreateError) {
      if (isUnauthorizedError(forumCreateError)) {
        handleRequestError(forumCreateError, copy.fallbackErrors.submitForumThread);
        return;
      }
      setForumError(errorMessage(forumCreateError, copy.fallbackErrors.submitForumThread));
    } finally {
      setForumSubmitting(false);
    }
  }

  async function submitForumReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = forumReplyText.trim();
    if (!forumThread) {
      return;
    }
    if (!body) {
      setForumError(copy.forum.errors.replyRequired);
      return;
    }

    setForumReplySubmitting(true);
    setForumError("");
    try {
      const response = await createForumReply(forumThread.id, { body });
      setForumThread(response.thread);
      setForumThreads((currentThreads) => [
        response.thread,
        ...currentThreads.filter((thread) => thread.id !== response.thread.id)
      ].slice(0, forumThreadLimit));
      setForumReplyText("");
    } catch (forumReplyError) {
      if (isUnauthorizedError(forumReplyError)) {
        handleRequestError(forumReplyError, copy.fallbackErrors.submitForumReply);
        return;
      }
      setForumError(errorMessage(forumReplyError, copy.fallbackErrors.submitForumReply));
    } finally {
      setForumReplySubmitting(false);
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
        handleRequestError(usageError, copy.fallbackErrors.memberSpendingRecord);
        return;
      }
      setCreditUsageError(errorMessage(usageError, copy.fallbackErrors.memberSpendingRecord));
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
      showToast({
        title: copy.toast.profileSaved.title,
        description: newPasscode ? copy.toast.profileSaved.withPasscode : copy.toast.profileSaved.nameOnly,
        variant: "success"
      });
    } catch (profileUpdateError) {
      setProfileError(errorMessage(profileUpdateError, copy.fallbackErrors.updateProfile));
    } finally {
      setProfileLoading(false);
    }
  }

  function lockCinema() {
    clearAccessKey();
    setAuthRestoring(false);
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
    setNoticeInboxOpen(false);
    setNoticeLoading(false);
    setNoticeError("");
    setOwnNotices([]);
    setOwnNoticesLoaded(false);
    setAdminNotices([]);
    setAdminNoticesLoading(false);
    setForumThreads([]);
    setForumThread(undefined);
    setForumThreadsLoaded(false);
    forumThreadsAutoLoadRef.current = false;
    setForumLoading(false);
    setForumThreadLoading(false);
    setForumSubmitting(false);
    setForumReplySubmitting(false);
    setForumError("");
    setForumDraftTitle("");
    setForumDraftBody("");
    setForumReplyText("");
    setAdminUnlocked(false);
    setActiveTab("library");
    setBrowseChannel("recommended");
    setQuery("");
    setResults([]);
    setFavorites([]);
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
    setDownloadRequestAssetKeys([]);
    setCachedAssets([]);
    historyInitializedRef.current = false;
    setBrowseView(defaultBrowseView("recommended"));
    setDetailAssetKey(undefined);
    writeRoute({
      tab: "library",
      browseChannel: "recommended",
      browseView: defaultBrowseView("recommended"),
      query: ""
    }, "replace");
  }

  useEffect(() => {
    if (!unlocked) {
      return;
    }

    void wakeBackend().catch(() => undefined);
  }, [unlocked]);

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
          handleRequestError(previewError, copy.fallbackErrors.searchFailed);
          return;
        }
        setSearchDialogError(cacheErrorLabel(errorMessage(previewError, copy.fallbackErrors.searchFailed)));
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
          if (activeTab === "cached" || activeTab === "favorites" || activeTab === "watchlist") {
            await refreshCachedAssets();
          }
        }
      } catch (statusError) {
        handleRequestError(statusError, copy.fallbackErrors.statusRefresh);
      }
    }, 1200);

    return () => window.clearInterval(timer);
  }, [trackedPollKey, job?.id, query, activeTab]);

  useEffect(() => {
    if (!unlocked || !authRestoring) {
      return;
    }

    let cancelled = false;
    checkAccess()
      .then((auth) => {
        if (cancelled) {
          return;
        }
        applyAuth(auth);
      })
      .catch((authError) => {
        if (cancelled) {
          return;
        }
        handleRequestError(authError, copy.access.errors.passcodeMismatch);
      });

    return () => {
      cancelled = true;
    };
  }, [authRestoring, unlocked]);

  useEffect(() => {
    if (!unlocked || !role || historyInitializedRef.current) {
      return;
    }

    historyInitializedRef.current = true;
    const initialPermittedRoute = permittedRoute({
      tab: activeTab,
      browseChannel: initialRoute.browseChannel,
      browseView: initialRoute.browseView,
      query,
      detailAssetKey: initialRoute.detailAssetKey,
      playerAssetKey: initialRoute.playerAssetKey
    });
    setActiveTab(initialPermittedRoute.tab);
    setBrowseChannel(initialPermittedRoute.browseChannel);
    setBrowseView(initialPermittedRoute.browseView);
    setQuery(initialPermittedRoute.query);
    setDetailAssetKey(initialPermittedRoute.detailAssetKey);
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
      setBrowseView(nextRoute.browseView);
      setQuery(nextRoute.query);
      setDetailAssetKey(nextRoute.detailAssetKey);

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
      void refreshAdminNotices();
      void refreshLoginAudit();
    }
  }, [activeTab, adminUnlocked]);

  useEffect(() => {
    if (activeTab === "admin" && role && role !== "admin") {
      const nextRoute = routeForCurrentView({
        tab: "library",
        detailAssetKey: undefined,
        playerAssetKey: undefined
      });
      setActiveTab(nextRoute.tab);
      setDetailAssetKey(undefined);
      writeRoute(nextRoute, "replace");
    }
  }, [activeTab, role]);

  useEffect(() => {
    if (activeTab === "history") {
      void refreshHistoryAssetStatus();
    }
  }, [activeTab, history.length]);

  useEffect(() => {
    if (activeTab === "cached" || activeTab === "favorites" || activeTab === "tasks" || activeTab === "watchlist") {
      void refreshCachedAssets();
    }
  }, [activeTab]);

  useEffect(() => {
    if ((role === "member" || role === "admin") && !ownMovieRequestsLoaded) {
      void refreshOwnMovieRequests(false);
    }
  }, [role, ownMovieRequestsLoaded]);

  useEffect(() => {
    if (role === "member" && !ownNoticesLoaded) {
      void refreshOwnNotices(false);
    }
  }, [role, ownNoticesLoaded]);

  useEffect(() => {
    if (activeTab === "forum" && !forumThreadsLoaded && !forumThreadsAutoLoadRef.current) {
      forumThreadsAutoLoadRef.current = true;
      void refreshForumThreads(true);
    }
  }, [activeTab, forumThreadsLoaded]);

  useEffect(() => {
    if (activeTab === "library" && cachedAssets.length === 0 && !cachedAssetsLoading) {
      void refreshCachedAssets();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "library" && query.trim().length === 0) {
      const loadKey = browseRouteLoadKey(browseChannel, browseView);
      if (browseResults.length === 0 || browseRouteLoadRef.current !== loadKey) {
        browseRouteLoadRef.current = loadKey;
        void refreshBrowseAssets({
          mode: browseLoadModeForView(browseView),
          limit: browseLimitForView(browseView),
          view: browseView
        });
      }
    }
  }, [activeTab, browseChannel, browseView, query]);

  useEffect(() => {
    if (activeTab === "watchlist" && browseResults.length === 0 && !browseLoading) {
      void refreshBrowseAssets({ mode: "paged", limit: 100, view: "newGood" });
    }
  }, [activeTab, browseLoading, browseResults.length]);

  const serviceWakePreviewButton = serviceWakePreviewEnabled ? (
    <button
      type="button"
      className="fixed bottom-4 right-4 z-50 rounded-full border border-emerald-300/30 bg-slate-950/90 px-3 py-2 text-xs font-semibold text-emerald-100 shadow-lg shadow-black/30 backdrop-blur transition hover:border-emerald-200 hover:bg-slate-900"
      onClick={() => setServiceWakePreviewOpen(true)}
    >
      等待态预览
    </button>
  ) : null;

  const serviceWakeDialog = (
    <ServiceWakeDialog
      dismissible={serviceWakePreviewOpen && !serviceWakeActive}
      open={serviceWakeDialogOpen}
      onOpenChange={handleServiceWakeDialogOpenChange}
    />
  );

  if (!unlocked) {
    return (
      <>
        {serviceWakeDialog}
        <AccessGate
          theme={theme}
          onToggleTheme={() => setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"))}
          onUnlock={(auth, options) => {
            setUnlocked(true);
            applyAuth(auth);
            if (options?.openProfile) {
              setProfileOpen(true);
            }
          }}
        />
        {serviceWakePreviewButton}
      </>
    );
  }

  const creditConfirmDialog = (
    <CreditConfirmDialog
      policy={creditPolicy}
      loading={creditConfirmLoading}
      open={creditConfirmOpen}
      preview={creditPreview}
      onCancel={closeCreditConfirm}
      onConfirm={() => void confirmCreditAction()}
    />
  );

  if (playback) {
    return (
      <>
        <Player
          playback={playback}
          onClose={closePlayer}
          onRenewPlayback={() => renewCurrentPlayback(playback.assetKey)}
        />
        {creditConfirmDialog}
      </>
    );
  }

  const showAdmin = role === "admin";
  const accountLabel = role === "admin" ? copy.common.admin : member?.name ?? copy.common.member;
  const accountDetail = role === "admin"
    ? copy.common.admin
    : member?.credits
      ? `${member.credits.remaining}${member.credits.unitSymbol}`
      : copy.common.cinemaMember;
  const noticeUnreadCount = ownNotices.filter((notice) => !notice.readAt).length;

  return (
    <>
      {serviceWakeDialog}
      {serviceWakePreviewButton}
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
      {creditConfirmDialog}
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
      <NoticeInboxDialog
        error={noticeError}
        loading={noticeLoading}
        notices={ownNotices}
        open={noticeInboxOpen}
        unreadCount={noticeUnreadCount}
        onMarkRead={(id) => void markNoticeRead(id)}
        onOpenChange={(open) => {
          setNoticeInboxOpen(open);
          if (!open) {
            setNoticeError("");
          }
        }}
      />
      <CinemaLayout
        activeTab={activeTab}
        activeBrowseChannel={browseChannel}
        accountDetail={accountDetail}
        accountLabel={accountLabel}
        canChangePasscode={role === "member"}
        canRequestMovie={role === "member" || role === "admin"}
        noticeUnreadCount={noticeUnreadCount}
        showAdmin={showAdmin}
        theme={theme}
        onActiveTabChange={navigateToTab}
        onBrowseChannelChange={openBrowseChannel}
        onLock={lockCinema}
        onOpenHome={() => openBrowseChannel("recommended")}
        onOpenForum={() => navigateToTab("forum")}
        onOpenFavorites={() => navigateToTab("favorites")}
        onOpenHelp={() => navigateToTab("help")}
        onOpenHistory={() => navigateToTab("history")}
        onOpenWatchlist={() => navigateToTab("watchlist")}
        onOpenNowPlaying={() => navigateToTab("nowPlaying")}
        onOpenMovieRequest={openMovieRequestDialog}
        onOpenNotices={openNoticeInbox}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenSpending={() => void openOwnCreditUsage()}
        onOpenTasks={() => navigateToTab("tasks")}
        onOpenSearch={openSearchDialog}
        onToggleTheme={() => setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"))}
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
            browseView={browseView}
            browseLoading={browseLoading}
            browseLoadingMore={browseLoadingMore}
            browseHasMore={browseHasMore}
            browseLoadMode={browseLoadMode}
            cachedAssets={cachedAssets}
            historyItems={history}
            trackedItems={trackedItems}
            pendingAssetKeys={cacheRequestAssetKeys}
            pendingDownloadAssetKeys={downloadRequestAssetKeys}
            favoriteAssetKeys={favoriteAssetKeys}
            collectionMarksByAssetKey={collectionMarksByAssetKey}
            trackedByAssetKey={trackedByAssetKey}
            onOpenCachedAsset={(assetKey) => void openPlayer(assetKey)}
            onFocusedAssetHandled={() => setFocusedLibraryAssetKey(undefined)}
            onToggleFavorite={toggleFavorite}
            onUpdateCollectionMark={updateCollectionMark}
            onBrowseViewChange={openBrowseView}
            detailAssetKey={detailAssetKey}
            onOpenDetail={openLibraryDetail}
            onCloseDetail={closeLibraryDetail}
            onRefreshBrowse={(options) => void refreshBrowseAssets(options)}
            onViewModeChange={setLibraryViewMode}
            onSelect={(selectedResult, variant) => void selectResult(selectedResult, variant)}
            onDownload={(selectedResult, variant) => void downloadResult(selectedResult, variant)}
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
        favorites={(
          <FavoritesPanel
            cachedAssets={cachedAssets}
            creditPolicy={creditPolicy}
            favorites={favorites}
            onRemove={removeCollectionMark}
            onSelect={(selectedResult, variant) => void selectResult(selectedResult, variant)}
          />
        )}
        watchlist={(
          <WatchlistPanel
            browseHasMore={browseHasMore}
            browseLoading={browseLoading}
            browseLoadingMore={browseLoadingMore}
            browseResults={browseResults}
            cachedAssets={cachedAssets}
            creditPolicy={creditPolicy}
            favoriteAssetKeys={favoriteAssetKeys}
            historyItems={history}
            onLoadMore={() => void refreshBrowseAssets({ append: true, mode: "paged", limit: 100, view: "newGood" })}
            onRefresh={() => {
              void refreshCachedAssets();
              void refreshBrowseAssets({ mode: "paged", limit: 100, view: "newGood" });
            }}
            onToggleFavorite={toggleFavorite}
            onSelect={(selectedResult, variant) => void selectResult(selectedResult, variant)}
          />
        )}
        nowPlaying={<NowPlayingPanel />}
        forum={(
          <ForumPanel
            currentMemberId={member?.id}
            draftBody={forumDraftBody}
            draftTitle={forumDraftTitle}
            error={forumError}
            loaded={forumThreadsLoaded}
            loading={forumLoading}
            replyBody={forumReplyText}
            replying={forumReplySubmitting}
            selectedThread={forumThread}
            submitting={forumSubmitting}
            threadLoading={forumThreadLoading}
            threads={forumThreads}
            onDraftBodyChange={setForumDraftBody}
            onDraftTitleChange={setForumDraftTitle}
            onRefresh={() => void refreshForumThreads(true)}
            onReplyBodyChange={setForumReplyText}
            onSelectThread={(threadId) => void openForumThread(threadId)}
            onSubmitReply={(event) => void submitForumReply(event)}
            onSubmitThread={(event) => void submitForumThread(event)}
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
            memberNotices={adminNotices}
            memberNoticesLoading={adminNoticesLoading}
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
            onRefreshNotices={() => void refreshAdminNotices()}
            onCreateNotice={(input) => void createMemberNotice(input)}
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

export default function App() {
  return (
    <ToastProvider>
      <CinemaApp />
    </ToastProvider>
  );
}
