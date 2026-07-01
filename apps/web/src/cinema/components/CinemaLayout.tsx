import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Bell,
  ChevronDown,
  HelpCircle,
  History,
  ListChecks,
  LogOut,
  MessageCircle,
  MessageSquarePlus,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserCircle
} from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent } from "../../components/ui/tabs";
import { copy } from "../i18n";
import type { AppTab, BrowseChannel } from "../types";

const browseChannels: Array<{ id: BrowseChannel; label: string }> = [
  { id: "recommended", label: copy.layout.browseChannels.recommended },
  { id: "movie", label: copy.layout.browseChannels.movie },
  { id: "tv", label: copy.layout.browseChannels.tv },
  { id: "animation", label: copy.layout.browseChannels.animation }
];

interface CinemaLayoutProps {
  activeTab: AppTab;
  activeBrowseChannel: BrowseChannel;
  accountLabel: string;
  accountDetail: string;
  canChangePasscode: boolean;
  canRequestMovie: boolean;
  noticeUnreadCount: number;
  library: ReactNode;
  cached: ReactNode;
  forum: ReactNode;
  history: ReactNode;
  help: ReactNode;
  tasks?: ReactNode;
  admin?: ReactNode;
  showAdmin: boolean;
  onActiveTabChange: (value: AppTab) => void;
  onBrowseChannelChange: (value: BrowseChannel) => void;
  onLock: () => void;
  onOpenHome: () => void;
  onOpenHelp: () => void;
  onOpenForum: () => void;
  onOpenHistory: () => void;
  onOpenMovieRequest: () => void;
  onOpenNotices: () => void;
  onOpenProfile: () => void;
  onOpenSpending: () => void;
  onOpenTasks: () => void;
  onOpenSearch: () => void;
}

