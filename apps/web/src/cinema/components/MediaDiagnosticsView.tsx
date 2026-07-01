import type { MediaDiagnostics } from "@wwpdw/shared";
import { Badge } from "../../components/ui/badge";
import {
  booleanLabel,
  formatBytes,
  mediaQuality,
  mp4StatusLabel,
  offsetLabel
} from "../format";
import { copy } from "../i18n";

export function MediaDiagnosticsView({ media }: { media?: MediaDiagnostics }) {
  if (!media) {
    return null;
  }

  return (
    <div className="grid gap-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-slate-500">{copy.media.title}</span>
        <Badge variant={media.mp4?.status === "late_moov" ? "warning" : "secondary"}>
          {mediaQuality(media)}
        </Badge>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <Metric label={copy.media.type} value={media.contentType ?? copy.common.unknown} />
        <Metric label={copy.media.size} value={formatBytes(media.contentLength)} />
        <Metric label={copy.media.range} value={booleanLabel(media.rangeSupported)} />
        <Metric label="MP4" value={mp4StatusLabel(media)} />
      </div>
      {media.mp4 ? (
        <p className="text-xs leading-5 text-slate-500">
          moov {offsetLabel(media.mp4.moovOffset)} / mdat {offsetLabel(media.mp4.mdatOffset)}
        </p>
      ) : null}
    </div>
  );
}

export function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
      <p className="truncate text-sm font-semibold text-slate-100">{value}</p>
    </div>
  );
}
