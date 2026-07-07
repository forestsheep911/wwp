import { CheckCircle2, Database, Loader2, Play, RefreshCw } from "lucide-react";
import type { CacheAsset, CreditPolicyResponse } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { formatBytes, formatDateTime, mediaQuality } from "../format";
import { copy } from "../i18n";
import { formatCreditAmount, playbackCreditCost } from "../types";
import { EmptyState } from "./EmptyState";

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
  onOpen: (assetKey: string) => void;
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

  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-between">
        <Badge variant="default">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {copy.cachedShelf.playableCount(cachedAssets.length)}
        </Badge>
        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {copy.common.refresh}
        </Button>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        {cachedAssets.map((asset) => (
          <Card key={asset.assetKey} className="min-w-0 overflow-hidden rounded-xl sm:rounded-lg">
            <CardContent className="grid min-w-0 gap-3 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="line-clamp-2 font-semibold leading-6 text-slate-50 sm:truncate">{asset.title}</p>
                <p className="mt-1 text-sm leading-6 text-slate-400 sm:leading-normal">
                  {mediaQuality(asset.media)} / {formatBytes(asset.media?.contentLength)} / {formatDateTime(asset.lastPlayedAt ?? asset.cachedAt ?? asset.lastRequestedAt)}
                </p>
              </div>
              <Button className="w-full shrink-0 sm:w-auto" type="button" onClick={() => onOpen(asset.assetKey)}>
                <Play className="h-4 w-4" />
                {formatCreditAmount(playbackCreditCost(asset.media?.contentLength, creditPolicy), creditPolicy.unitSymbol)}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
