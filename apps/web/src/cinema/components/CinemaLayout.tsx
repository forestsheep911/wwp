import { useState, type ReactNode } from "react";
import {
  Bell,
  ChevronDown,
  CircleUserRound,
  Clapperboard,
  Compass,
  Flame,
  HelpCircle,
  History,
  House,
  Library,
  ListChecks,
  LogOut,
  MessageCircle,
  MessageSquarePlus,
  Moon,
  ReceiptText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Sun,
  UserCircle
} from "lucide-react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "../../components/ui/dropdown-menu";
import { Tabs, TabsContent } from "../../components/ui/tabs";
import { copy } from "../i18n";
import type { AppTab, AppTheme, BrowseChannel } from "../types";

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
  theme: AppTheme;
  library: ReactNode;
  cached: ReactNode;
  forum: ReactNode;
  history: ReactNode;
  favorites: ReactNode;
  watchlist: ReactNode;
  nowPlaying: ReactNode;
  help: ReactNode;
  profile: ReactNode;
  tasks?: ReactNode;
  admin?: ReactNode;
  showAdmin: boolean;
  onActiveTabChange: (value: AppTab) => void;
  onBrowseChannelChange: (value: BrowseChannel) => void;
  onLock: () => void;
  onOpenHome: () => void;
  onOpenHelp: () => void;
  onOpenForum: () => void;
  onOpenFavorites: () => void;
  onOpenHistory: () => void;
  onOpenWatchlist: () => void;
  onOpenNowPlaying: () => void;
  onOpenMovieRequest: () => void;
  onOpenNotices: () => void;
  onOpenProfile: () => void;
  onOpenSpending: () => void;
  onOpenTasks: () => void;
  onOpenSearch: () => void;
  onToggleTheme: () => void;
}

