// API handlers normally return data only. A very small response-header bridge
// lets public, immutable-ish reads opt into bounded HTTP caching without giving
// route code access to security headers, cookies, or arbitrary response state.
const ALLOWED_API_RESPONSE_HEADERS = new Map([
  ["cache-control", "Cache-Control"],
  ["link", "Link"],
  ["x-pit-results-truncated", "X-Pit-Results-Truncated"],
]);

export function createApiResponseHeaders(initial = {}) {
  // Private is the safe API default. A deliberately public handler must opt in
  // through the bounded setter below; a newly added account route cannot forget
  // this header and leak through a browser/proxy cache.
  return { "Cache-Control": "no-store", ...initial };
}

export function createApiResponseHeaderSetter(target) {
  return (name, value) => {
    const canonical = ALLOWED_API_RESPONSE_HEADERS.get(String(name || "").trim().toLowerCase());
    const text = String(value ?? "").trim();
    if (!canonical || !text || text.length > 512 || /[\r\n]/.test(text)) return false;
    if (canonical === "X-Pit-Results-Truncated" && !/^(?:true|false)$/.test(text)) return false;
    if (canonical === "Link" && !/^<\/api\/[A-Za-z0-9_/?=&.%+-]+>; rel="next"$/.test(text)) return false;
    target[canonical] = text;
    return true;
  };
}
