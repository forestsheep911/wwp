import type { ReactNode } from "react";
import { CheckCircle2, Database, Film, History, Lock, ShieldCheck } from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import type { AppTab } from "../types";

interface CinemaLayoutProps {
  activeTab: AppTab;
  resultsCount: number;
  readyCount: number;
  library: ReactNode;
  cached: ReactNode;
  history: ReactNode;
  admin: ReactNode;
  status?: ReactNode;
  onActiveTabChange: (value: AppTab) => void;
  onLock: () => void;
}

export function CinemaLayout({
  activeTab,
  resultsCount,
  readyCount,
  library,
  cached,
  history,
  admin,
  status,
  onActiveTabChange,
  onLock
}: CinemaLayoutProps) {
  return (
    <main className="min-h-screen">
      <header className="border-b border-slate-800 bg-slate-950/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-5 py-4 sm:flex-row sm:items-center md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-800 bg-slate-900 text-emerald-200">
              <Film className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold text-slate-50 sm:text-xl">WW Family Cinema</h1>
              <p className="text-xs font-semibold uppercase tracking-normal text-emerald-300">Private household cinema</p>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            <Badge variant="secondary">{resultsCount} found</Badge>
            <Badge variant="default">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {readyCount} current ready
            </Badge>
            <Button type="button" variant="outline" size="sm" onClick={onLock} title="Lock cinema">
              <Lock className="h-4 w-4" />
              <span className="sr-only">Lock</span>
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-5 py-6 md:px-8">
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as AppTab)}>
              <div className="mb-5">
                <TabsList>
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
                  <TabsTrigger value="admin">
                    <ShieldCheck className="h-4 w-4" />
                    <span className="sm:hidden">管理</span>
                    <span className="hidden sm:inline">Admin</span>
                  </TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="library">{library}</TabsContent>
              <TabsContent value="cached">{cached}</TabsContent>
              <TabsContent value="history">{history}</TabsContent>
              <TabsContent value="admin">{admin}</TabsContent>
            </Tabs>
          </div>

          {status ? <aside className="min-w-0">{status}</aside> : null}
        </section>
      </div>
    </main>
  );
}
