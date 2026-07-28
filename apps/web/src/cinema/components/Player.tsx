import { useCallback, useEffect, useRef, useState } from "react";
import Artplayer from "artplayer";
import { Play, TriangleAlert } from "lucide-react";
import type { PlaybackResponse } from "@wwpdw/shared";
import { Button } from "../../components/ui/button";
import { formatLongDate } from "../format";
import { copy } from "../i18n";
import { MediaDiagnosticsView } from "./MediaDiagnosticsView";
import {
  fatalPlaybackFailure,
  type FatalPlaybackFailure
} from "../media-compatibility";

const renewAheadMs = 10 * 60 * 1000;

function expiresInMs(expiresAt: string) {
  return new Date(expiresAt).getTime() - Date.now();
}

function ArtPlayerView({
  playback,
  onRenewPlayback,
  onFatalPlaybackError,
  onPlaybackEnded
}: {
  playback: PlaybackResponse;
  onRenewPlayback: () => Promise<PlaybackResponse | undefined>;
  onFatalPlaybackError: (failure: FatalPlaybackFailure) => void;
  onPlaybackEnded: () => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const artRef = useRef<Artplayer | null>(null);
  const playbackRef = useRef(playback);
  const onRenewPlaybackRef = useRef(onRenewPlayback);
  const onPlaybackEndedRef = useRef(onPlaybackEnded);
  const renewPromiseRef = useRef<Promise<PlaybackResponse | undefined> | undefined>(undefined);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    onRenewPlaybackRef.current = onRenewPlayback;
  }, [onRenewPlayback]);

  useEffect(() => {
    onPlaybackEndedRef.current = onPlaybackEnded;
  }, [onPlaybackEnded]);

  const renewPlayback = useCallback(async (force = false) => {
    const current = playbackRef.current;
    if (!force && expiresInMs(current.expiresAt) > renewAheadMs) {
      return current;
    }

    if (renewPromiseRef.current) {
      return renewPromiseRef.current;
    }

    const art = artRef.current;
    const resumeAt = art?.currentTime ?? 0;
    const wasPlaying = art?.playing ?? false;

    renewPromiseRef.current = onRenewPlaybackRef.current()
      .then(async (nextPlayback) => {
        const currentArt = artRef.current;
        if (!nextPlayback || !currentArt || currentArt.url === nextPlayback.playbackUrl) {
          return nextPlayback;
        }

        await currentArt.switchUrl(nextPlayback.playbackUrl);
        if (Number.isFinite(resumeAt) && resumeAt > 0) {
          currentArt.currentTime = Math.max(0, resumeAt - 0.25);
        }
        if (wasPlaying) {
          await currentArt.play().catch(() => undefined);
        }
        return nextPlayback;
      })
      .finally(() => {
        renewPromiseRef.current = undefined;
      });

    return renewPromiseRef.current;
  }, []);

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
    artRef.current = art;

    const renewIfNeeded = () => {
      void renewPlayback(false);
    };
    const handlePlaybackFailure = () => {
      const failure = fatalPlaybackFailure(art.video.error?.code);
      if (failure) {
        art.pause();
        onFatalPlaybackError(failure);
        return;
      }
      void renewPlayback(true);
    };
    const renewWhenVisible = () => {
      if (document.visibilityState === "visible") {
        renewIfNeeded();
      }
    };

    art.on("play", renewIfNeeded);
    art.on("seek", renewIfNeeded);
    art.on("video:waiting", renewIfNeeded);
    art.on("video:stalled", renewIfNeeded);
    art.on("video:error", handlePlaybackFailure);
    art.on("error", handlePlaybackFailure);
    art.on("video:ended", () => onPlaybackEndedRef.current());
    art.on("document:visibilitychange", renewWhenVisible);

    const renewTimer = window.setInterval(() => {
      if (art.playing) {
        renewIfNeeded();
      }
    }, 60_000);

    return () => {
      window.clearInterval(renewTimer);
      artRef.current = null;
      art.destroy(false);
    };
  }, [onFatalPlaybackError, playback.assetKey, renewPlayback]);

  useEffect(() => {
    const art = artRef.current;
    if (!art || art.url === playback.playbackUrl) {
      return;
    }

    const resumeAt = art.currentTime;
    const wasPlaying = art.playing;
    void art.switchUrl(playback.playbackUrl).then(async () => {
      if (Number.isFinite(resumeAt) && resumeAt > 0) {
        art.currentTime = Math.max(0, resumeAt - 0.25);
      }
      if (wasPlaying) {
        await art.play().catch(() => undefined);
      }
    });
  }, [playback.playbackUrl]);

  return <div ref={containerRef} className="aspect-video w-full bg-black" />;
}

