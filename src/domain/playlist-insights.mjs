const clean = (value) => typeof value === "string" ? value.trim() : "";

function youtubeVideoId(value) {
  const raw = clean(value);
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, "");
    if (host === "youtu.be") {
      const candidate = url.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
    }
    if (host !== "youtube.com" && host !== "music.youtube.com" && host !== "youtube-nocookie.com") return null;
    const candidate = url.pathname === "/watch"
      ? url.searchParams.get("v") || ""
      : ["shorts", "embed", "live"].includes(url.pathname.split("/").filter(Boolean)[0])
        ? url.pathname.split("/").filter(Boolean)[1] || ""
        : "";
    return /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function playlistTrackIdentity(track) {
  if (!track || typeof track !== "object" || Array.isArray(track)) return null;
  const videoId = youtubeVideoId(track.videoId) || youtubeVideoId(track.url);
  if (videoId) return `youtube:${videoId}`;
  const sourceId = clean(String(track.sourceId ?? track.id ?? ""));
  const provider = clean(track.provider).toLowerCase() || "unknown";
  if (sourceId) return `source:${provider}:${sourceId.toLowerCase()}`;
  const url = clean(track.url);
  if (url) return `url:${url.toLowerCase()}`;
  const title = clean(track.title).toLowerCase();
  const artist = clean(track.artist).toLowerCase();
  return title ? `text:${artist}|${title}` : null;
}

function playlistTracks(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.tracks) ? value.tracks : [];
}

export function playlistHasTrack(playlist, candidate) {
  const identity = playlistTrackIdentity(candidate);
  if (!identity) return false;
  return playlistTracks(playlist).some((track) => playlistTrackIdentity(track) === identity);
}

function trackArtist(track) {
  return clean(track?.artist);
}

function trackGenres(track) {
  const values = Array.isArray(track?.genres)
    ? track.genres
    : clean(track?.genre)
      ? [track.genre]
      : [];
  const seen = new Set();
  const genres = [];
  for (const value of values) {
    const label = clean(value);
    const key = label.toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    genres.push(label);
  }
  return genres;
}

function completeMetadata(tracks, getter) {
  return tracks.length > 0 && tracks.every((track) => getter(track).length > 0);
}

export function playlistVarietySummary(playlist) {
  const tracks = playlistTracks(playlist).filter((track) => track && typeof track === "object");
  const parts = [`${tracks.length} song${tracks.length === 1 ? "" : "s"}`];
  if (completeMetadata(tracks, trackArtist)) {
    const artists = new Set(tracks.map((track) => trackArtist(track).toLocaleLowerCase()));
    parts.push(`${artists.size} artist${artists.size === 1 ? "" : "s"}`);
  }
  if (completeMetadata(tracks, trackGenres)) {
    const genres = new Set(tracks.flatMap(trackGenres).map((genre) => genre.toLocaleLowerCase()));
    parts.push(`${genres.size} genre${genres.size === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

export function playlistCandidateVarietyNote(playlist, candidate) {
  const tracks = playlistTracks(playlist).filter((track) => track && typeof track === "object");
  if (playlistHasTrack(tracks, candidate)) return "Already added";
  if (!tracks.length || !candidate || typeof candidate !== "object") return null;

  const candidateArtist = trackArtist(candidate);
  const existingArtists = completeMetadata(tracks, trackArtist)
    ? new Set(tracks.map((track) => trackArtist(track).toLocaleLowerCase()))
    : null;
  const addsArtist = !!candidateArtist && !!existingArtists && !existingArtists.has(candidateArtist.toLocaleLowerCase());

  const candidateGenres = trackGenres(candidate);
  const existingGenres = completeMetadata(tracks, trackGenres)
    ? new Set(tracks.flatMap(trackGenres).map((genre) => genre.toLocaleLowerCase()))
    : null;
  const addsGenre = candidateGenres.length > 0 && !!existingGenres
    && candidateGenres.every((genre) => !existingGenres.has(genre.toLocaleLowerCase()));

  if (addsArtist && addsGenre) return "Adds a new artist and a new genre to the mix.";
  if (addsArtist) return "Adds a new artist to the mix.";
  if (addsGenre) return "Adds a new genre to the mix.";
  return null;
}
