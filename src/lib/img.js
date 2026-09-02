// Image delivery helpers. Scraped photo URLs come from hundreds of random hosts;
// a few block browser loads (hotlink protection / CORS / UA checks) even though
// they answer server-side checks. When a direct load fails, we retry ONCE through
// wsrv.nl (a free, heavily-used open image proxy/CDN): it fetches the origin
// server-side, caches at the edge, and serves reliably. Only images that fail
// both ways are dropped by the components' onError fallbacks.
export const proxied = (uri, w = 1200) => {
  // Several artist/discovery projections already return a bounded wsrv URL.
  // Wrapping that URL again adds another request and another transform without
  // improving the image, so treat the existing derivative as final.
  if (typeof uri === "string" && /^https:\/\/wsrv\.nl\//i.test(uri)) return uri;
  return `https://wsrv.nl/?url=${encodeURIComponent(uri)}&w=${w}&fit=cover&q=80${isHeic(uri) ? "&output=jpg" : ""}`;
};

export const isHttp = (uri) => typeof uri === "string" && /^https?:\/\//i.test(uri);

// Post media arrays mix photos and clips; type is carried by the object key's
// extension (stable, server-assigned at presign time).
export const isVideoUrl = (uri) => /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(String(uri || ""));

// iPhone photos upload as HEIC, which every browser except Safari refuses to
// decode - the file stores and serves fine (200, image/heic) but renders as
// nothing. This was "images not loading on the platform."
export const isHeic = (uri) => typeof uri === "string" && /\.hei[cf](\?|#|$)/i.test(uri);

// The src every component should actually render: known-undecodable formats go
// straight through the wsrv.nl transcode (HEIC -> JPEG, verified against a real
// production photo) instead of waiting for a 1MB download to fail first.
// Everything else renders direct and keeps the existing proxy-on-error ladder.
export const displaySrc = (uri, w = 1600) =>
  isHeic(uri) && isHttp(uri)
    ? `https://wsrv.nl/?url=${encodeURIComponent(uri)}&w=${w}&q=82&output=jpg`
    : uri;

const isPublicHttpsImage = (value) => {
  if (!isHttp(value)) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0"
      || host === "::1" || host === "[::1]" || host.startsWith("127.")
      || host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) return false;
    const private172 = /^172\.(\d{1,2})\./.exec(host);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) return false;
    return !/^\[?(?:fc|fd|fe[89ab])[0-9a-f:]/i.test(host);
  } catch {
    return false;
  }
};

// Public feed, landing, and profile pictures need only the pixels their tile
// can display. Reuse the bounded image CDN already used by post previews; local
// development and non-public URLs stay direct. That keeps a 36px avatar or
// phone hero from downloading a full profile rendition/camera original.
export const previewSrc = (uri, width = 1200) => {
  const requestedWidth = Math.max(64, Math.min(2400, Math.round(Number(width) || 1200)));
  return isPublicHttpsImage(uri) ? proxied(uri, requestedWidth) : displaySrc(uri, requestedWidth);
};
