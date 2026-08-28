export const VIDEO_POSTER_ERROR_CODES = Object.freeze({
  aborted: "PIT_POSTER_ABORTED",
  timeout: "PIT_POSTER_TIMEOUT",
  sourceInvalid: "PIT_POSTER_SOURCE_INVALID",
  crossOriginBlocked: "PIT_POSTER_CROSS_ORIGIN_BLOCKED",
  loadFailed: "PIT_POSTER_LOAD_FAILED",
  frameFailed: "PIT_POSTER_FRAME_FAILED",
  lowQuality: "PIT_POSTER_LOW_QUALITY",
  encodeFailed: "PIT_POSTER_ENCODE_FAILED",
});

export const MAX_AUTO_POSTER_CANDIDATES = 6;
export const STRONG_AUTO_POSTER_FRAME_SCORE = 40;

const ERROR_MESSAGES = Object.freeze({
  [VIDEO_POSTER_ERROR_CODES.aborted]: "Poster generation was cancelled.",
  [VIDEO_POSTER_ERROR_CODES.timeout]: "Poster generation took too long.",
  [VIDEO_POSTER_ERROR_CODES.sourceInvalid]: "The selected video could not be read.",
  [VIDEO_POSTER_ERROR_CODES.crossOriginBlocked]: "This legacy video host does not allow a safe preview to be created.",
  [VIDEO_POSTER_ERROR_CODES.loadFailed]: "The selected video could not be loaded.",
  [VIDEO_POSTER_ERROR_CODES.frameFailed]: "A preview frame could not be extracted from the video.",
  [VIDEO_POSTER_ERROR_CODES.lowQuality]: "No clear automatic preview was found. Choose a cover frame in the photo and video editor.",
  [VIDEO_POSTER_ERROR_CODES.encodeFailed]: "The preview frame could not be saved.",
});

export class VideoPosterError extends Error {
  constructor(code, message = ERROR_MESSAGES[code] || "The video preview could not be created.", options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "VideoPosterError";
    this.code = code;
  }
}

export function videoPosterError(error, fallbackCode) {
  if (error instanceof VideoPosterError) return error;
  return new VideoPosterError(fallbackCode, ERROR_MESSAGES[fallbackCode], { cause: error });
}

export function videoPosterSourceNeedsCorsProbe(uri, pageHref = null) {
  try {
    const source = new URL(String(uri || ""), pageHref || undefined);
    if (!pageHref) return true;
    return source.origin !== new URL(String(pageHref)).origin;
  } catch {
    // An unparseable or context-free remote source never gets to bypass the
    // safety probe. The caller's normal source validation supplies final copy.
    return true;
  }
}

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function normalizeVideoPosterOptions(asset = {}, options = {}) {
  const durationMs = Math.max(0, Math.round(finite(asset.durationMs ?? asset.duration, 0)));
  const explicitTime = options.timeMs != null && Number.isFinite(Number(options.timeMs));
  return {
    durationMs,
    explicitTime,
    timeMs: explicitTime ? Math.max(0, Math.round(Number(options.timeMs))) : null,
    maxDimension: Math.round(clamp(finite(options.maxDimension, 1280), 320, 1920)),
    quality: clamp(finite(options.quality, 0.82), 0.5, 0.95),
    timeoutMs: Math.round(clamp(finite(options.timeoutMs, 15_000), 3_000, 60_000)),
    signal: options.signal || null,
  };
}

function safePosterTime(value, durationMs) {
  const duration = Math.max(0, Math.round(finite(durationMs, 0)));
  const lastFrame = duration > 0 ? Math.max(1, duration - 1) : 60_000;
  const firstUsefulFrame = Math.min(100, lastFrame);
  return Math.round(clamp(finite(value, 350), firstUsefulFrame, lastFrame));
}

// Explicit cover choices are respected exactly (apart from staying inside the
// video). Automatic covers include one early frame, then spread a fixed number
// of samples across the duration. This escapes long black intros without
// allowing work to grow with the length of the clip.
export function videoPosterCandidateTimes({ durationMs = 0, timeMs = null, explicitTime = false } = {}) {
  const duration = Math.max(0, Math.round(finite(durationMs, 0)));
  if (explicitTime) return [safePosterTime(timeMs, duration)];
  const candidates = duration > 0
    ? [350, duration * 0.08, duration * 0.28, duration * 0.52, duration * 0.74, duration * 0.9]
    : [350, 1_000, 2_000, 3_500];
  return [...new Set(candidates.map((candidate) => safePosterTime(candidate, duration)))]
    .sort((left, right) => left - right)
    .slice(0, MAX_AUTO_POSTER_CANDIDATES);
}