export function CinemaLayout({
  activeTab,
  activeBrowseChannel,
  accountLabel,
  accountDetail,
  canChangePasscode,
  canRequestMovie,
  noticeUnreadCount,
  theme,
  library,
  cached,
  forum,
  history,
  favorites,
  watchlist,
  nowPlaying,
  help,
  profile,
  tasks,
  admin,
  showAdmin,
  onActiveTabChange,
  onBrowseChannelChange,
  onLock,
  onOpenHome,
  onOpenHelp,
  onOpenForum,
  onOpenFavorites,
  onOpenHistory,
  onOpenWatchlist,
  onOpenNowPlaying,
  onOpenMovieRequest,
  onOpenNotices,
  onOpenProfile,
  onOpenSpending,
  onOpenTasks,
  onOpenSearch,
  onToggleTheme
}: CinemaLayoutProps) {
  const themeToggleTitle = theme === "dark" ? copy.layout.themeToLight : copy.layout.themeToDark;
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);

  return (
    <main className="min-h-[100dvh]">
      <Tabs value={activeTab} onValueChange={(value) => onActiveTabChange(value as AppTab)}>
        <header className="sticky top-0 z-[100] border-b border-slate-800 bg-slate-950/90 backdrop-blur">
          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] sm:gap-3 sm:px-5 sm:py-3 md:px-8 xl:px-10">
            <button
              className="group flex min-h-11 min-w-0 items-center gap-3 rounded-md text-left transition-colors hover:text-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              type="button"
              onClick={onOpenHome}
              title={copy.layout.homeTitle}
            >
              <img alt="" className="h-9 w-9 shrink-0 rounded-md sm:h-10 sm:w-10" src="/wwp-icon-64.png" />
              <span className="hidden min-w-0 sm:block">
                <h1 className="truncate text-lg font-semibold text-slate-50 sm:text-xl">{copy.app.name}</h1>
              </span>
            </button>

            {activeTab === "library" ? <nav
              aria-label={copy.layout.browseLabel}
              className="scrollbar-none order-3 col-span-2 -mx-1 hidden min-w-0 snap-x snap-mandatory items-center gap-2 overflow-x-auto px-1 pb-0.5 sm:flex lg:hidden"
            >
              {browseChannels.map((channel) => {
                const active = activeTab === "library" && activeBrowseChannel === channel.id;
                return (
                  <button
                    className={`relative min-h-10 flex-none snap-start rounded-full border px-4 text-sm font-semibold transition-colors ${
                      active
                        ? "border-emerald-300/45 bg-emerald-300/10 text-emerald-100"
                        : "border-slate-800 bg-slate-950/75 text-slate-300 hover:border-slate-700 hover:text-slate-100"
                    }`}
                    key={channel.id}
                    type="button"
                    aria-current={active ? "page" : undefined}
                    onClick={() => onBrowseChannelChange(channel.id)}
                  >
                    {channel.label}
                    <span
                      aria-hidden="true"
                      className={`absolute inset-x-4 -bottom-0.5 h-0.5 rounded-full transition-colors ${
                        active ? "bg-emerald-300" : "bg-transparent"
                      }`}
                    />
                  </button>
                );
              })}
            </nav> : null}

            <div className="order-2 flex min-w-0 items-center justify-end gap-2">
              <Button className="hidden sm:inline-flex" type="button" variant="outline" size="icon" onClick={onOpenHelp} title={copy.layout.help}>
                <HelpCircle className="h-4 w-4" />
                <span className="sr-only">{copy.layout.help}</span>
              </Button>
              <Button className="hidden sm:inline-flex" type="button" variant="outline" size="icon" onClick={onOpenForum} title={copy.layout.forum}>
                <MessageCircle className="h-4 w-4" />
                <span className="sr-only">{copy.layout.forum}</span>
              </Button>
              <Button className="hidden sm:inline-flex" type="button" variant="outline" size="icon" onClick={onOpenFavorites} title={copy.layout.favorites}>
                <Star className="h-4 w-4" />
                <span className="sr-only">{copy.layout.favorites}</span>
              </Button>
              <Button className="hidden sm:inline-flex" type="button" variant="outline" size="icon" onClick={onOpenWatchlist} title={copy.layout.watchlist}>
                <Clapperboard className="h-4 w-4" />
                <span className="sr-only">{copy.layout.watchlist}</span>
              </Button>
              <Button className="hidden sm:inline-flex" type="button" variant="outline" size="icon" onClick={onOpenNowPlaying} title={copy.layout.nowPlaying}>
                <Flame className="h-4 w-4" />
                <span className="sr-only">{copy.layout.nowPlaying}</span>
              </Button>
              <Button type="button" variant="outline" size="icon" onClick={onOpenSearch} title={copy.common.search}>
                <Search className="h-4 w-4" />
                <span className="sr-only">{copy.common.search}</span>
              </Button>
              <Button className="hidden sm:inline-flex" type="button" variant="outline" size="icon" onClick={onToggleTheme} title={themeToggleTitle}>
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                <span className="sr-only">{themeToggleTitle}</span>
              </Button>
              {canChangePasscode ? (
                <Button className="relative hidden sm:inline-flex" type="button" variant="outline" size="icon" onClick={onOpenNotices} title="站内信">
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
                <Button className="hidden sm:inline-flex" type="button" variant="outline" size="icon" onClick={onOpenSpending} title={copy.layout.spending}>
                  <ReceiptText className="h-4 w-4" />
                  <span className="sr-only">{copy.layout.spending}</span>
                </Button>
              ) : null}
              <div className="hidden sm:block">
                <AccountMenu
                  open={accountMenuOpen}
                  accountDetail={accountDetail}
                  accountLabel={accountLabel}
                  canChangePasscode={canChangePasscode}
                  canRequestMovie={canRequestMovie}
                  noticeUnreadCount={noticeUnreadCount}
                  showAdmin={showAdmin}
                  onOpenAdmin={() => onActiveTabChange("admin")}
                  onOpenFavorites={onOpenFavorites}
                  onOpenForum={onOpenForum}
                  onOpenHelp={onOpenHelp}
                  onOpenHistory={onOpenHistory}
                  onOpenWatchlist={onOpenWatchlist}
                  onOpenNowPlaying={onOpenNowPlaying}
                  onOpenMovieRequest={onOpenMovieRequest}
                  onOpenNotices={onOpenNotices}
                  onOpenProfile={onOpenProfile}
                  onOpenSpending={onOpenSpending}
                  onOpenTasks={onOpenTasks}
                  onLock={onLock}
                  onOpenChange={setAccountMenuOpen}
                />
              </div>
            </div>
          </div>
        </header>

        <div className="grid w-full gap-4 px-3 pb-[calc(var(--mobile-nav-height)+env(safe-area-inset-bottom)+1rem)] pt-3 sm:px-5 sm:pb-5 sm:pt-4 md:px-8 xl:px-10">
          <div className="min-w-0 overflow-x-clip">
            <TabsContent className="mt-0" value="library">{library}</TabsContent>
            <TabsContent className="mt-0" value="cached">{cached}</TabsContent>
            <TabsContent className="mt-0" value="forum">{forum}</TabsContent>
            <TabsContent className="mt-0" value="history">{history}</TabsContent>
            <TabsContent className="mt-0" value="favorites">{favorites}</TabsContent>
            <TabsContent className="mt-0" value="watchlist">{watchlist}</TabsContent>
            <TabsContent className="mt-0" value="nowPlaying">{nowPlaying}</TabsContent>
            <TabsContent className="mt-0" value="help">{help}</TabsContent>
            <TabsContent className="mt-0" value="profile">{profile}</TabsContent>
            {tasks ? <TabsContent className="mt-0" value="tasks">{tasks}</TabsContent> : null}
            {showAdmin ? <TabsContent className="mt-0" value="admin">{admin}</TabsContent> : null}
          </div>
        </div>
        <nav className="fixed inset-x-0 bottom-0 z-[90] w-full border-t border-slate-800 bg-slate-950/94 px-2 pb-[calc(0.375rem+env(safe-area-inset-bottom))] pt-1.5 shadow-2xl shadow-black/45 backdrop-blur sm:hidden" aria-label="手机快捷导航">
          <div className="mx-auto grid max-w-md grid-cols-5 gap-0.5">
            <MobileNavButton active={activeTab === "library"} icon={<House className="h-5 w-5" />} label="首页" onClick={onOpenHome} />
            <MobileNavButton active={activeTab === "watchlist"} icon={<Compass className="h-5 w-5" />} label="发现" onClick={onOpenWatchlist} />
            <MobileNavButton active={activeTab === "favorites"} icon={<Library className="h-5 w-5" />} label="片单" onClick={onOpenFavorites} />
            <MobileNavButton active={activeTab === "tasks"} icon={<ListChecks className="h-5 w-5" />} label="准备" onClick={onOpenTasks} />
            <MobileNavButton
              active={!["library", "watchlist", "favorites", "tasks"].includes(activeTab)}
              badge={noticeUnreadCount}
              icon={<CircleUserRound className="h-5 w-5" />}
              label="我的"
              onClick={() => onActiveTabChange("profile")}
            />
          </div>
        </nav>
      </Tabs>
    </main>
  );
}

