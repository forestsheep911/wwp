import type { SearchResult } from "@wwpdw/shared";

type CodecMetadata = {
  videoCodec?: string;
};

export function videoCodecForAsset(results: Iterable<SearchResult>, assetKey: string) {
  for (const result of results) {
    const variant = result.variants?.find((candidate) => candidate.assetKey === assetKey);
    const variantCodec = variant?.metadata?.videoCodec?.trim();
    if (variantCodec) {
      return variantCodec;
    }

    if (result.assetKey === assetKey) {
      const resultCodec = (result.metadata as CodecMetadata | undefined)?.videoCodec?.trim();
      if (resultCodec) {
        return resultCodec;
      }

      if (result.variants?.length === 1) {
        const onlyVariantCodec = result.variants[0]?.metadata?.videoCodec?.trim();
        if (onlyVariantCodec) {
          return onlyVariantCodec;
        }
      }
    }
  }

  return undefined;
}

export function inferVideoCodec(...values: Array<string | undefined>) {
  const combined = values
    .filter((value): value is string => Boolean(value))
    .map((value) => {
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    })
    .join(" ")
    .toLowerCase();

  if (/(?:^|[^a-z0-9])(?:h\.?265|hevc|x265)(?:[^a-z0-9]|$)/i.test(combined)) return "hevc";
  if (/(?:^|[^a-z0-9])(?:h\.?264|avc|x264)(?:[^a-z0-9]|$)/i.test(combined)) return "h264";
  if (/(?:^|[^a-z0-9])av1(?:[^a-z0-9]|$)/i.test(combined)) return "av1";
  return undefined;
}
