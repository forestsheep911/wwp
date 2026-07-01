import { useEffect, useRef } from "react";
import Artplayer from "artplayer";
import { Play } from "lucide-react";
import type { PlaybackResponse } from "@wwpdw/shared";
import { Button } from "../../components/ui/button";
import { formatLongDate } from "../format";
import { copy } from "../i18n";
import { MediaDiagnosticsView } from "./MediaDiagnosticsView";

function ArtPlayerView({ playback }: { playback: PlaybackResponse }) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const art = new Artplayer({
      container: containerRef.current,
      url: playback.playbackUrl,
      theme: "#34d399",
      volume: 0.8,
      autoplay: false,
      autoSize: true,
      autoPlayback: true,
      hotkey: true,
      mutex: true,
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      pip: true,
      fullscreen: true,
      fullscreenWeb: true,
      miniProgressBar: true,
      playsInline: true,
      lock: true,
      fastForward: true,
      moreVideoAttr: {
        preload: "metadata"
      }
    });

    return () => {
      art.destroy(false);
    };
  }, [playback.playbackUrl]);

  return <div ref={containerRef} className="aspect-video w-full bg-black" />;
}

export function Player({
  playback,
  onClose
}: {
  playback: PlaybackResponse;
  onClose: () => void;
}) {
  const isMock = playback.playbackUrl.startsWith("mock://");

  return (
    <main className="min-h-screen px-3 py-4 sm:px-5 sm:py-6 md:px-8">
      <div className="mx-auto grid max-w-6xl gap-5">
        <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-300">{copy.player.nowPlaying}</p>
            <h1 className="mt-1 line-clamp-3 text-xl font-semibold text-slate-50 sm:text-2xl">{playback.title}</h1>
          </div>
          <Button className="w-full sm:w-auto" type="button" variant="outline" onClick={onClose}>
            {copy.player.back}
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-slate-800 bg-black shadow-2xl">
          {isMock ? (
            <div className="grid aspect-video place-items-center text-slate-400">
              <div className="grid place-items-center gap-3">
                <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-400 text-slate-950">
                  <Play className="h-9 w-9" />
                </div>
                <p className="max-w-full truncate px-4 text-sm">{playback.assetKey}</p>
              </div>
            </div>
          ) : (
            <ArtPlayerView playback={playback} />
          )}
        </div>
        <MediaDiagnosticsView media={playback.media} />
        <p className="text-xs text-slate-500">{copy.player.expiresAt(formatLongDate(playback.expiresAt))}</p>
      </div>
    </main>
  );
}
