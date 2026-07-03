// Image delivery helpers. Scraped photo URLs come from hundreds of random hosts;
// a few block browser loads (hotlink protection / CORS / UA checks) even though
// they answer server-side checks. When a direct load fails, we retry ONCE through
// wsrv.nl (a free, heavily-used open image proxy/CDN): it fetches the origin
// server-side, caches at the edge, and serves reliably. Only images that fail
// both ways are dropped by the components' onError fallbacks.
export const proxied = (uri, w = 1200) =>
  `https://wsrv.nl/?url=${encodeURIComponent(uri)}&w=${w}&fit=cover&q=80`;

export const isHttp = (uri) => typeof uri === "string" && /^https?:\/\//i.test(uri);
