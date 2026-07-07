import { Bell, CheckCircle2, Clock3, Inbox, Loader2 } from "lucide-react";
import type { MemberNoticeEntry } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { formatDateTime } from "../format";

interface NoticeInboxDialogProps {
  error: string;
  loading: boolean;
  notices: MemberNoticeEntry[];
  open: boolean;
  unreadCount: number;
  onMarkRead: (id: string) => void;
  onOpenChange: (open: boolean) => void;
}

export function NoticeInboxDialog({
  error,
  loading,
  notices,
  open,
  unreadCount,
  onMarkRead,
  onOpenChange
}: NoticeInboxDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-emerald-300" />
            站内信
            {unreadCount > 0 ? <Badge variant="warning">{unreadCount} 未读</Badge> : null}
          </DialogTitle>
          <DialogDescription>管理员公告和单独发送给你的消息会出现在这里。</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200 sm:rounded">
            {error}
          </p>
        ) : null}

        {loading && notices.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-8 text-sm font-semibold text-slate-300 sm:rounded">
            <Loader2 className="h-4 w-4 animate-spin" />
            正在加载站内信
          </div>
        ) : notices.length === 0 ? (
          <div className="grid place-items-center rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-10 text-center text-sm text-slate-400 sm:rounded">
            <Inbox className="mb-3 h-6 w-6 text-slate-500" />
            暂无站内信
          </div>
        ) : (
          <div className="max-h-[58dvh] overflow-auto rounded-xl border border-slate-800 sm:rounded">
            <div className="grid gap-2 p-2 sm:gap-0 sm:divide-y sm:divide-slate-800 sm:p-0">
              {notices.map((notice) => {
                const unread = !notice.readAt;
                return (
                  <article key={notice.id} className={`grid gap-3 rounded-lg p-3 sm:rounded-none ${unread ? "bg-emerald-400/8" : "bg-slate-950/50"}`}>
                    <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold text-slate-50">{notice.title}</h3>
                          <Badge variant={notice.audience === "all" ? "secondary" : "warning"}>
                            {notice.audience === "all" ? "公告" : "单独消息"}
                          </Badge>
                          {unread ? <Badge variant="default">未读</Badge> : null}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          <Clock3 className="mr-1 inline h-3.5 w-3.5" />
                          {formatDateTime(notice.createdAt)}
                        </p>
                      </div>
                      {unread ? (
                        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={() => onMarkRead(notice.id)} disabled={loading}>
                          <CheckCircle2 className="h-4 w-4" />
                          已读
                        </Button>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-200">{notice.body}</p>
                  </article>
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
