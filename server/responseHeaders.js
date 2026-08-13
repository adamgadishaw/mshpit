// API handlers normally return data only. A very small response-header bridge
// lets public, immutable-ish reads opt into bounded HTTP caching without giving
// route code access to security headers, cookies, or arbitrary response state.
const ALLOWED_API_RESPONSE_HEADERS = new Map([
  ["cache-control", "Cache-Control"],
]);

export function createApiResponseHeaderSetter(target) {
  return (name, value) => {
    const canonical = ALLOWED_API_RESPONSE_HEADERS.get(String(name || "").trim().toLowerCase());
    const text = String(value ?? "").trim();
    if (!canonical || !text || text.length > 512 || /[\r\n]/.test(text)) return false;
    target[canonical] = text;
    return true;
  };
}
