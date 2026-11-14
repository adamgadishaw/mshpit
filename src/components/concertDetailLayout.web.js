// The native typography adapter is not needed by the browser's base layout.
export const concertDetailStyles = base => base;
export const concertDetailWide = (width, _fontScale, _platform, threshold) => width >= threshold;
