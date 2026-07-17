// Image delivery helpers. Scraped photo URLs come from hundreds of random hosts;
// a few block browser loads (hotlink protection / CORS / UA checks) even though
// they answer server-side checks. When a direct load fails, we retry ONCE through
// wsrv.nl (a free, heavily-used open image proxy/CDN): it fetches the origin
// server-side, caches at the edge, and serves reliably. Only images that fail
// both ways are dropped by the components' onError fallbacks.
export const proxied = (uri, w = 1200) =>
  `https://wsrv.nl/?url=${encodeURIComponent(uri)}&w=${w}&fit=cover&q=80${isHeic(uri) ? "&output=jpg" : ""}`;

export const isHttp = (uri) => typeof uri === "string" && /^https?:\/\//i.test(uri);

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
