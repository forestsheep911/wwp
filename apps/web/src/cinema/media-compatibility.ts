import type { SearchResult } from "@wwpdw/shared";

export type VideoCompatibilityStatus = "supported" | "unsupported" | "unknown";

export interface VideoCompatibility {
  codec?: string;
  status: VideoCompatibilityStatus;
}

type CanPlayType = (mimeType: string) => string;

export function normalizeVideoCodec(codec?: string) {
  const normalized = codec?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (/^(?:h\.?265|hevc|x265)$/.test(normalized)) return "hevc";
  if (/^(?:h\.?264|avc|x264)$/.test(normalized)) return "h264";
  if (/^av1$/.test(normalized)) return "av1";
  return normalized;
}

export function variantVideoCodec(result?: SearchResult, assetKey?: string) {
  if (!result || !assetKey) return undefined;
  const variant = result.variants?.find((candidate) => candidate.assetKey === assetKey)
    ?? (result.assetKey === assetKey && result.variants?.length === 1 ? result.variants[0] : undefined);
  return normalizeVideoCodec(variant?.metadata?.videoCodec);
}

export function videoCompatibility(
  codec?: string,
  canPlayType?: CanPlayType
): VideoCompatibility {
  const normalized = normalizeVideoCodec(codec);
  if (!normalized) return { status: "unknown" };
  if (!canPlayType) return { codec: normalized, status: "unknown" };

  if (normalized === "hevc") {
    const supported = [
      'video/mp4; codecs="hvc1"',
      'video/mp4; codecs="hev1"'
    ].some((mimeType) => Boolean(canPlayType(mimeType)));
    return { codec: normalized, status: supported ? "supported" : "unsupported" };
  }

  if (normalized === "h264") {
    const supported = Boolean(canPlayType('video/mp4; codecs="avc1.42E01E"'));
    return { codec: normalized, status: supported ? "supported" : "unknown" };
  }

  if (normalized === "av1") {
    const supported = Boolean(canPlayType('video/mp4; codecs="av01.0.05M.08"'));
    return { codec: normalized, status: supported ? "supported" : "unknown" };
  }

  return { codec: normalized, status: "unknown" };
}

export function browserVideoCompatibility(codec?: string) {
  if (typeof document === "undefined") return videoCompatibility(codec);
  const video = document.createElement("video");
  return videoCompatibility(codec, (mimeType) => video.canPlayType(mimeType));
}
