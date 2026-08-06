import { History, Play, RefreshCw } from "lucide-react";
import type { CreditPolicyResponse, SearchResult } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import {
  formatBytes,
  formatLongDate,
  historyCacheLabel,
  historyCacheVariant
} from "../format";
import { copy } from "../i18n";
import type { HistoryAssetStatusMap, PlaybackHistoryEntry } from "../types";
import { EmptyState } from "./EmptyState";

export function HistoryPanel({
  creditPolicy,
  items,
  statusByAssetKey,
  onClear,
  onPlay,
  onRecache
}: {
  creditPolicy: CreditPolicyResponse;
  items: PlaybackHistoryEntry[];
  statusByAssetKey: HistoryAssetStatusMap;
  onClear: () => void;
  onPlay: (assetKey: string, result?: SearchResult) => void;
  onRecache: (entry: PlaybackHistoryEntry) => void;
}) {
  if (items.length === 0) {
    return <EmptyState icon={<History className="h-5 w-5" />} title={copy.history.empty} />;
  }

  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:flex sm:justify-end">
        <Button className="w-full sm:w-auto" type="button" variant="outline" size="sm" onClick={onClear}>
          {copy.history.clear}
        </Button>
      </div>
      {items.map((item) => (
        <Card key={`${item.assetKey}-${item.playedAt}`} className="rounded-xl sm:rounded-lg">
          <CardContent className="grid gap-3 p-4 sm:flex sm:items-center sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate font-semibold text-slate-50">{item.title}</p>
                <Badge variant={historyCacheVariant(statusByAssetKey[item.assetKey])}>
                  {historyCacheLabel(statusByAssetKey[item.assetKey])}
                </Badge>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-400 sm:leading-normal">
                {formatLongDate(item.playedAt)} / {item.contentType ?? copy.common.unknown} / {formatBytes(item.contentLength)}
              </p>
              {!statusByAssetKey[item.assetKey]?.playable && !item.result ? (
                <p className="mt-1 text-xs text-slate-500">{copy.history.recacheHint}</p>
              ) : null}
            </div>
            <div className="grid gap-2 sm:flex">
              {statusByAssetKey[item.assetKey]?.playable ? (
                <Button className="w-full sm:w-auto" type="button" size="sm" onClick={() => onPlay(item.assetKey, item.result)}>
                  <Play className="h-4 w-4" />
                  {copy.watchlist.play}
                </Button>
              ) : null}
              {!statusByAssetKey[item.assetKey]?.playable && item.result ? (
                <Button className="w-full sm:w-auto" type="button" size="sm" variant="secondary" onClick={() => onRecache(item)}>
                  <RefreshCw className="h-4 w-4" />
                  {copy.watchlist.prepare}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
