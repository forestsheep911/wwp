import { navigatePage, useLocationRoute } from "../navigation";
import { routeFromUrl } from "../routing";
import { resolveIdentity } from "../public-identities";
import { lazy, Suspense } from "react";
import type { PublicPersonDetail, SearchResult } from "@wwpdw/shared";
import { Network } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";

const RelationshipGraph = lazy(() => import("./RelationshipGraph"));
export type RelationshipSeed = { work: SearchResult } | { person: PublicPersonDetail };

export function RelationshipExplorer({ seed }: { seed: RelationshipSeed }) {
  const route = useLocationRoute();
  const open = route.graph === true;
  const setOpen = (value: boolean) => {
    if (value) navigatePage({ ...route, graph: true, page: "graph", params: { depth: "2", limit: "60", branches: "12" } });
    else {
      const origin = window.history.state?.graphOrigin as string | undefined;
      navigatePage(origin ? routeFromUrl(new URL(origin, location.origin)) : { ...route, graph: false, page: "list", params: {} }, "push");
    }
  };
  return <>
    <Button variant="outline" className="w-fit" onClick={() => setOpen(true)}><Network className="h-4 w-4" />探索影视关系</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="inset-0 flex h-dvh max-h-none w-screen flex-col gap-0 overflow-hidden rounded-none border-0 p-0 pb-0 sm:inset-0 sm:h-dvh sm:w-screen sm:translate-x-0 sm:translate-y-0 sm:rounded-none sm:p-0">
        <header className="flex shrink-0 items-center gap-3 border-b border-white/5 px-5 pb-3 pr-16 pt-[max(.75rem,env(safe-area-inset-top))] sm:px-6 sm:pr-16">
          <Network className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
          <div className="flex flex-1 items-center justify-between gap-4">
            <DialogTitle className="text-base tracking-wide">影视关系</DialogTitle>
            <DialogDescription className="sr-only text-xs sm:not-sr-only">点击节点探索 · 拖动画布移动 · 滚轮或双指缩放</DialogDescription>
          </div>
        </header>
        {open && <Suspense fallback={<p className="grid flex-1 place-items-center text-sm text-slate-400" role="status">正在加载关系图…</p>}><RelationshipGraph seed={seed} onClose={() => setOpen(false)} onNavigate={node => {
          const workKey = node.work?.assetKey ?? (node.workId ? resolveIdentity("work", node.workId)?.key : undefined);
          if (node.personId && !resolveIdentity("person", node.personId)) return false;
          if (!node.personId && !workKey) return false;
          navigatePage({ ...route, tab: node.personId ? "people" : "library", graph: true, page: "graph", personId: node.personId, detailAssetKey: node.personId ? undefined : workKey, playerAssetKey: undefined, query: "" });
          return true;
        }} /></Suspense>}
      </DialogContent>
    </Dialog>
  </>;
}
