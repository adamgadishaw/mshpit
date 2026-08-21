import { generateVideoPosterAsset, releaseVideoPosterAsset } from "./videoPoster";
import { createMediaEditCapabilities } from "./mediaEditCapabilities.mjs";

export const mediaEditVideoCapabilities = createMediaEditCapabilities({
  platform: "native",
  videoCover: true,
});

export async function generateVideoCover(asset, options = {}) {
  const manual = (options.coverMode ?? asset?.edit?.coverMode) === "manual";
  const requestedTimeMs = manual
    ? Math.max(0, Math.round(Number(options.coverMs ?? asset?.edit?.coverMs ?? asset?.posterTimeMs) || 0))
    : null;
  const posterOptions = {
    maxDimension: options.maxDimension || options.maxWidth,
    quality: options.quality,
    timeoutMs: options.timeoutMs,
    signal: options.signal,
  };
  if (requestedTimeMs != null) posterOptions.timeMs = requestedTimeMs;
  const result = await generateVideoPosterAsset(
    { ...asset, type: "video", duration: asset?.durationMs, file: asset?.runtimeFile || asset?.file },
    posterOptions,
  );
  let released = false;
  const release = () => {
    if (released) return false;
    released = true;
    return releaseVideoPosterAsset(result.asset);
  };
  return {
    ...result.asset,
    requestedTimeMs: requestedTimeMs ?? result.timeMs,
    actualTimeMs: result.timeMs,
    durationMs: result.durationMs || asset?.durationMs || 0,
    engine: "pit-video-poster-v1",
    release,
    dispose: release,
  };
}
