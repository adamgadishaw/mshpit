// Autoplay candidate selection.
//
// Extracted from src/store.js so the thing the owner actually complained about
// (autoplay repeating itself) can be tested. The store still gathers the data,
// merging the bundled catalogue with whatever the server has hydrated; this
// module decides what to play and in what order, and nothing here touches React.
//
// Three rules keep a queue from feeling like a loop:
//   - anything heard recently is deferred, by provider id AND by artist+title,
//     because the same recording arrives under different ids from different
//     providers and matching on one alone lets duplicates through;
//   - artists are interleaved and capped, so one prolific back catalogue cannot
//     swallow the queue;
//   - the starting offset rotates per session, so two sessions from the same
//     account do not open with the same run of songs.

const norm = (s) => String(s || "").trim().toLowerCase();

// A track's identities. `trackKey` is the provider-neutral id the player uses;
// the metadata key catches the same recording arriving from another provider.
export const trackIdentities = (track, trackKey) => [
  trackKey ? trackKey(track) : null,
  `meta:${norm(track?.artist)}|${norm(track?.title)}`,
].filter(Boolean);

// How many of the most recent plays are held back, and how many artists are
// pushed down the ordering for having just been heard.
export const RECENT_TRACK_MEMORY = 25;
export const RECENT_ARTIST_MEMORY = 10;

const rotate = (list, offset) => {
  if (!list.length) return [];
  const at = ((offset % list.length) + list.length) % list.length;
  return [...list.slice(at), ...list.slice(0, at)];
};

// Interleave the seed's genre with everything else so a queue stays on-taste
// without becoming one narrow rut: three from the genre, then one from outside.
function interleave(inGenre, rest) {
  const artists = [];
  let g = 0;
  let r = 0;
  while (g < inGenre.length || r < rest.length) {
    for (let i = 0; i < 3 && g < inGenre.length; i++) artists.push(inGenre[g++]);
    if (r < rest.length) artists.push(rest[r++]);
    // With no genre match at all, this is the only thing advancing `rest`.
    if (!inGenre.length && r < rest.length) artists.push(rest[r++]);
  }
  return artists;
}

/**
 * @param candidates [{ name, genre, popularity, art, tracks: [{ title, ... }] }]
 * @param history    most-recent-first list of previously played tracks
 * @param seed       the track this queue is growing from, never repeated
 * @param genre      the taste to lean into (seed's genre, or the account's)
 * @param rotation   session counter; changes where the candidate list starts
 */
export function recommendTracks({
  candidates = [],
  history = [],
  seed = null,
  genre = null,
  count = 24,
  rotation = 0,
  maxPerArtist = 2,
  trackKey = null,
} = {}) {
  const seen = new Set();
  const remember = (t) => trackIdentities(t, trackKey).forEach((key) => seen.add(key));
  const heard = (t) => trackIdentities(t, trackKey).some((key) => seen.has(key));

  if (seed) remember(seed);
  (history || []).slice(0, RECENT_TRACK_MEMORY).forEach(remember);
  const recentArtists = new Set(
    (history || []).slice(0, RECENT_ARTIST_MEMORY).map((t) => norm(t?.artist)).filter(Boolean)
  );

  const playable = (candidates || []).filter((c) => c?.name && (c.tracks || []).length);
  const wanted = genre ? norm(genre) : null;
  const score = (c) => Number(c.popularity) || 0;
  // Just-heard artists sink; then popularity; then name, so ordering is stable
  // and a test can reason about it.
  const ordered = (list) => [...list].sort((p, q) =>
    Number(recentArtists.has(norm(p.name))) - Number(recentArtists.has(norm(q.name)))
    || score(q) - score(p)
    || String(p.name).localeCompare(String(q.name))
  );

  const matches = (c) => !!wanted && norm(c.genre) === wanted;
  // The two offsets are coprime-ish so the genre and discovery lists do not
  // advance in lockstep and repeat the same pairing every session.
  const inGenre = rotate(ordered(playable.filter(matches)), rotation * 7);
  const rest = rotate(ordered(playable.filter((c) => !matches(c))), rotation * 11);
  const artists = interleave(inGenre, rest);

  const out = [];
  for (let pass = 0; pass < maxPerArtist && out.length < count; pass++) {
    for (const candidate of artists) {
      const available = candidate.tracks || [];
      for (let index = pass; index < available.length; index++) {
        const t = available[index];
        // Artist + title is a complete track reference. Provider URLs are
        // optional enrichments the player resolves when the track becomes
        // current, so a track without one is still perfectly playable.
        if (!t?.title) continue;
        const track = {
          kind: "track",
          title: t.title,
          artist: candidate.name,
          id: t.id || null,
          sourceId: t.sourceId || t.id || null,
          provider: t.provider || null,
          url: t.url || null,
          videoId: t.videoId || null,
          duration: t.duration || null,
          preview: t.preview || null,
          art: candidate.art || null,
        };
        if (heard(track)) continue;
        remember(track);
        out.push(track);
        break;
      }
      if (out.length >= count) break;
    }
  }
  return out;
}

// Collapse repeats for display. Play history deliberately records every play,
// because the You screen counts them to build "your sound", so the duplication
// belongs in the data and must not be removed there. What it must not do is
// render "Animals, Animals, Burn It to the Ground, Burn It to the Ground" back
// at someone as their recent listening. History arrives most-recent-first, so
// keeping the first occurrence keeps the latest play of each track.
export function uniqueTracks(list, trackKey = null) {
  const seen = new Set();
  const out = [];
  for (const track of list || []) {
    if (!track) continue;
    const ids = trackIdentities(track, trackKey);
    if (ids.some((id) => seen.has(id))) continue;
    ids.forEach((id) => seen.add(id));
    out.push(track);
  }
  return out;
}
