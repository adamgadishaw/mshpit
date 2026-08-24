const DESKTOP_MEDIA_BREAKPOINT = 768;
const DESKTOP_MEDIA_MAX_WIDTH = 760;
const DESKTOP_PORTRAIT_MAX_WIDTH = 500;
const DESKTOP_MEDIA_MAX_HEIGHT = 520;
const DESKTOP_MEDIA_MIN_HEIGHT = 240;
const DESKTOP_MEDIA_VIEWPORT_FRACTION = 0.58;
const MIN_SINGLE_MEDIA_RATIO = 4 / 5;
const MAX_SINGLE_MEDIA_RATIO = 16 / 9;

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
