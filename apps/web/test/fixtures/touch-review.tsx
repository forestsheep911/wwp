import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { defaultCreditPolicy, mockSearchResults } from "@wwpdw/shared";
import { CinemaLayout } from "../../src/cinema/components/CinemaLayout";
import { LibraryTab } from "../../src/cinema/components/LibraryTab";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../src/components/ui/dialog";
import type { AppTab, BrowseChannel, BrowseViewId, ResultWithCache } from "../../src/cinema/types";
import "../../src/styles.css";

// Isolated responsive fixture: no account, API, or production data required.
const films: ResultWithCache[] = Array.from({ length: 12 }, (_, i) => ({
  ...mockSearchResults[i % 3], assetKey: `fixture-${i}`,
  title: ["月光下的漫游", "与家人的夏日时光", "沿途的风景：一段漫长的旅行"][i % 3],
  metadata: { ...mockSearchResults[i % 3].metadata, posterUrl: undefined, genres: ["剧情", "冒险"] }
}));
function Review() {
  const loading = new URLSearchParams(location.search).has("loading");
  const partial = new URLSearchParams(location.search).has("partial");
  const [partialState, setPartialState] = useState("loading");
  const [partialFilms, setPartialFilms] = useState(films);
  const [activeTab, setTab] = useState<AppTab>("library");
  const [channel, setChannel] = useState<BrowseChannel>("recommended");
  const [view, setView] = useState<BrowseViewId>("recent");
  const [detail, setDetail] = useState<ResultWithCache>();
  const [favorites, setFavorites] = useState(new Set<string>());
  const [action, setAction] = useState("");
  const [noticeOpen, setNoticeOpen] = useState(false);
  const noop = () => {};
  const placeholder = <p data-review-action>{action || activeTab}</p>;
  const library = <LibraryTab creditPolicy={defaultCreditPolicy} query="" error="" viewMode="gallery"
    results={[]} browseChannel={channel} browseResults={loading ? [] : partial ? partialFilms : films} browseView={view} browseLoading={loading}
    browseLoadingMore={partial && partialState === "loading"} browseHasMore={partial && partialState !== "done"} browseLoadMode="paged" historyItems={[]} trackedItems={[]}
    pendingAssetKeys={[]} pendingDownloadAssetKeys={[]} favoriteAssetKeys={favorites}
    collectionMarksByAssetKey={new Map()} trackedByAssetKey={new Map()}
    onToggleFavorite={film => setFavorites(old => { const next = new Set(old); next.has(film.assetKey) ? next.delete(film.assetKey) : next.add(film.assetKey); return next; })}
    onUpdateCollectionMark={noop} onBrowsePresetChange={(c, v) => { setChannel(c); setView(v); }} onBrowseViewChange={setView}
    detailAssetKey={detail?.assetKey} detailResult={detail} getDetailHref={film => `?detail=${film.assetKey}`}
    onOpenDetail={setDetail} onOpenPerson={noop} onCloseDetail={() => setDetail(undefined)} onClearSearch={noop}
    onRefreshBrowse={noop} onViewModeChange={noop} onSelect={noop} onDownload={noop} />;
  return <><CinemaLayout activeTab={activeTab} accountLabel="测试观众" accountDetail="普通账户" canChangePasscode canRequestMovie
    noticeUnreadCount={3} theme="dark" library={library} people={placeholder} statistics={placeholder} cached={placeholder}
    forum={placeholder} history={placeholder} favorites={placeholder} watchlist={placeholder} nowPlaying={placeholder}
    help={placeholder} profile={placeholder} tasks={placeholder} showAdmin={false} onActiveTabChange={setTab} onLock={noop}
    onOpenHome={() => setTab("library")} onOpenPeople={() => setTab("people")} onOpenStatistics={() => setTab("statistics")}
    onOpenHelp={() => setTab("help")} onOpenForum={() => setTab("forum")} onOpenFavorites={() => setTab("favorites")}
    onOpenHistory={() => setTab("history")} onOpenWatchlist={() => setTab("watchlist")} onOpenNowPlaying={() => setTab("nowPlaying")}
    onOpenMovieRequest={noop} onOpenNotices={() => setNoticeOpen(true)} onOpenProfile={noop} onOpenSpending={noop} onOpenTasks={() => setTab("tasks")}
    onOpenSearch={() => { setAction("搜索已打开"); setTab("help"); }} onToggleTheme={() => document.documentElement.dataset.theme = document.documentElement.dataset.theme === "light" ? "dark" : "light"} />
    <Dialog open={noticeOpen} onOpenChange={setNoticeOpen}><DialogContent><DialogTitle>测试站内信</DialogTitle><DialogDescription>验证菜单到对话框的交接。</DialogDescription></DialogContent></Dialog>
    {partial ? <div className="fixed bottom-0 right-0 z-[200] bg-slate-800 p-2">
      <button onClick={() => { setPartialFilms([...films, ...films.map(film => ({ ...film, assetKey: `${film.assetKey}-next` }))]); setPartialState("done"); }}>Finish fixture</button>
      <button onClick={() => setPartialState("failed")}>Fail fixture</button>
      <button onClick={() => setPartialState("loading")}>Retry fixture</button>
    </div> : null}
  </>;
}
createRoot(document.getElementById("root")!).render(<Review />);