export function CinemaLayout({
  activeTab,
  activeBrowseChannel,
  accountLabel,
  accountDetail,
  canChangePasscode,
  canRequestMovie,
  noticeUnreadCount,
  library,
  cached,
  forum,
  history,
  help,
  tasks,
  admin,
  showAdmin,
  onActiveTabChange,
  onBrowseChannelChange,
  onLock,
  onOpenHome,
  onOpenHelp,
  onOpenForum,
  onOpenHistory,
  onOpenMovieRequest,
  onOpenNotices,
  onOpenProfile,
  onOpenSpending,
  onOpenTasks,
  onOpenSearch
}: CinemaLayoutProps) {
  return (
    <main className="min-h-screen">
      <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as AppTab)}>
        <header className="relative z-[100] border-b border-slate-800 bg-slate-950/70 backdrop-blur">
          <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 md:px-8 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
            <button
              className="group flex min-w-0 items-center gap-3 rounded-md text-left transition-colors hover:text-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              type="button"
              onClick={onOpenHome}
              title={copy.layout.homeTitle}
            >
              <img alt="" className="h-10 w-10 shrink-0 rounded-md" src="/wwp-icon-64.png" />
              <span className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-slate-50 sm:text-xl">{copy.app.name}</h1>
              </span>
            </button>

            <nav
              aria-label={copy.layout.browseLabel}
              className="scrollbar-none order-3 col-span-2 flex min-w-0 items-center gap-5 overflow-x-auto lg:order-2 lg:col-span-1 lg:mx-auto lg:justify-center"
            >
              {browseChannels.map((channel) => {
                const active = activeTab === "library" && activeBrowseChannel === channel.id;
                return (
                  <button
                    className={`relative h-9 flex-none px-0.5 text-sm font-semibold transition-colors ${
                      active
                        ? "text-emerald-200"
                        : "text-slate-400 hover:text-slate-100"
                    }`}
                    key={channel.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onBrowseChannelChange(channel.id)}
                  >
                    {channel.label}
                    <span
                      aria-hidden="true"
                      className={`absolute inset-x-0 -bottom-1 h-0.5 rounded-full transition-colors ${
                        active ? "bg-emerald-300" : "bg-transparent"
                      }`}
                    />
                  </button>
                );
              })}
            </nav>

            <div className="order-2 flex min-w-0 items-center justify-end gap-2 lg:order-3">
              <Button type="button" variant="outline" size="icon" onClick={onOpenHelp} title={copy.layout.help}>
                <HelpCircle className="h-4 w-4" />
                <span className="sr-only">{copy.layout.help}</span>
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={onOpenForum} title={copy.layout.forum}>
                <MessageCircle className="h-4 w-4" />
                <span className="sr-only">{copy.layout.forum}</span>
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={onOpenSearch} title={copy.common.search}>
                <Search className="h-4 w-4" />
                <span className="sr-only">{copy.common.search}</span>
              </Button>
              {canChangePasscode ? (
                <Button className="relative" type="button" variant="outline" size="icon" onClick={onOpenNotices} title="站内信">
                  <Bell className="h-4 w-4" />
                  {noticeUnreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 grid min-h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-slate-950">
                      {noticeUnreadCount}
                    </span>
                  ) : null}
                  <span className="sr-only">站内信</span>
                </Button>
              ) : null}
              {canChangePasscode ? (
                <Button type="button" variant="outline" size="icon" onClick={onOpenSpending} title={copy.layout.spending}>
                  <ReceiptText className="h-4 w-4" />
                  <span className="sr-only">{copy.layout.spending}</span>
                </Button>
              ) : null}
              <AccountMenu
                accountDetail={accountDetail}
                accountLabel={accountLabel}
                canChangePasscode={canChangePasscode}
                canRequestMovie={canRequestMovie}
                noticeUnreadCount={noticeUnreadCount}
                showAdmin={showAdmin}
                onOpenAdmin={() => onActiveTabChange("admin")}
                onOpenForum={onOpenForum}
                onOpenHelp={onOpenHelp}
                onOpenHistory={onOpenHistory}
                onOpenMovieRequest={onOpenMovieRequest}
                onOpenNotices={onOpenNotices}
                onOpenProfile={onOpenProfile}
                onOpenSpending={onOpenSpending}
                onOpenTasks={onOpenTasks}
                onLock={onLock}
              />
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-5 md:px-8">
          <div className="min-w-0 overflow-hidden">
            <TabsContent className="mt-0" value="library">{library}</TabsContent>
            <TabsContent className="mt-0" value="cached">{cached}</TabsContent>
            <TabsContent className="mt-0" value="forum">{forum}</TabsContent>
            <TabsContent className="mt-0" value="history">{history}</TabsContent>
            <TabsContent className="mt-0" value="help">{help}</TabsContent>
            {tasks ? <TabsContent className="mt-0" value="tasks">{tasks}</TabsContent> : null}
            {showAdmin ? <TabsContent className="mt-0" value="admin">{admin}</TabsContent> : null}
          </div>
        </div>
      </Tabs>
    </main>
  );
}

