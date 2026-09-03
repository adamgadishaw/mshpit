const DESKTOP_MEDIA_BREAKPOINT = 768;
const DESKTOP_MEDIA_MAX_WIDTH = 760;
const DESKTOP_PORTRAIT_MAX_WIDTH = 500;
const DESKTOP_MEDIA_MAX_HEIGHT = 520;
const DESKTOP_MEDIA_MIN_HEIGHT = 240;
const DESKTOP_MEDIA_VIEWPORT_FRACTION = 0.58;
const MIN_SINGLE_MEDIA_RATIO = 4 / 5;
const MAX_SINGLE_MEDIA_RATIO = 16 / 9;
const MOBILE_MEDIA_PREVIEW_MAX_WIDTH = 768;
const DESKTOP_MEDIA_PREVIEW_MAX_WIDTH = 1200;
const MEDIA_PREVIEW_MIN_WIDTH = 320;
const MEDIA_PREVIEW_ROUNDING_STEP = 64;
const MEDIA_PREVIEW_MAX_SCALE = 2;

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function desktopHeightCap(viewportHeight) {
  const height = positiveNumber(viewportHeight);
  if (!height) return DESKTOP_MEDIA_MAX_HEIGHT;
  return Math.min(
    DESKTOP_MEDIA_MAX_HEIGHT,
    Math.max(DESKTOP_MEDIA_MIN_HEIGHT, Math.floor(height * DESKTOP_MEDIA_VIEWPORT_FRACTION)),
  );
}

function widthWithinHeight(widthCap, heightCap, aspectRatio) {
  return Math.max(1, Math.floor(Math.min(widthCap, heightCap * aspectRatio)));
}

// Feed thumbnails should match the pixels a tile can actually display. Using the
// whole viewport for every tile made a two- or four-photo phone collage download
// and decode desktop-sized images. Desktop uses the already height-bounded grid
// width, while device scale is capped so a 3x phone cannot request oversized
// derivatives that add memory pressure without a visible benefit.
export function postMediaPreviewWidth({
  viewportWidth,
  scale = 1,
  desktopMaxWidth = null,
  tileFraction = 1,
} = {}) {
  const viewport = positiveNumber(viewportWidth) || MEDIA_PREVIEW_MIN_WIDTH;
  const desktopWidth = positiveNumber(desktopMaxWidth);
  const gridWidth = desktopWidth ? Math.min(viewport, desktopWidth) : viewport;
  const deviceScale = Math.max(1, Math.min(MEDIA_PREVIEW_MAX_SCALE, positiveNumber(scale) || 1));
  const fraction = Math.max(0.1, Math.min(1, positiveNumber(tileFraction) || 1));
  const rounded = Math.ceil((gridWidth * fraction * deviceScale) / MEDIA_PREVIEW_ROUNDING_STEP)
    * MEDIA_PREVIEW_ROUNDING_STEP;
  const maximum = desktopWidth ? DESKTOP_MEDIA_PREVIEW_MAX_WIDTH : MOBILE_MEDIA_PREVIEW_MAX_WIDTH;
  return Math.max(MEDIA_PREVIEW_MIN_WIDTH, Math.min(maximum, rounded));
}

// Desktop feed columns can be much wider than a phone. Letting a single 4:5
// attachment inherit that full width makes one post taller than the browsing
// viewport and turns an unavailable image into a giant blank panel. Keep the
// mobile collage unchanged while bounding desktop decode/display geometry.
export function postMediaGridLayout({ viewportWidth, viewportHeight, count = 0, width, height } = {}) {
  const desktop = positiveNumber(viewportWidth) >= DESKTOP_MEDIA_BREAKPOINT;
  const itemCount = Math.max(0, Math.trunc(Number(count) || 0));
  if (!desktop) return { desktop: false, maxWidth: null, aspectRatio: null, containSingle: false };
  const heightCap = desktopHeightCap(viewportHeight);

  if (itemCount !== 1) {
    const collageRatio = itemCount === 2 ? 16 / 9 : 4 / 3;
    return {
      desktop: true,
      maxWidth: widthWithinHeight(DESKTOP_MEDIA_MAX_WIDTH, heightCap, collageRatio),
      aspectRatio: null,
      containSingle: false,
    };
  }

  const sourceWidth = positiveNumber(width);
  const sourceHeight = positiveNumber(height);
  const sourceRatio = sourceWidth && sourceHeight ? sourceWidth / sourceHeight : 4 / 3;
  const aspectRatio = Math.max(MIN_SINGLE_MEDIA_RATIO, Math.min(MAX_SINGLE_MEDIA_RATIO, sourceRatio));
  const widthCap = aspectRatio < 1 ? DESKTOP_PORTRAIT_MAX_WIDTH : DESKTOP_MEDIA_MAX_WIDTH;
  return {
    desktop: true,
    maxWidth: widthWithinHeight(widthCap, heightCap, aspectRatio),
    aspectRatio,
    containSingle: true,
  };
}

// A video poster is a preview of playable content, not a collage crop. Both
// players render clips with contentFit="contain" (ClipsScreen, PhotoViewer), so
// a cover-cropped poster promises a framing the player will not deliver.
//
// Phone tiles are close to square, so cover barely crops and the existing look
// is kept. Desktop tiles are much wider: covering a 9:16 clip into a 16/9 tile
// scales it to roughly 2.4x the tile height and shows only a middle sliver.
// That is the reported "extremely zoomed in on computer, perfect on mobile".
//
// `explicit` always wins so a caller that has already decided (the full-screen
// viewer, the single-attachment desktop layout) is never second-guessed.
export function videoPosterContain({ viewportWidth, explicit = null } = {}) {
  if (typeof explicit === "boolean") return explicit;
  return (positiveNumber(viewportWidth) || 0) >= DESKTOP_MEDIA_BREAKPOINT;
}
