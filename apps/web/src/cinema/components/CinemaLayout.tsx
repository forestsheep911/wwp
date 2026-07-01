import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Database,
  Film,
  HelpCircle,
  History,
  KeyRound,
  ListChecks,
  LogOut,
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
import type { AppTab, BrowseChannel } from "../types";

const browseChannels: Array<{ id: BrowseChannel; label: string }> = [
  { id: "recommended", label: "推荐" },
  { id: "movie", label: "电影" },
  { id: "tv", label: "电视" },
  { id: "animation", label: "动画" }
];

interface CinemaLayoutProps {
  activeTab: AppTab;
  activeBrowseChannel: BrowseChannel;
  accountLabel: string;
  accountDetail: string;
  canChangePasscode: boolean;
  canRequestMovie: boolean;
  library: ReactNode;
  cached: ReactNode;
  history: ReactNode;
  help: ReactNode;
  admin?: ReactNode;
  showAdmin: boolean;
  status?: ReactNode;
  statusCount: number;
  statusOffset?: "none" | "librarySearch";
  onActiveTabChange: (value: AppTab) => void;
  onBrowseChannelChange: (value: BrowseChannel) => void;
  onChangePasscode: () => void;
  onLock: () => void;
  onOpenCached: () => void;
  onOpenHelp: () => void;
  onOpenHistory: () => void;
  onOpenMovieRequest: () => void;
  onOpenSpending: () => void;
  onOpenSearch: () => void;
}

export function CinemaLayout({
  activeTab,
  activeBrowseChannel,
  accountLabel,
  accountDetail,
  canChangePasscode,
  canRequestMovie,
  library,
  cached,
  history,
  help,
  admin,
  showAdmin,
  status,
  statusCount,
  statusOffset = "none",
  onActiveTabChange,
  onBrowseChannelChange,
  onChangePasscode,
  onLock,
  onOpenCached,
  onOpenHelp,
  onOpenHistory,
  onOpenMovieRequest,
  onOpenSpending,
  onOpenSearch
}: CinemaLayoutProps) {
  const [statusCollapsed, setStatusCollapsed] = useState(false);
  const hasActiveTasks = statusCount > 0;
  const showDesktopStatus = Boolean(status) && hasActiveTasks && !statusCollapsed;
  const showDesktopStatusToggle = Boolean(status) && hasActiveTasks && statusCollapsed;
  const showMobileTaskLauncher = Boolean(status) && hasActiveTasks && activeTab !== "tasks";
  const statusOffsetClass = statusOffset === "librarySearch" ? "lg:pt-[62px]" : "";

  return (
    <main className="min-h-screen">
      <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as AppTab)}>
        <header className="relative z-[100] border-b border-slate-800 bg-slate-950/70 backdrop-blur">
          <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 md:px-8 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-800 bg-slate-900 text-emerald-200">
                <Film className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-slate-50 sm:text-xl">WWP Cinema</h1>
                <p className="text-xs font-semibold uppercase tracking-normal text-emerald-300">Private household cinema</p>
              </div>
            </div>

            <nav
              aria-label="Browse channels"
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
              <Button type="button" variant="outline" size="icon" onClick={onOpenHelp} title="Help">
                <HelpCircle className="h-4 w-4" />
                <span className="sr-only">Help</span>
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={onOpenSearch} title="Search">
                <Search className="h-4 w-4" />
                <span className="sr-only">Search</span>
              </Button>
              <AccountMenu
                accountDetail={accountDetail}
                accountLabel={accountLabel}
                canChangePasscode={canChangePasscode}
                canRequestMovie={canRequestMovie}
                showAdmin={showAdmin}
                onChangePasscode={onChangePasscode}
                onOpenAdmin={() => onActiveTabChange("admin")}
                onOpenCached={onOpenCached}
                onOpenHelp={onOpenHelp}
                onOpenHistory={onOpenHistory}
                onOpenMovieRequest={onOpenMovieRequest}
                onOpenSpending={onOpenSpending}
                onLock={onLock}
              />
            </div>
          </div>
        </header>

        <div className={`mx-auto grid max-w-7xl gap-4 px-5 py-5 md:px-8 ${showMobileTaskLauncher ? "pb-24 lg:pb-5" : ""}`}>
          {showDesktopStatusToggle ? (
            <div className="hidden justify-end lg:flex">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatusCollapsed(false);
                }}
              >
                <ChevronLeft className="h-4 w-4" />
                Show tasks
                <Badge variant="default">{statusCount}</Badge>
              </Button>
            </div>
          ) : null}

          <section className={showDesktopStatus ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start" : "grid gap-5"}>
            <div className="min-w-0 overflow-hidden">
              <TabsContent className="mt-0" value="library">{library}</TabsContent>
              <TabsContent className="mt-0" value="cached">{cached}</TabsContent>
              <TabsContent className="mt-0" value="history">{history}</TabsContent>
              <TabsContent className="mt-0" value="help">{help}</TabsContent>
              {showAdmin ? <TabsContent className="mt-0" value="admin">{admin}</TabsContent> : null}
              {status ? <TabsContent className="mt-0 lg:hidden" value="tasks">{status}</TabsContent> : null}
            </div>

            {showDesktopStatus ? (
              <aside className={`hidden min-w-0 lg:block ${statusOffsetClass}`}>
                <div className="relative min-w-0">
                  <Button
                    className="absolute right-4 top-4 z-10 h-8 px-2.5"
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setStatusCollapsed(true)}
                    title="Hide tasks"
                  >
                    <ChevronRight className="h-4 w-4" />
                    <span className="sr-only">Hide tasks</span>
                  </Button>
                  {status}
                </div>
              </aside>
            ) : null}
          </section>
        </div>

        {showMobileTaskLauncher ? (
          <div className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[90] lg:hidden">
            <Button
              className="h-11 w-full border border-emerald-300/25 bg-slate-950/95 shadow-2xl shadow-black/40 backdrop-blur"
              type="button"
              variant="secondary"
              onClick={() => onActiveTabChange("tasks")}
            >
              <ListChecks className="h-4 w-4 text-emerald-200" />
              Preparing
              <Badge variant="default">{statusCount}</Badge>
            </Button>
          </div>
        ) : null}
      </Tabs>
    </main>
  );
}