export function Player({
  playback,
  onClose,
  onPlaybackEnded,
  onRenewPlayback
}: {
  playback: PlaybackResponse;
  onClose: () => void;
  onPlaybackEnded: () => void;
  onRenewPlayback: () => Promise<PlaybackResponse | undefined>;
}) {
  const isMock = playback.playbackUrl.startsWith("mock://");
  const [runtimeFailure, setRuntimeFailure] = useState<FatalPlaybackFailure>();
  const playbackBlocked = Boolean(runtimeFailure);
  const blockedTitle = runtimeFailure === "decode"
      ? copy.player.decodeFailedTitle
      : copy.player.sourceUnsupportedTitle;
  const blockedDescription = runtimeFailure === "decode"
      ? copy.player.decodeFailedDescription
      : copy.player.sourceUnsupportedDescription;

  useEffect(() => {
    setRuntimeFailure(undefined);
  }, [playback.assetKey, playback.playbackUrl]);

  return (
    <main className="min-h-[100dvh] px-0 py-0 sm:px-5 sm:py-6 md:px-8">
      <div className="mx-auto grid max-w-6xl gap-4 sm:gap-5">
        <div className="grid gap-3 px-3 pt-4 sm:flex sm:items-center sm:justify-between sm:px-0 sm:pt-0">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-emerald-300">{copy.player.nowPlaying}</p>
            <h1 className="mt-1 line-clamp-3 text-xl font-semibold text-slate-50 sm:text-2xl">{playback.title}</h1>
          </div>
          <Button className="w-full sm:w-auto" type="button" variant="outline" onClick={onClose}>
            {copy.player.back}
          </Button>
        </div>
        <div className="overflow-hidden border-y border-slate-800 bg-black shadow-2xl sm:rounded-lg sm:border">
          {playbackBlocked ? (
            <div className="grid min-h-[16rem] place-items-center px-5 py-10 text-center sm:aspect-video">
              <div className="grid max-w-lg place-items-center gap-3">
                <div className="grid h-14 w-14 place-items-center rounded-full border border-amber-300/35 bg-amber-300/10 text-amber-200">
                  <TriangleAlert className="h-6 w-6" />
                </div>
                <h2 className="text-lg font-semibold text-slate-50">{blockedTitle}</h2>
                <p className="text-sm leading-6 text-slate-400">{blockedDescription}</p>
                <Button type="button" variant="outline" onClick={onClose}>{copy.player.back}</Button>
              </div>
            </div>
          ) : isMock ? (
            <div className="grid aspect-video place-items-center text-slate-400">
              <div className="grid place-items-center gap-3">
                <div className="grid h-20 w-20 place-items-center rounded-full bg-emerald-400 text-slate-950">
                  <Play className="h-9 w-9" />
                </div>
                <p className="max-w-full truncate px-4 text-sm">{playback.assetKey}</p>
              </div>
            </div>
          ) : (
            <ArtPlayerView
              playback={playback}
              onRenewPlayback={onRenewPlayback}
              onFatalPlaybackError={setRuntimeFailure}
              onPlaybackEnded={onPlaybackEnded}
            />
          )}
        </div>
        <div className="px-3 sm:px-0">
          <MediaDiagnosticsView media={playback.media} />
        </div>
        <p className="px-3 pb-4 text-xs text-slate-500 sm:px-0 sm:pb-0">{copy.player.expiresAt(formatLongDate(playback.expiresAt))}</p>
      </div>
    </main>
  );
}
