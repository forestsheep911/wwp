import { Check, Globe2, MapPin } from "lucide-react";
import type { CacheAsset, PlaybackLine } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";

export function preparedLinesForAsset(asset: CacheAsset): PlaybackLine[] {
  if (asset.preparedLines?.length) {
    return asset.preparedLines;
  }
  if (asset.status !== "ready") {
    return [];
  }
  return [asset.line ?? "international"];
}

export function PreparedLineBadges({ asset }: { asset: CacheAsset }) {
  const lines = preparedLinesForAsset(asset);
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="可播放线路">
      {lines.includes("domestic") ? (
        <Badge variant="default" title="国内线路已准备">
          <MapPin className="h-3 w-3" />
          国内可播
          <Check className="h-3 w-3" />
        </Badge>
      ) : null}
      {lines.includes("international") ? (
        <Badge className="border-sky-400/30 bg-sky-400/10 text-sky-200" variant="secondary" title="国际线路已准备">
          <Globe2 className="h-3 w-3" />
          国际可播
          <Check className="h-3 w-3" />
        </Badge>
      ) : null}
    </div>
  );
}
