import { artistConcertsPath, postPath } from "./urls.mjs";

const text = (value) => String(value ?? "").trim();

// Feed cards keep their canonical post URL. Artist comparisons require the
// stable public slug supplied by the server; tour names never become guessed
// crawlable URLs.
export function concertPostContext(log = {}) {
  const artist = text(log.artist);
  const artistPublicSlug = text(log.artistPublicSlug || log.artist_public_slug);
  const online = log.experienceType === "online" || log.experience_type === "online";
  return Object.freeze({
    showHref: postPath(log.id),
    artist: artist || null,
    artistKey: log.artistKey || log.artist_key || null,
    artistPublicSlug: artistPublicSlug || null,
    artistConcertsHref: !online && artist && artistPublicSlug
      ? artistConcertsPath({ name: artist, publicSlug: artistPublicSlug })
      : null,
  });
}
