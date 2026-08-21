const DESKTOP_MEDIA_BREAKPOINT = 920;
const DESKTOP_MEDIA_MAX_WIDTH = 760;
const DESKTOP_PORTRAIT_MAX_WIDTH = 500;
const MIN_SINGLE_MEDIA_RATIO = 4 / 5;
const MAX_SINGLE_MEDIA_RATIO = 16 / 9;

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Desktop feed columns can be much wider than a phone. Letting a single 4:5
// attachment inherit that full width makes one post taller than the browsing
// viewport and turns an unavailable image into a giant blank panel. Keep the
// mobile collage unchanged while bounding desktop decode/display geometry.
export function postMediaGridLayout({ viewportWidth, count = 0, width, height } = {}) {
  const desktop = positiveNumber(viewportWidth) >= DESKTOP_MEDIA_BREAKPOINT;
  const itemCount = Math.max(0, Math.trunc(Number(count) || 0));
  if (!desktop) return { desktop: false, maxWidth: null, aspectRatio: null, containSingle: false };

  if (itemCount !== 1) {
    return { desktop: true, maxWidth: DESKTOP_MEDIA_MAX_WIDTH, aspectRatio: null, containSingle: false };
  }

  const sourceWidth = positiveNumber(width);
  const sourceHeight = positiveNumber(height);
  const sourceRatio = sourceWidth && sourceHeight ? sourceWidth / sourceHeight : 4 / 3;
  const aspectRatio = Math.max(MIN_SINGLE_MEDIA_RATIO, Math.min(MAX_SINGLE_MEDIA_RATIO, sourceRatio));
  return {
    desktop: true,
    maxWidth: aspectRatio < 1 ? DESKTOP_PORTRAIT_MAX_WIDTH : DESKTOP_MEDIA_MAX_WIDTH,
    aspectRatio,
    containSingle: true,
  };
}
