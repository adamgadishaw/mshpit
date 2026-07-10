/**
 * Spotify Web API client (Client Credentials flow) — the way real music apps get
 * official artist images + metadata. Images are Spotify-CDN-hosted (label/artist
 * provided), so they always load: no dead/hotlink-protected URLs.
 *
 * Needs a free app at https://developer.spotify.com/dashboard, then set:
 *   SPOTIFY_CLIENT_ID=...   SPOTIFY_CLIENT_SECRET=...
 *
 * Public catalog data only (no user login needed) — search, artist, top tracks.
 */
const ID = process.env.SPOTIFY_CLIENT_ID;
const SECRET = process.env.SPOTIFY_CLIENT_SECRET;

export const spotifyConfigured = () => Boolean(ID && SECRET);

let token = null;
let tokenExp = 0;

async function getToken() {
  if (token && Date.now() < tokenExp - 30000) return token;
  const basic = Buffer.from(`${ID}:${SECRET}`).toString("base64");
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15000), // never hang the whole pipeline on one call
  });
  if (!r.ok) throw new Error(`Spotify auth failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  token = d.access_token;
  tokenExp = Date.now() + (d.expires_in || 3600) * 1000;
  return token;
}

// A single stalled request must never freeze the run: 15s hard timeout, at most
// a few 429 retries (bounded), and any network error resolves to null so the
// caller skips this artist and moves on instead of blocking forever.
async function api(path, tries = 0) {
  const t = await getToken();
  let r;
  try {
    r = await fetch(`https://api.spotify.com/v1${path}`, { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(15000) });
  } catch {
    return null;
  }
  if (r.status === 429 && tries < 5) {
    const wait = Math.min((Number(r.headers.get("retry-after")) || 2) * 1000, 30000);
    await new Promise((res) => setTimeout(res, wait));
    return api(path, tries + 1);
  }
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// Best-match artist for a name. Returns normalized fields the catalog wants.
export async function findArtist(name) {
  const d = await api(`/search?type=artist&limit=5&q=${encodeURIComponent(name)}`);
  const items = d?.artists?.items || [];
  if (!items.length) return null;
  // prefer an exact (case-insensitive) name match, else the most popular result.
  const exact = items.find((a) => a.name.toLowerCase() === name.toLowerCase());
  const a = exact || items.sort((x, y) => (y.popularity || 0) - (x.popularity || 0))[0];
  // NOTE: restricted (post-2024 dev-mode) apps get search results WITHOUT
  // popularity/followers, so those come back null here. `enrich-popularity.mjs`
  // backfills them in bulk via the batch /artists endpoint (far fewer calls).
  return {
    id: a.id,
    name: a.name,
    genres: a.genres || [],
    popularity: a.popularity ?? null,
    followers: a.followers?.total ?? null,
    // Spotify's images array is the SAME picture at 3 sizes — keep only the
    // largest or the gallery fills with triplicates.
    images: (a.images || []).map((im) => im.url).filter(Boolean).slice(0, 1),
  };
}

// Batch-fetch full artist objects (popularity, followers, genres) by id — up to
// 50 per call via /artists?ids=. This is how we get popularity/followers, which
// the /search endpoint omits for restricted apps. Returns { id: artistObj }.
export async function getArtistsByIds(ids) {
  const d = await api(`/artists?ids=${ids.slice(0, 50).join(",")}`);
  const out = {};
  for (const a of d?.artists || []) if (a && a.id) out[a.id] = a;
  return out;
}

// Top tracks by artist NAME via track search. (The dedicated top-tracks endpoint
// 403s for post-2024 dev-mode apps, and search caps limit at 10 — so page twice,
// keep exact-artist matches in relevance order, which tracks popularity closely.)
// preview is usually null on new apps; url (open.spotify.com) always works.
export async function topTracks(artistName) {
  const seen = new Set();
  const out = [];
  for (const offset of [0, 10]) {
    const d = await api(`/search?type=track&limit=10&offset=${offset}&q=${encodeURIComponent("artist:" + artistName)}`);
    for (const t of d?.tracks?.items || []) {
      if (!t.artists?.some((a) => a.name.toLowerCase() === artistName.toLowerCase())) continue;
      const k = t.name.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({
        title: t.name,
        album: t.album?.name || null,
        preview: t.preview_url || null,
        url: t.external_urls?.spotify || null,
      });
    }
  }
  return out;
}
