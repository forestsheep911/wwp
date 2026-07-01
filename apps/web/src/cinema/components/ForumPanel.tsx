import { type FormEvent } from "react";
import {
  CornerDownLeft,
  Loader2,
  MessageCircle,
  MessageSquareText,
  PenLine,
  RefreshCw,
  SendHorizontal
} from "lucide-react";
import type { ForumReplyEntry, ForumThreadEntry, ForumThreadSummary } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { formatDateTime } from "../format";
import { copy } from "../i18n";

interface ForumPanelProps {
  currentMemberId?: string;
  draftBody: string;
  draftTitle: string;
  error: string;
  loaded: boolean;
  loading: boolean;
  replyBody: string;
  replying: boolean;
  selectedThread?: ForumThreadEntry;
  submitting: boolean;
  threadLoading: boolean;
  threads: ForumThreadSummary[];
  onDraftBodyChange: (value: string) => void;
  onDraftTitleChange: (value: string) => void;
  onRefresh: () => void;
  onReplyBodyChange: (value: string) => void;
  onSelectThread: (threadId: string) => void;
  onSubmitReply: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitThread: (event: FormEvent<HTMLFormElement>) => void;
}

function authorLabel(entry: Pick<ForumThreadSummary, "authorMemberName" | "authorRole">) {
  if (entry.authorRole === "admin") {
    return copy.common.admin;
  }

  return entry.authorMemberName ?? copy.common.member;
}

function activityLabel(thread: ForumThreadSummary) {
  const at = thread.lastReplyAt ?? thread.updatedAt ?? thread.createdAt;
  return thread.replyCount > 0
    ? copy.forum.lastReplyAt(formatDateTime(at))
    : copy.forum.createdAt(formatDateTime(thread.createdAt));
}

function AuthorLine({
  entry,
  currentMemberId
}: {
  entry: Pick<ForumReplyEntry, "authorMemberId" | "authorMemberName" | "authorRole" | "createdAt">;
  currentMemberId?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
      <span className="font-semibold text-slate-300">{authorLabel(entry)}</span>
      {entry.authorMemberId && entry.authorMemberId === currentMemberId ? (
        <Badge variant="muted">{copy.forum.me}</Badge>
      ) : null}
      <span>{formatDateTime(entry.createdAt)}</span>
    </div>
  );
}