function AccountMenu({
  accountLabel,
  accountDetail,
  canChangePasscode,
  canRequestMovie,
  showAdmin,
  onChangePasscode,
  onOpenAdmin,
  onOpenCached,
  onOpenHelp,
  onOpenHistory,
  onOpenMovieRequest,
  onOpenSpending,
  onLock
}: {
  accountLabel: string;
  accountDetail: string;
  canChangePasscode: boolean;
  canRequestMovie: boolean;
  showAdmin: boolean;
  onChangePasscode: () => void;
  onOpenAdmin: () => void;
  onOpenCached: () => void;
  onOpenHelp: () => void;
  onOpenHistory: () => void;
  onOpenMovieRequest: () => void;
  onOpenSpending: () => void;
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
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        title="Account"
      >
        <UserCircle className="h-4 w-4" />
        <span className="hidden max-w-[8rem] truncate sm:inline">{accountLabel}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </Button>

      {open ? (
        <div
          className="absolute right-0 z-[110] mt-2 w-[min(18rem,calc(100vw-2.5rem))] overflow-hidden rounded-md border border-slate-800 bg-slate-950 shadow-2xl shadow-black/40"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="border-b border-slate-800 px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-50">{accountLabel}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{accountDetail}</p>
          </div>
          <div className="grid p-1" role="menu">
            <button
              className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
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
              Help
            </button>
            <button
              className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
              type="button"
              role="menuitem"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                runAfterMenuClose(onOpenCached);
              }}
              onClick={() => {
                runAfterMenuClose(onOpenCached);
              }}
            >
              <Database className="h-4 w-4" />
              Cached
            </button>
            <button
              className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
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
              History
            </button>
            {showAdmin ? (
              <button
                className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
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
                Admin
              </button>
            ) : null}
            {canRequestMovie ? (
              <button
                className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
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
                Request movie
              </button>
            ) : null}
            {canChangePasscode ? (
              <button
                className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
                type="button"
                role="menuitem"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  runAfterMenuClose(onChangePasscode);
                }}
                onClick={() => {
                  runAfterMenuClose(onChangePasscode);
                }}
              >
                <KeyRound className="h-4 w-4" />
                Change passcode
              </button>
            ) : null}
            {canChangePasscode ? (
              <button
                className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-slate-300 hover:bg-slate-900 hover:text-white"
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
                Spending
              </button>
            ) : null}
            <button
              className="flex cursor-not-allowed items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-slate-500"
              type="button"
              role="menuitem"
              disabled
            >
              <UserCircle className="h-4 w-4" />
              Profile
            </button>
            <button
              className="flex cursor-not-allowed items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-slate-500"
              type="button"
              role="menuitem"
              disabled
            >
              <SlidersHorizontal className="h-4 w-4" />
              Settings
            </button>
            <button
              className="flex items-center gap-2 rounded px-3 py-2 text-left text-sm font-semibold text-rose-200 hover:bg-rose-400/10 hover:text-rose-100"
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onLock();
              }}
            >
              <LogOut className="h-4 w-4" />
              Logout
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
