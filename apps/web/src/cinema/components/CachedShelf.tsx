import { CheckCircle2, Database, Film, Loader2, RefreshCw, Route } from "lucide-react";
import type { CacheAsset, CreditPolicyResponse } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { formatBytes, formatDateTime, mediaQuality } from "../format";
import { copy } from "../i18n";
import { formatCreditAmount, playbackCreditCost } from "../types";
import { EmptyState } from "./EmptyState";
import { PreparedLineBadges, preparedLinesForAsset } from "./PreparedLineBadges";

export function CachedShelf({
  cachedAssets,
  creditPolicy,
  loading,
  onOpen,
  onRefresh
}: {
  cachedAssets: CacheAsset[];
  creditPolicy: CreditPolicyResponse;
  loading: boolean;
  onOpen: (asset: CacheAsset) => void;
  onRefresh: () => void;
}) {
  if (cachedAssets.length === 0 && loading) {
    return <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title={copy.cachedShelf.loading} />;
  }

  if (cachedAssets.length === 0) {
    return (
      <div className="grid gap-3">
        <div className="grid gap-2 sm:flex sm:justify-end">
          <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {copy.common.refresh}
          </Button>
        </div>
        <EmptyState icon={<Database className="h-5 w-5" />} title={copy.cachedShelf.empty} />
      </div>
    );
  }

  const domesticCount = cachedAssets.filter((asset) => preparedLinesForAsset(asset).includes("domestic")).length;
  const internationalCount = cachedAssets.filter((asset) => preparedLinesForAsset(asset).includes("international")).length;

  return (
    <div className="grid gap-4">
      <div className="overflow-hidden rounded-2xl border border-emerald-300/20 bg-[radial-gradient(circle_at_top_left,rgba(52,211,153,0.14),transparent_42%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.98))] p-4 shadow-xl shadow-black/10 sm:p-5">
        <div className="grid gap-4 sm:flex sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-emerald-200">
              <Film className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-black text-slate-50">已准备片库</h2>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                所有已准备内容都在这里。开始播放时，再按当前网络选择线路。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge variant="default">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {copy.cachedShelf.playableCount(cachedAssets.length)}
                </Badge>
                <Badge variant="secondary">国内 {domesticCount}</Badge>
                <Badge className="border-sky-400/25 text-sky-200" variant="secondary">国际 {internationalCount}</Badge>
              </div>
            </div>
          </div>
          <Button className="w-full shrink-0 sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {copy.common.refresh}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-2">
        {cachedAssets.map((asset) => (
          <Card key={asset.assetKey} className="group min-w-0 overflow-hidden rounded-xl border-slate-800 transition-colors hover:border-slate-700 sm:rounded-lg">
            <CardContent className="grid min-w-0 gap-4 p-4">
              <div className="grid gap-3 sm:flex sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="line-clamp-2 font-semibold leading-6 text-slate-50">{asset.title}</p>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    {mediaQuality(asset.media)} · {formatBytes(asset.media?.contentLength)} · {formatDateTime(asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt)}
                  </p>
                </div>
                <PreparedLineBadges asset={asset} />
              </div>
              <div className="flex flex-col gap-2 border-t border-slate-800 pt-3 sm:flex-row sm:items-center sm:justify-between">
                {creditPolicy.billingEnabled ? (
                  <Badge variant="warning">
                    {formatCreditAmount(playbackCreditCost(asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)}
                  </Badge>
                ) : (
                  <span className="text-xs font-semibold text-slate-500">在线播放不收费</span>
                )}
                <Button className="w-full shrink-0 sm:w-auto" type="button" onClick={() => onOpen(asset)}>
                  <Route className="h-4 w-4" />
                  选择线路播放
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
