import { type FormEvent } from "react";
import { Clock3, Loader2, MessageSquarePlus, SendHorizontal } from "lucide-react";
import type { MovieRequestEntry, MovieRequestStatus } from "@wwpdw/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { formatDateTime } from "../format";
import type { BadgeVariant } from "../types";

interface MovieRequestDialogProps {
  error: string;
  loading: boolean;
  open: boolean;
  requestText: string;
  requests: MovieRequestEntry[];
  onOpenChange: (open: boolean) => void;
  onRequestTextChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

function movieRequestStatusLabel(status: MovieRequestStatus) {
  const labels: Record<MovieRequestStatus, string> = {
    new: "New",
    planned: "Planned",
    fulfilled: "Ready",
    dismissed: "Closed"
  };
  return labels[status];
}

function movieRequestVariant(status: MovieRequestStatus): BadgeVariant {
  const variants: Record<MovieRequestStatus, BadgeVariant> = {
    new: "secondary",
    planned: "warning",
    fulfilled: "default",
    dismissed: "muted"
  };
  return variants[status];
}

export function MovieRequestDialog({
  error,
  loading,
  open,
  requestText,
  requests,
  onOpenChange,
  onRequestTextChange,
  onSubmit
}: MovieRequestDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,760px)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="h-5 w-5 text-emerald-300" />
            Request movie
          </DialogTitle>
          <DialogDescription>
            Tell the household library what you want to watch.
          </DialogDescription>
        </DialogHeader>

        <form className="grid gap-3" onSubmit={onSubmit}>
          <textarea
            className="min-h-32 resize-y rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm leading-6 text-slate-100 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30"
            maxLength={2000}
            placeholder="Movie title, year, actor, language, edition, or anything you remember..."
            value={requestText}
            onChange={(event) => onRequestTextChange(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">{requestText.length}/2000</p>
            <Button type="submit" disabled={loading || !requestText.trim()}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizontal className="h-4 w-4" />}
              Submit
            </Button>
          </div>
        </form>

        {error ? (
          <p className="rounded border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm font-semibold text-rose-200">
            {error}
          </p>
        ) : null}

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-200">My requests</p>
            <Badge variant="secondary">{requests.length}</Badge>
          </div>

          {loading && requests.length === 0 ? (
            <div className="flex items-center gap-2 rounded border border-slate-800 bg-slate-950/70 px-4 py-5 text-sm font-semibold text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading requests
            </div>
          ) : requests.length === 0 ? (
            <div className="rounded border border-slate-800 bg-slate-950/70 px-4 py-5 text-sm text-slate-400">
              No movie requests yet.
            </div>
          ) : (
            <div className="max-h-[34vh] overflow-auto rounded border border-slate-800">
              <div className="grid divide-y divide-slate-800">
                {requests.map((request) => (
                  <div key={request.id} className="grid gap-2 bg-slate-950/50 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <div className="min-w-0">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-100">{request.text}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        <Clock3 className="mr-1 inline h-3.5 w-3.5" />
                        {formatDateTime(request.requestedAt)}
                      </p>
                    </div>
                    <Badge variant={movieRequestVariant(request.status)}>
                      {movieRequestStatusLabel(request.status)}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