export function boundedPosterSize(width, height, maxDimension = 1280) {
  const sourceWidth = Math.max(1, Math.round(finite(width, 1)));
  const sourceHeight = Math.max(1, Math.round(finite(height, 1)));
  const bound = Math.round(clamp(finite(maxDimension, 1280), 1, 4096));
  const scale = Math.min(1, bound / Math.max(sourceWidth, sourceHeight));
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

// A tiny 32-ish pixel sample is enough to reject all-black frames without
// shipping image data or expensive computer-vision work through JavaScript.
// Detail/contrast wins over both darkness and completely blown-out frames.
export function videoPosterFrameProfile(pixels) {
  const invalid = {
    score: Number.NEGATIVE_INFINITY,
    mean: 0,
    deviation: 0,
    visibleRatio: 0,
    blownRatio: 0,
    averageChroma: 0,
    spatialVariation: 0,
    spatialRange: 0,
    paletteSize: 0,
    flat: true,
    nearBlack: true,
    blownOut: false,
  };
  if (!pixels || typeof pixels.length !== "number" || pixels.length < 4) return invalid;
  const count = Math.floor(pixels.length / 4);
  if (!count) return invalid;
  let sum = 0;
  let sumSquares = 0;
  let dark = 0;
  let blown = 0;
  let chroma = 0;
  let redSum = 0;
  let redSquares = 0;
  let greenSum = 0;
  let greenSquares = 0;
  let blueSum = 0;
  let blueSquares = 0;
  let redMin = 255;
  let redMax = 0;
  let greenMin = 255;
  let greenMax = 0;
  let blueMin = 255;
  let blueMax = 0;
  const palette = new Set();
  for (let index = 0; index < count * 4; index += 4) {
    const red = Number(pixels[index]) || 0;
    const green = Number(pixels[index + 1]) || 0;
    const blue = Number(pixels[index + 2]) || 0;
    const luma = red * 0.2126 + green * 0.7152 + blue * 0.0722;
    sum += luma;
    sumSquares += luma * luma;
    if (luma < 18) dark += 1;
    if (luma > 242) blown += 1;
    chroma += Math.max(red, green, blue) - Math.min(red, green, blue);
    redSum += red;
    redSquares += red * red;
    greenSum += green;
    greenSquares += green * green;
    blueSum += blue;
    blueSquares += blue * blue;
    redMin = Math.min(redMin, red);
    redMax = Math.max(redMax, red);
    greenMin = Math.min(greenMin, green);
    greenMax = Math.max(greenMax, green);
    blueMin = Math.min(blueMin, blue);
    blueMax = Math.max(blueMax, blue);
    // Four-value bins ignore harmless single-codec-step jitter while still
    // distinguishing silhouettes, stage lights, and differently lit regions.
    if (palette.size < 64) palette.add(`${red >> 2}:${green >> 2}:${blue >> 2}`);
  }
  const mean = sum / count;
  const deviation = Math.sqrt(Math.max(0, (sumSquares / count) - (mean * mean)));
  const visibleRatio = 1 - (dark / count);
  const blownRatio = blown / count;
  const averageChroma = chroma / count;
  const channelDeviation = (sum, squares) => Math.sqrt(Math.max(0, (squares / count) - ((sum / count) ** 2)));
  const spatialVariation = Math.max(
    channelDeviation(redSum, redSquares),
    channelDeviation(greenSum, greenSquares),
    channelDeviation(blueSum, blueSquares),
  );
  const spatialRange = Math.max(redMax - redMin, greenMax - greenMin, blueMax - blueMin);
  const paletteSize = palette.size;
  // Chroma measures saturation inside each pixel, not detail between pixels.
  // A solid red/blue field is still a blank frame even with very high chroma.
  // Likewise, low-amplitude codec/block noise across an otherwise blank intro
  // is not composition: require both meaningful deviation and channel range.
  const lowAmplitudeNoise = spatialVariation <= 8 && spatialRange <= 20
    && (averageChroma < 8 || paletteSize < 4);
  const twoToneNoise = paletteSize < 4 && spatialRange <= 32;
  const flat = spatialVariation < 5 || spatialRange < 12 || lowAmplitudeNoise || twoToneNoise;
  const nearBlack = visibleRatio < 0.02 && averageChroma < 6;
  const blownOut = blownRatio >= 0.75;
  const blackPenalty = mean < 12 && averageChroma < 4 ? 80 : 0;
  // Flat black/grey/white frames otherwise receive credit merely for having
  // pixels. Require at least a little contrast or colour before accepting one.
  const score = flat ? Number.NEGATIVE_INFINITY : (visibleRatio * 120)
    + (Math.min(80, deviation) * 1.2)
    + (Math.min(24, averageChroma) * 5)
    - (blownRatio * 160)
    - blackPenalty;
  return {
    score, mean, deviation, visibleRatio, blownRatio, averageChroma,
    spatialVariation, spatialRange, paletteSize, flat, nearBlack, blownOut,
  };
}

export function videoPosterFrameScore(pixels) {
  return videoPosterFrameProfile(pixels).score;
}

export function videoPosterFrameIsUsable(profile) {
  return !!profile
    && Number.isFinite(Number(profile.score))
    && !profile.flat
    && !profile.nearBlack
    && !profile.blownOut;
}

export function videoPosterFrameIsStrong(profile) {
  return videoPosterFrameIsUsable(profile)
    && Number(profile.score) >= STRONG_AUTO_POSTER_FRAME_SCORE
    // Early exit needs materially more confidence than eventual fallback.
    // A subtle usable low-light frame remains eligible, but remote sampling
    // continues in case a later frame exposes the actual stage composition.
    && Number(profile.paletteSize) >= 4
    && (Number(profile.spatialVariation) >= 10 || Number(profile.spatialRange) >= 24);
}

export function videoPosterFileName(asset = {}) {
  const supplied = String(asset.fileName || "pit-video").split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  const stem = supplied.replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9._ -]+/gi, " ").trim() || "pit-video";
  return `${stem.slice(0, 150)}-pit-poster.jpg`;
}
