import { api } from "./api";

// Keep transport construction out of the global store. The player owns the
// lifecycle signal; this adapter owns the PIT route and request options.
export function requestFreshDeezerPreview(title, artist, { signal } = {}) {
  return api(
    `/api/deezer/track?title=${encodeURIComponent(title)}&artist=${encodeURIComponent(artist || "")}`,
    { signal },
  );
}