function MobileNavButton({
  active,
  badge,
  icon,
  label,
  onClick
}: {
  active: boolean;
  badge?: number;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`grid min-h-12 place-items-center gap-0.5 rounded-xl px-0 text-[10px] font-bold leading-none transition-colors ${
        active
          ? "bg-emerald-300/12 text-emerald-100"
          : "text-slate-400 hover:bg-slate-900 hover:text-slate-100"
      }`}
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      <span className="relative">
        {icon}
        {badge && badge > 0 ? (
          <span className="absolute -right-2 -top-1.5 h-2.5 w-2.5 rounded-full border-2 border-slate-950 bg-amber-300" />
        ) : null}
      </span>
      <span className="max-w-full whitespace-nowrap">{label}</span>
    </button>
  );
}

function AccountMenu({
  open,
  accountLabel,
  accountDetail,
  canChangePasscode,
  canRequestMovie,
  noticeUnreadCount,
  showAdmin,
  onOpenAdmin,
  onOpenFavorites,
  onOpenForum,
  onOpenHelp,
  onOpenHistory,
  onOpenWatchlist,
  onOpenNowPlaying,
  onOpenMovieRequest,
  onOpenNotices,
  onOpenProfile,
  onOpenSpending,
  onOpenTasks,
  onOpenChange,
  onLock
}: {
  open: boolean;
  accountLabel: string;
  accountDetail: string;
  canChangePasscode: boolean;
  canRequestMovie: boolean;
  noticeUnreadCount: number;
  showAdmin: boolean;
  onOpenAdmin: () => void;
  onOpenFavorites: () => void;
  onOpenForum: () => void;
  onOpenHelp: () => void;
  onOpenHistory: () => void;
  onOpenWatchlist: () => void;
  onOpenNowPlaying: () => void;
  onOpenMovieRequest: () => void;
  onOpenNotices: () => void;
  onOpenProfile: () => void;
  onOpenSpending: () => void;
  onOpenTasks: () => void;
  onOpenChange: (open: boolean) => void;
  onLock: () => void;
}) {
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button className="px-3" type="button" variant="outline" title={copy.layout.account}>
          <UserCircle className="h-4 w-4" />
          <span className="hidden max-w-[8rem] truncate sm:inline">{accountLabel}</span>
          <ChevronDown className="h-4 w-4 transition-transform" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(16rem,calc(100vw-2.5rem))]">
        <DropdownMenuLabel className="flex min-w-0 items-center justify-between gap-3">
          <span className="min-w-0 truncate">{accountLabel}</span>
          <span className="shrink-0 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-1 text-xs font-bold leading-none text-emerald-100">
            {accountDetail}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onOpenHelp}>
          <HelpCircle className="h-4 w-4" />
          {copy.layout.help}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenTasks}>
          <ListChecks className="h-4 w-4" />
          {copy.layout.tasks}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenForum}>
          <MessageCircle className="h-4 w-4" />
          {copy.layout.forum}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenFavorites}>
          <Star className="h-4 w-4" />
          {copy.layout.favorites}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenHistory}>
          <History className="h-4 w-4" />
          {copy.layout.history}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenWatchlist}>
          <Clapperboard className="h-4 w-4" />
          {copy.layout.watchlist}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onOpenNowPlaying}>
          <Flame className="h-4 w-4" />
          {copy.layout.nowPlaying}
        </DropdownMenuItem>
        {showAdmin ? (
          <DropdownMenuItem onSelect={onOpenAdmin}>
            <ShieldCheck className="h-4 w-4" />
            {copy.layout.admin}
          </DropdownMenuItem>
        ) : null}
        {canRequestMovie ? (
          <DropdownMenuItem onSelect={onOpenMovieRequest}>
            <MessageSquarePlus className="h-4 w-4" />
            {copy.layout.request}
          </DropdownMenuItem>
        ) : null}
        {canChangePasscode ? (
          <DropdownMenuItem className="justify-between" onSelect={onOpenNotices}>
            <span className="flex items-center gap-2">
              <Bell className="h-4 w-4" />
              站内信
            </span>
            {noticeUnreadCount > 0 ? <Badge variant="warning">{noticeUnreadCount}</Badge> : null}
          </DropdownMenuItem>
        ) : null}
        {canChangePasscode ? (
          <DropdownMenuItem onSelect={onOpenSpending}>
            <ReceiptText className="h-4 w-4" />
            {copy.layout.spending}
          </DropdownMenuItem>
        ) : null}
        {canChangePasscode ? (
          <DropdownMenuItem onSelect={onOpenProfile}>
            <SlidersHorizontal className="h-4 w-4" />
            {copy.layout.settings}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-rose-200 hover:bg-rose-400/10 hover:text-rose-100 focus:bg-rose-400/10 focus:text-rose-100" onSelect={onLock}>
          <LogOut className="h-4 w-4" />
          {copy.layout.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
