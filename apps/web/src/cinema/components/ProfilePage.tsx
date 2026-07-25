import type { ReactNode } from "react";
import {
  Bell,
  BookOpen,
  ChevronRight,
  CircleUserRound,
  Clapperboard,
  Clock3,
  Database,
  Library,
  ListChecks,
  LogOut,
  MessageCircle,
  MessageSquarePlus,
  Moon,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Sun
} from "lucide-react";
import type { AppTheme } from "../types";

interface ProfilePageProps {
  accountLabel: string;
  accountDetail: string;
  canChangePasscode: boolean;
  canRequestMovie: boolean;
  noticeUnreadCount: number;
  showAdmin: boolean;
  theme: AppTheme;
  onLock: () => void;
  onOpenAdmin: () => void;
  onOpenCached: () => void;
  onOpenFavorites: () => void;
  onOpenForum: () => void;
  onOpenHelp: () => void;
  onOpenHistory: () => void;
  onOpenMovieRequest: () => void;
  onOpenNotices: () => void;
  onOpenNowPlaying: () => void;
  onOpenProfile: () => void;
  onOpenSpending: () => void;
  onOpenTasks: () => void;
  onToggleTheme: () => void;
}

export function ProfilePage({
  accountLabel,
  accountDetail,
  canChangePasscode,
  canRequestMovie,
  noticeUnreadCount,
  showAdmin,
  theme,
  onLock,
  onOpenAdmin,
  onOpenCached,
  onOpenFavorites,
  onOpenForum,
  onOpenHelp,
  onOpenHistory,
  onOpenMovieRequest,
  onOpenNotices,
  onOpenNowPlaying,
  onOpenProfile,
  onOpenSpending,
  onOpenTasks,
  onToggleTheme
}: ProfilePageProps) {
  return (
    <section className="mx-auto grid max-w-2xl gap-5 pb-3" aria-labelledby="profile-page-title">
      <div className="relative overflow-hidden rounded-[1.75rem] border border-emerald-300/20 bg-slate-900 px-5 py-6 shadow-xl shadow-black/20">
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-emerald-300/10 blur-3xl" />
        <div className="relative flex items-center gap-4">
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl border border-emerald-200/25 bg-emerald-300/10 text-emerald-200">
            <CircleUserRound className="h-8 w-8" />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-[0.18em] text-emerald-300">我的影院</p>
            <h1 id="profile-page-title" className="mt-1 truncate text-2xl font-semibold text-slate-50">
              {accountLabel}
            </h1>
            <p className="mt-1 text-sm text-slate-400">{accountDetail}</p>
          </div>
        </div>
      </div>

      <ProfileSection title="我的片库">
        <ProfileAction icon={<Library />} label="我的片单" detail="喜欢、想看和已经看过的影片" onClick={onOpenFavorites} />
        <ProfileAction icon={<Clock3 />} label="播放历史" detail="接着看或重新准备" onClick={onOpenHistory} />
        <ProfileAction icon={<Database />} label="已准备影片" detail="当前可以直接播放的资源" onClick={onOpenCached} />
      </ProfileSection>

      <ProfileSection title="观看动态">
        <ProfileAction icon={<ListChecks />} label="准备任务" detail="查看缓存进度和结果" onClick={onOpenTasks} />
        <ProfileAction icon={<Clapperboard />} label="最近在看" detail="家庭影院近期播放" onClick={onOpenNowPlaying} />
        <ProfileAction icon={<MessageCircle />} label="家庭讨论" detail="分享片单和观后感" onClick={onOpenForum} />
      </ProfileSection>

      <ProfileSection title="服务与账号">
        {canRequestMovie ? (
          <ProfileAction icon={<MessageSquarePlus />} label="请求补片" detail="片库没有时告诉管理员" onClick={onOpenMovieRequest} />
        ) : null}
        {canChangePasscode ? (
          <>
            <ProfileAction
              badge={noticeUnreadCount > 0 ? String(noticeUnreadCount) : undefined}
              icon={<Bell />}
              label="站内信"
              detail="查看管理员通知"
              onClick={onOpenNotices}
            />
            <ProfileAction icon={<ReceiptText />} label="代币记录" detail="查看准备和播放消耗" onClick={onOpenSpending} />
            <ProfileAction icon={<Settings2 />} label="账号与设备" detail="姓名、通行码和登录设备" onClick={onOpenProfile} />
          </>
        ) : null}
        {showAdmin ? (
          <ProfileAction icon={<ShieldCheck />} label="管理后台" detail="成员、资源和系统管理" onClick={onOpenAdmin} />
        ) : null}
        <ProfileAction icon={<BookOpen />} label="使用说明" detail="播放、缓存和代币说明" onClick={onOpenHelp} />
        <ProfileAction
          icon={theme === "dark" ? <Sun /> : <Moon />}
          label={theme === "dark" ? "切换浅色外观" : "切换深色外观"}
          detail="只影响当前设备"
          onClick={onToggleTheme}
        />
      </ProfileSection>

      <button
        className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-rose-300/20 bg-rose-400/5 px-4 text-sm font-semibold text-rose-200 transition active:scale-[0.99] active:bg-rose-400/10"
        type="button"
        onClick={onLock}
      >
        <LogOut className="h-4 w-4" />
        退出当前账号
      </button>
    </section>
  );
}

function ProfileSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="px-1 text-xs font-semibold tracking-[0.16em] text-slate-500">{title}</h2>
      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/75">
        {children}
      </div>
    </section>
  );
}

function ProfileAction({
  badge,
  detail,
  icon,
  label,
  onClick
}: {
  badge?: string;
  detail: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="group flex min-h-[4.5rem] w-full items-center gap-3 border-b border-slate-800/85 px-4 text-left transition last:border-b-0 active:bg-slate-800/80"
      type="button"
      onClick={onClick}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-800 text-emerald-300 [&>svg]:h-[1.15rem] [&>svg]:w-[1.15rem]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          {label}
          {badge ? (
            <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-amber-300 px-1.5 text-[10px] font-bold text-slate-950">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-xs text-slate-500">{detail}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-600 transition-transform group-active:translate-x-0.5" />
    </button>
  );
}
