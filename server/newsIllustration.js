import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

const ASSET = new URL("../public/images/news/live-music-context.jpg", import.meta.url);
const ASSET_BYTES = 123830;
const ASSET_SHA256 = "e0788b4b2b524ce23d08bf6879f47273e46a554788868e9784b8b4a7249d8244";

export const NEWS_ILLUSTRATION_ARTWORK = Object.freeze({
  source: "bundled-news",
  url: "https://www.mshpit.com/images/news/live-music-context.jpg",
});
export const NEWS_ILLUSTRATION_CONTEXT = "Illustrative live-music photo · Melissa Askew / CC0";

export function isNewsIllustrationArtwork(candidate) {
  return !!candidate && typeof candidate === "object" && !Array.isArray(candidate)
    && candidate.source === NEWS_ILLUSTRATION_ARTWORK.source
    && candidate.url === NEWS_ILLUSTRATION_ARTWORK.url;
}

function assertActive(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("Aborted", "AbortError");
}

// This is a fixed reviewed build asset, never a user-selected path or URL.
// Read at most the pinned size, even if a file changes after stat. No cache
// retains another copy; the renderer already owns bounded output caching.
export async function loadNewsIllustration({ signal = null, openFile = open } = {}) {
  assertActive(signal);
  let file = null;
  try {
    file = await openFile(ASSET, "r");
    assertActive(signal);
    const stat = await file.stat();
    assertActive(signal);
    if (!stat.isFile() || stat.size !== ASSET_BYTES) return null;
    const bytes = Buffer.alloc(ASSET_BYTES);
    let offset = 0;
    while (offset < ASSET_BYTES) {
      assertActive(signal);
      const { bytesRead } = await file.read(bytes, offset, ASSET_BYTES - offset, offset);
      assertActive(signal);
      if (!Number.isSafeInteger(bytesRead) || bytesRead <= 0 || bytesRead > ASSET_BYTES - offset) return null;
      offset += bytesRead;
    }
    return createHash("sha256").update(bytes).digest("hex") === ASSET_SHA256 ? bytes : null;
  } catch {
    assertActive(signal);
    // architecture: allow-ambiguous-result -- missing, unreadable or changed optional illustration falls back to the complete text card, never unchecked bytes.
    return null;
  } finally {
    // architecture: allow-empty-catch -- best-effort descriptor cleanup must not turn a missing optional illustration into a server error.
    try { await file?.close(); } catch { /* optional asset cleanup */ }
  }
}
