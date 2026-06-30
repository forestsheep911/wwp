import { useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Database,
  Film,
  History,
  ListChecks,
  LogOut,
  Search,
  ShieldCheck
} from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import type { AppTab } from "../types";

interface CinemaLayoutProps {
  activeTab: AppTab;
  library: ReactNode;
  cached: ReactNode;
  history: ReactNode;
  admin?: ReactNode;
  showAdmin: boolean;
  status?: ReactNode;
  statusCount: number;
  onActiveTabChange: (value: AppTab) => void;
  onLock: () => void;
  onOpenSearch: () => void;
}

export function CinemaLayout({
  activeTab,
  library,
  cached,
  history,
  admin,
  showAdmin,
  status,
  statusCount,
  onActiveTabChange,
  onLock,
  onOpenSearch
}: CinemaLayoutProps) {
  const [statusCollapsed, setStatusCollapsed] = useState(false);
  const showDesktopStatus = Boolean(status) && !statusCollapsed;

  return (
    <main className="min-h-screen">
      <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as AppTab)}>
        <header className="border-b border-slate-800 bg-slate-950/70 backdrop-blur">
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
              <Button type="button" variant="outline" size="sm" onClick={onLock} title="Logout">
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Logout</span>
                <span className="sr-only sm:hidden">Logout</span>
              </Button>
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
