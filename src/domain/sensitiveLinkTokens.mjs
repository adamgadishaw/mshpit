const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;

function safeParams(value) {
  try {
    return new URLSearchParams(String(value || "").replace(/^\?/, ""));
  } catch {
    return new URLSearchParams();
  }
}

function hashParams(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  // Pit's credential-bearing fragments are plain parameter lists. Do not
  // reinterpret an ordinary navigation fragment such as #section or #/route.
  if (!raw.includes("=")) return null;
  return safeParams(raw.replace(/^\?/, ""));
}

function validToken(value) {
  const token = typeof value === "string" ? value.trim() : "";
  return TOKEN_PATTERN.test(token) ? token : null;
}

// New links carry credentials in the fragment so they never reach the HTTP
// server, reverse proxy, CDN, or Referer header. Query parsing remains for old
// emails that may still be opened during their validity window.
export function readSensitiveLinkToken(locationLike, key) {
  const name = String(key || "");
  if (!name) return null;
  const fragment = hashParams(locationLike?.hash);
  return validToken(fragment?.get(name))
    || validToken(safeParams(locationLike?.search).get(name));
}

// New security boundaries have no legacy query-link population to support.
// Keeping them fragment-only means the client will not legitimize a credential
// form that already leaked into an HTTP request before the app could scrub it.
export function readSensitiveFragmentToken(locationLike, key) {
  const name = String(key || "");
  if (!name) return null;
  return validToken(hashParams(locationLike?.hash)?.get(name));
}

// Return a same-origin history target with only the consumed credential
// removed. Other query parameters and ordinary navigation fragments survive.
export function scrubSensitiveLinkToken(locationLike, key) {
  const name = String(key || "");
  const pathname = String(locationLike?.pathname || "/") || "/";
  const search = safeParams(locationLike?.search);
  if (name) search.delete(name);

  let hash = String(locationLike?.hash || "");
  const fragment = hashParams(hash);
  if (fragment && name) {
    fragment.delete(name);
    const next = fragment.toString();
    hash = next ? `#${next}` : "";
  }

  const query = search.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}