export function ForumPanel({
  currentMemberId,
  draftBody,
  draftTitle,
  error,
  loaded,
  loading,
  replyBody,
  replying,
  selectedThread,
  submitting,
  threadLoading,
  threads,
  onDraftBodyChange,
  onDraftTitleChange,
  onRefresh,
  onReplyBodyChange,
  onSelectThread,
  onSubmitReply,
  onSubmitThread
}: ForumPanelProps) {
  return (
    <section className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-slate-50">{copy.forum.title}</h2>
          <p className="mt-1 text-sm text-slate-400">{copy.forum.description}</p>
        </div>
        <Button type="button" variant="outline" onClick={onRefresh} disabled={loading || threadLoading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {copy.common.refresh}
        </Button>
      </div>

      {error ? (
        <p className="rounded border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200">
          {error}
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(20rem,0.85fr)_minmax(0,1.35fr)]">
        <div className="grid min-w-0 content-start gap-4">
          <form className="grid gap-3 rounded-md border border-slate-800 bg-slate-950/70 p-4" onSubmit={onSubmitThread}>
            <div className="flex items-center gap-2">
              <PenLine className="h-4 w-4 text-emerald-300" />
              <p className="text-sm font-semibold text-slate-100">{copy.forum.newThread}</p>
            </div>
            <input
              className="h-10 min-w-0 rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              maxLength={120}
              placeholder={copy.forum.titlePlaceholder}
              value={draftTitle}
              onChange={(event) => onDraftTitleChange(event.target.value)}
            />
            <textarea
              className="min-h-28 resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-6 text-slate-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
              maxLength={5000}
              placeholder={copy.forum.bodyPlaceholder}
              value={draftBody}
              onChange={(event) => onDraftBodyChange(event.target.value)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-500">{draftBody.length}/5000</p>
              <Button type="submit" disabled={submitting || !draftTitle.trim() || !draftBody.trim()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                {copy.forum.publish}
              </Button>
            </div>
          </form>

          <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-950/60">
            <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-4 py-3">
              <p className="text-sm font-semibold text-slate-100">{copy.forum.threadList}</p>
              <Badge variant="secondary">{threads.length}</Badge>
            </div>

            {loading && !loaded ? (
              <div className="flex min-h-24 items-center gap-2 px-4 py-6 text-sm font-semibold text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                {copy.forum.loadingThreads}
              </div>
            ) : threads.length === 0 ? (
              <div className="flex min-h-24 items-center px-4 py-6 text-sm text-slate-400">{copy.forum.emptyThreads}</div>
            ) : (
              <div className="grid max-h-[38rem] overflow-auto divide-y divide-slate-800">
                {threads.map((thread) => {
                  const active = selectedThread?.id === thread.id;
                  return (
                    <button
                      key={thread.id}
                      className={`grid gap-2 px-4 py-3 text-left transition-colors ${
                        active ? "bg-emerald-400/10" : "bg-transparent hover:bg-slate-900/80"
                      }`}
                      type="button"
                      onClick={() => onSelectThread(thread.id)}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <p className="line-clamp-2 text-sm font-semibold text-slate-100">{thread.title}</p>
                        <Badge variant={thread.replyCount > 0 ? "default" : "secondary"}>
                          {thread.replyCount}
                        </Badge>
                      </div>
                      <p className="line-clamp-2 text-xs leading-5 text-slate-400">{thread.body}</p>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{authorLabel(thread)}</span>
                        <span>{activityLabel(thread)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <article className="min-h-[18rem] min-w-0 rounded-md border border-slate-800 bg-slate-950/60">
          {threadLoading && !selectedThread ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm font-semibold text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy.forum.loadingThread}
            </div>
          ) : selectedThread ? (
            <div className="grid gap-5 p-4 sm:p-5">
              <header className="grid gap-3 border-b border-slate-800 pb-5">
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-5 w-5 text-emerald-300" />
                  <Badge variant="secondary">{copy.forum.replies(selectedThread.replyCount)}</Badge>
                </div>
                <h3 className="break-words text-2xl font-semibold leading-tight text-slate-50">{selectedThread.title}</h3>
                <AuthorLine entry={selectedThread} currentMemberId={currentMemberId} />
                <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">{selectedThread.body}</p>
              </header>

              <div className="grid gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <MessageCircle className="h-4 w-4 text-sky-300" />
                  {copy.forum.discussion}
                </div>

                {selectedThread.replies.length === 0 ? (
                  <div className="rounded border border-slate-800 bg-slate-950/70 px-4 py-5 text-sm text-slate-400">
                    {copy.forum.emptyReplies}
                  </div>
                ) : (
                  <div className="grid gap-3">
                    {selectedThread.replies.map((reply) => (
                      <div key={reply.id} className="grid gap-2 rounded-md border border-slate-800 bg-slate-950/70 p-4">
                        <AuthorLine entry={reply} currentMemberId={currentMemberId} />
                        <p className="whitespace-pre-wrap break-words text-sm leading-7 text-slate-200">{reply.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <form className="grid gap-3 border-t border-slate-800 pt-4" onSubmit={onSubmitReply}>
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <CornerDownLeft className="h-4 w-4 text-emerald-300" />
                  {copy.forum.reply}
                </div>
                <textarea
                  className="min-h-28 resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-6 text-slate-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
                  maxLength={5000}
                  placeholder={copy.forum.replyPlaceholder}
                  value={replyBody}
                  onChange={(event) => onReplyBodyChange(event.target.value)}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-500">{replyBody.length}/5000</p>
                  <Button type="submit" disabled={replying || !replyBody.trim()}>
                    {replying ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
                    {copy.forum.sendReply}
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div className="grid justify-items-center gap-3 px-5 py-12 text-center">
              <MessageCircle className="h-8 w-8 text-slate-500" />
              <p className="text-sm text-slate-400">{copy.forum.selectThread}</p>
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