function AccountMenu({
  accountLabel,
  accountDetail,
  canChangePasscode,
  canRequestMovie,
  noticeUnreadCount,
  showAdmin,
  onOpenAdmin,
  onOpenForum,
  onOpenHelp,
  onOpenHistory,
  onOpenMovieRequest,
  onOpenNotices,
  onOpenProfile,
  onOpenSpending,
  onOpenTasks,
  onLock
}: {
  accountLabel: string;
  accountDetail: string;
  canChangePasscode: boolean;
  canRequestMovie: boolean;
  noticeUnreadCount: number;
  showAdmin: boolean;
  onOpenAdmin: () => void;
  onOpenForum: () => void;
  onOpenHelp: () => void;
  onOpenHistory: () => void;
  onOpenMovieRequest: () => void;
  onOpenNotices: () => void;
  onOpenProfile: () => void;
  onOpenSpending: () => void;
  onOpenTasks: () => void;
  onLock: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  function runAfterMenuClose(action: () => void) {
    setOpen(false);
    window.setTimeout(action, 80);
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnOutside(event: MouseEvent) {
      const path = event.composedPath();
      if (menuRef.current && !path.includes(menuRef.current)) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("click", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("click", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative">
      <Button
        className="px-3"
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        title={copy.layout.account}
      >
        <UserCircle className="h-4 w-4" />
        <span className="hidden max-w-[8rem] truncate sm:inline">{accountLabel}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>

      {open ? (
        <div
          className="absolute right-0 z-[110] mt-2 w-[min(16rem,calc(100vw-2.5rem))] overflow-hidden rounded-md border border-slate-800 bg-slate-950 shadow-2xl shadow-black/40"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="flex min-w-0 items-center justify-between gap-3 border-b border-slate-800 px-3 py-2.5">
            <p className="min-w-0 truncate text-sm font-semibold text-slate-50">{accountLabel}</p>
            <span className="shrink-0 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-xs font-bold leading-none text-emerald-100">
              {accountDetail}
            </span>
          </div>
          <div className="grid p-1" role="menu">
            <button
              className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
              type="button"
              role="menuitem"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                runAfterMenuClose(onOpenHelp);
              }}
              onClick={() => {
                runAfterMenuClose(onOpenHelp);
              }}
            >
              <HelpCircle className="h-4 w-4" />
              {copy.layout.help}
            </button>
            <button
              className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
              type="button"
              role="menuitem"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                runAfterMenuClose(onOpenTasks);
              }}
              onClick={() => {
                runAfterMenuClose(onOpenTasks);
              }}
            >
              <ListChecks className="h-4 w-4" />
              {copy.layout.tasks}
            </button>
            <button
              className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
              type="button"
              role="menuitem"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                runAfterMenuClose(onOpenForum);
              }}
              onClick={() => {
                runAfterMenuClose(onOpenForum);
              }}
            >
              <MessageCircle className="h-4 w-4" />
              {copy.layout.forum}
            </button>
            <button
              className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
              type="button"
              role="menuitem"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                runAfterMenuClose(onOpenHistory);
              }}
              onClick={() => {
                runAfterMenuClose(onOpenHistory);
              }}
            >
              <History className="h-4 w-4" />
              {copy.layout.history}
            </button>
            {showAdmin ? (
              <button
                className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
                type="button"
                role="menuitem"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  runAfterMenuClose(onOpenAdmin);
                }}
                onClick={() => {
                  runAfterMenuClose(onOpenAdmin);
                }}
              >
                <ShieldCheck className="h-4 w-4" />
                {copy.layout.admin}
              </button>
            ) : null}
            {canRequestMovie ? (
              <button
                className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
                type="button"
                role="menuitem"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  runAfterMenuClose(onOpenMovieRequest);
                }}
                onClick={() => {
                  runAfterMenuClose(onOpenMovieRequest);
                }}
              >
                <MessageSquarePlus className="h-4 w-4" />
                {copy.layout.request}
              </button>
            ) : null}
            {canChangePasscode ? (
              <button
                className="flex items-center justify-between gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
                type="button"
                role="menuitem"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  runAfterMenuClose(onOpenNotices);
                }}
                onClick={() => {
                  runAfterMenuClose(onOpenNotices);
                }}
              >
                <span className="flex items-center gap-2">
                  <Bell className="h-4 w-4" />
                  站内信
                </span>
                {noticeUnreadCount > 0 ? <Badge variant="warning">{noticeUnreadCount}</Badge> : null}
              </button>
            ) : null}
            {canChangePasscode ? (
              <button
                className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
                type="button"
                role="menuitem"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  runAfterMenuClose(onOpenSpending);
                }}
                onClick={() => {
                  runAfterMenuClose(onOpenSpending);
                }}
              >
                <ReceiptText className="h-4 w-4" />
                {copy.layout.spending}
              </button>
            ) : null}
            {canChangePasscode ? (
              <button
                className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
                type="button"
                role="menuitem"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  runAfterMenuClose(onOpenProfile);
                }}
                onClick={() => {
                  runAfterMenuClose(onOpenProfile);
                }}
              >
                <SlidersHorizontal className="h-4 w-4" />
                {copy.layout.settings}
              </button>
            ) : null}
            <button
              className="flex items-center gap-2 rounded px-2.5 py-2 text-left text-sm font-semibold text-rose-200 hover:bg-rose-400/10 hover:text-rose-100"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLock();
              }}
            >
              <LogOut className="h-4 w-4" />
              {copy.layout.logout}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
