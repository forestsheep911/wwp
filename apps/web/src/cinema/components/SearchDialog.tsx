import type { FormEvent } from "react";
import { Loader2, Search } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";

interface SearchDialogProps {
  error: string;
  loading: boolean;
  open: boolean;
  query: string;
  onOpenChange: (open: boolean) => void;
  onQueryChange: (value: string) => void;
  onSearch: (event?: FormEvent<HTMLFormElement>) => void;
}

export function SearchDialog({
  error,
  loading,
  open,
  query,
  onOpenChange,
  onQueryChange,
  onSearch
}: SearchDialogProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    onSearch(event);
    if (query.trim()) {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(94vw,680px)] gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Search collection</DialogTitle>
          <DialogDescription>Find a title in the private cinema collection.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <div className="flex items-center gap-3 border-b border-slate-800 px-4 pr-12">
            <Search className="h-5 w-5 shrink-0 text-slate-500" />
            <Input
              autoFocus
              className="h-16 border-0 bg-transparent px-0 text-lg shadow-none focus-visible:ring-0"
              placeholder="Search collection"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          </div>
          {error ? <p className="px-4 pt-3 text-sm font-semibold text-rose-300">{error}</p> : null}
          <div className="flex items-center justify-end gap-2 px-4 py-3">
            <Button type="submit" disabled={!query.trim() || loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
