import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Database,
  Film,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import type { AppTab } from "../types";

interface CinemaLayoutProps {
  activeTab: AppTab;
  accountLabel: string;
  accountDetail: string;
  canChangePasscode: boolean;
  canRequestMovie: boolean;
  library: ReactNode;
  cached: ReactNode;
  history: ReactNode;
  admin?: ReactNode;
  showAdmin: boolean;
  status?: ReactNode;
  statusCount: number;
  onActiveTabChange: (value: AppTab) => void;
  onChangePasscode: () => void;
  onLock: () => void;
  onOpenMovieRequest: () => void;
  onOpenSpending: () => void;
  onOpenSearch: () => void;
}

export function CinemaLayout({
  activeTab,
  accountLabel,
  accountDetail,
  canChangePasscode,
  canRequestMovie,
  library,
  cached,
  history,
  admin,
  showAdmin,
  status,
  statusCount,
  onActiveTabChange,
  onChangePasscode,
  onLock,
  onOpenMovieRequest,
  onOpenSpending,
  onOpenSearch
}: CinemaLayoutProps) {
  const [statusCollapsed, setStatusCollapsed] = useState(false);
  const showDesktopStatus = Boolean(status) && !statusCollapsed;

  return (
    <main className="min-h-screen">
      <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as AppTab)}>
        <header className="relative z-40 border-b border-slate-800 bg-slate-950/70 backdrop-blur">
          <div className="mx-auto grid max-w-7xl gap-3 px-5 py-3 md:px-8 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-800 bg-slate-900 text-emerald-200">
                <Film className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-lg font-semibold text-slate-50 sm:text-xl">WW Family Cinema</h1>
                <p className="text-xs font-semibold uppercase tracking-normal text-emerald-300">Private household cinema</p>
              </div>
            </div>

            <TabsList className="min-w-0 lg:mx-auto">
              <TabsTrigger value="library">
                <Film className="h-4 w-4" />
                <span className="sm:hidden">片库</span>
                <span className="hidden sm:inline">Library</span>
              </TabsTrigger>
              <TabsTrigger value="cached">
                <Database className="h-4 w-4" />
                <span className="sm:hidden">缓存</span>
                <span className="hidden sm:inline">Cached</span>
              </TabsTrigger>
              <TabsTrigger value="history">
                <History className="h-4 w-4" />
                <span className="sm:hidden">历史</span>
                <span className="hidden sm:inline">History</span>
              </TabsTrigger>
              {showAdmin ? (
                <TabsTrigger value="admin">
                  <ShieldCheck className="h-4 w-4" />
                  <span className="sm:hidden">管理</span>
                  <span className="hidden sm:inline">Admin</span>
                </TabsTrigger>
              ) : null}
            </TabsList>

            <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
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
                onOpenMovieRequest={onOpenMovieRequest}
                onOpenSpending={onOpenSpending}
                onLock={onLock}
              />
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-7xl gap-4 px-5 py-5 md:px-8">
          {status ? (
            <div className="flex justify-end">
              <Button
                className="w-full sm:w-auto lg:hidden"
                type="button"
                variant={activeTab === "tasks" ? "secondary" : "outline"}
                size="sm"
                onClick={() => onActiveTabChange("tasks")}
              >
                <ListChecks className="h-4 w-4" />
                Tasks
                <Badge variant={statusCount > 0 ? "default" : "secondary"}>{statusCount}</Badge>
              </Button>
              <Button
                className="hidden shrink-0 lg:inline-flex"
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStatusCollapsed((current) => !current)}
              >
                {statusCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {statusCollapsed ? "Show tasks" : "Hide tasks"}
                <Badge variant={statusCount > 0 ? "default" : "secondary"}>{statusCount}</Badge>
              </Button>
            </div>
          ) : null}

          <section className={showDesktopStatus ? "grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start" : "grid gap-5"}>
            <div className="min-w-0 overflow-hidden">
              <TabsContent className="mt-0" value="library">{library}</TabsContent>
              <TabsContent className="mt-0" value="cached">{cached}</TabsContent>
              <TabsContent className="mt-0" value="history">{history}</TabsContent>
              {showAdmin ? <TabsContent className="mt-0" value="admin">{admin}</TabsContent> : null}
              {status ? <TabsContent className="mt-0 lg:hidden" value="tasks">{status}</TabsContent> : null}
            </div>

            {showDesktopStatus ? <aside className="hidden min-w-0 lg:block">{status}</aside> : null}
          </section>
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
  showAdmin,
  onChangePasscode,
  onOpenAdmin,
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
          className="absolute right-0 z-40 mt-2 w-64 overflow-hidden rounded-md border border-slate-800 bg-slate-950 shadow-2xl shadow-black/40"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <div className="border-b border-slate-800 px-4 py-3">
            <p className="truncate text-sm font-semibold text-slate-50">{accountLabel}</p>
            <p className="mt-1 truncate text-xs text-slate-400">{accountDetail}</p>
          </div>
          <div className="grid p-1" role="menu">
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
