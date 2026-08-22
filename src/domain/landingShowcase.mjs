const COMPATIBLE_IMAGE_PATH = /\.(?:jpe?g|png|webp)$/i;

function safeHttpsImage(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password && COMPATIBLE_IMAGE_PATH.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function safeStockImage(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 2000) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:"
      && url.hostname === "images.unsplash.com"
      && !url.username
      && !url.password
      && /^\/photo-[A-Za-z0-9_-]+$/.test(url.pathname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

export const isLandingCompatibleImage = (value) => !!safeHttpsImage(value);
export const hasLandingCompatibleImage = (value) => Array.isArray(value) && value.some(isLandingCompatibleImage);

function safeText(value, max) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}

export function normalizeLandingCommunityMedia(value, max = 7) {
  const limit = Math.max(0, Math.min(12, Math.trunc(Number(max) || 0)));
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(value) ? value : []) {
    const uri = safeHttpsImage(item?.uri);
    const id = safeText(item?.id, 180);
    if (!uri || !id || seen.has(uri)) continue;
    seen.add(uri);
    out.push({
      id: `community:${id}`,
      uri,
      credit: safeText(item?.credit, 120) || "Shared by the PIT community",
      artist: safeText(item?.artist, 120) || null,
      venue: safeText(item?.venue, 160) || null,
      source: "community",
    });
    if (out.length >= limit) break;
  }
  return out;
}

function stockSlides(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).flatMap((item, index) => {
    // Stock photos use Unsplash's extensionless `photo-*` CDN paths. Keep that
    // narrowly trusted exception out of community validation, which continues
    // to require an explicit browser-compatible file suffix.
    const uri = safeStockImage(item?.uri);
    if (!uri || seen.has(uri)) return [];
    seen.add(uri);
    return [{
      id: `stock:${safeText(item?.id, 80) || index}`,
      uri,
      credit: safeText(item?.credit, 120) || "PIT",
      source: "stock",
    }];
  });
}

// Slot zero always stays bundled stock: first paint never waits for the API or
// swaps an already-visible full-screen frame. Community frames occupy the next
// fixed slots, each carrying a deterministic stock replacement for load errors.
export function buildLandingSlideDeck(community, fallback, total = 8) {
  const stock = stockSlides(fallback);
  if (!stock.length) return [];
  const size = Math.max(1, Math.min(12, Math.trunc(Number(total) || 8)));
  const publicMedia = normalizeLandingCommunityMedia(community, Math.max(0, size - 1));
  const deck = [{ ...stock[0], fallback: stock[1 % stock.length] }];
  for (const item of publicMedia) {
    const slot = deck.length;
    deck.push({ ...item, fallback: stock[slot % stock.length] });
  }
  while (deck.length < size) {
    const slot = deck.length;
    const item = stock[slot % stock.length];
    deck.push({ ...item, fallback: stock[(slot + 1) % stock.length] });
  }
  return deck;
}

export function landingSlideFrame(slide, failedCommunityIds) {
  if (!slide) return null;
  const failed = failedCommunityIds instanceof Set
    ? failedCommunityIds.has(slide.id)
    : Array.isArray(failedCommunityIds) && failedCommunityIds.includes(slide.id);
  return failed && slide.source === "community" && slide.fallback ? slide.fallback : slide;
}

export function landingStockStartIndex({ at = Date.now(), sessionSeed = "", total = 0 } = {}) {
  const size = Math.max(0, Math.trunc(Number(total) || 0));
  if (!size) return 0;
  const timestamp = Number.isFinite(Number(at)) ? Number(at) : 0;
  const day = new Date(timestamp).toISOString().slice(0, 10);
  const input = `${day}:${String(sessionSeed)}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % size;
}

export function rotateLandingFallbacks(value, startIndex = 0) {
  const source = Array.isArray(value) ? value : [];
  if (!source.length) return [];
  const start = ((Math.trunc(Number(startIndex) || 0) % source.length) + source.length) % source.length;
  return [...source.slice(start), ...source.slice(0, start)];
}

export function landingCommunityAdvanceDelay({ mountedAt, now = Date.now(), minimumMs = 1400, hasAdvanced = false, hasCommunity = false } = {}) {
  if (hasAdvanced || !hasCommunity) return null;
  const elapsed = Math.max(0, Number(now) - Number(mountedAt));
  return Math.max(0, Math.trunc(Number(minimumMs) || 0) - elapsed);
}

export function landingCommunityFrameReady({ frame, prefetchSucceeded = false, aborted = false, hasAdvanced = false, reduceMotion = false } = {}) {
  return frame?.source === "community"
    && prefetchSucceeded === true
    && !aborted
    && !hasAdvanced
    && !reduceMotion;
}
