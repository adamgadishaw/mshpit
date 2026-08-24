import { api } from "./api";

export function loadSelectedArtistDiscography(name, deezerId, { signal } = {}) {
  return api("/api/artists/discography/selection", {
    method: "POST",
    body: { name, deezerId },
    context: "Switching artist catalog",
    silent: true,
    signal,
  });
}
