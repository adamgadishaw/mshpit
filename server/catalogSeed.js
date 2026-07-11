// Catalog seeder — grow the DB artist roster toward ~10k across all genres,
// keyless. Shared by the CLI (scripts/seed-db-artists.mjs) and the admin console
// (POST /api/admin/catalog/seed, which runs it in-process as a background job).
//
// Roster-only by design: MusicBrainz tag crawl fills name/genre/mbid/country;
// Deezer fills fan-count popularity + photo + the rank_score that orders search.
// Songs/albums stay on-demand (the artist page pulls its Deezer discography with
// previews when opened), so every seeded artist is playable without a song scrape.
import { artistStmts, artistRow, normName, db } from "./db.js";

const PAGE = 100; // MusicBrainz hard max per request
const UA = "PitConcertApp/1.0 (https://mshpit.com)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const popFromFans = (n) => Math.max(1, Math.min(100, Math.round(Math.log10((n || 0) + 1) * 12.5)));

// Broad genre coverage: each tag pulls real artists from MusicBrainz (keyless).
export const GENRE_TAGS = [
  ["punk", "Punk"], ["pop punk", "Pop Punk"], ["hardcore", "Hardcore"], ["hardcore punk", "Hardcore"],
  ["metalcore", "Metalcore"], ["indie rock", "Indie"], ["indie pop", "Indie"], ["shoegaze", "Shoegaze"],
  ["dream pop", "Dream Pop"], ["metal", "Metal"], ["death metal", "Metal"], ["black metal", "Metal"],
  ["doom metal", "Metal"], ["thrash metal", "Metal"], ["nu metal", "Metal"], ["alternative metal", "Metal"],
  ["progressive metal", "Metal"], ["electronic", "Electronic"], ["techno", "Techno"], ["house", "House"],
  ["deep house", "House"], ["drum and bass", "DnB"], ["dubstep", "Dubstep"], ["trance", "Trance"],
  ["edm", "EDM"], ["ambient", "Ambient"], ["idm", "Electronic"], ["hip hop", "Hip-Hop"], ["rap", "Hip-Hop"],
  ["trap", "Trap"], ["grime", "Grime"], ["r&b", "R&B"], ["contemporary r&b", "R&B"], ["soul", "Soul"],
  ["funk", "Funk"], ["disco", "Disco"], ["jazz", "Jazz"], ["bossa nova", "Jazz"], ["blues", "Blues"],
  ["pop", "Pop"], ["synthpop", "Synthpop"], ["new wave", "New Wave"], ["k-pop", "K-Pop"], ["j-pop", "J-Pop"],
  ["rock", "Rock"], ["classic rock", "Rock"], ["hard rock", "Rock"], ["garage rock", "Garage Rock"],
  ["grunge", "Grunge"], ["progressive rock", "Prog Rock"], ["psychedelic rock", "Psych Rock"],
  ["post-rock", "Post-Rock"], ["math rock", "Math Rock"], ["noise rock", "Noise Rock"], ["emo", "Emo"],
  ["post-punk", "Post-Punk"], ["dance-punk", "Dance-Punk"], ["alternative rock", "Alt Rock"],
  ["experimental", "Experimental"], ["folk", "Folk"], ["indie folk", "Folk"], ["americana", "Americana"],
  ["country", "Country"], ["bluegrass", "Bluegrass"], ["singer-songwriter", "Singer-Songwriter"],
  ["reggae", "Reggae"], ["dancehall", "Dancehall"], ["ska", "Ska"], ["afrobeat", "Afrobeat"],
  ["afrobeats", "Afrobeats"], ["latin", "Latin"], ["reggaeton", "Reggaeton"], ["salsa", "Latin"],
  ["classical", "Classical"], ["gospel", "Gospel"], ["world", "World"],
];

async function mbTag(tag, offset) {
  const url = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`tag:"${tag}"`)}&fmt=json&limit=${PAGE}&offset=${offset}`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.artists || [])
      .filter((x) => x.name && (x.type === "Group" || x.type === "Person"))
      .map((x) => ({ name: x.name, mbid: x.id, beginYear: x["life-span"]?.begin?.slice(0, 4) || null, country: x.area?.name || null }));
  } catch { return []; }
}

async function deezerArtist(name) {
  try {
    const r = await fetch(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=5`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const items = (await r.json())?.data || [];
    const lower = name.toLowerCase();
    return items.find((x) => (x.name || "").toLowerCase() === lower) || items[0] || null;
  } catch { return null; }
}

// Per-tag crawl cursor so re-runs never re-fetch a page they already finished.
const cursorGet = db.prepare("SELECT next_off, exhausted FROM seed_cursor WHERE tag = ?");
const cursorSet = db.prepare(`INSERT INTO seed_cursor (tag, next_off, exhausted, updated_at) VALUES (?,?,?,?)
  ON CONFLICT(tag) DO UPDATE SET next_off = excluded.next_off, exhausted = excluded.exhausted, updated_at = excluded.updated_at`);

// Phase 1: crawl MusicBrainz tags → upsert bare rows. Additive (never clobbers an
// existing artist) AND resumable (skips exhausted tags, resumes each at its saved
// offset), so nothing is fetched or inserted twice across runs.
export async function crawlArtists({ target = 10000, perTag = 600, shouldStop = () => false, tick = () => {} } = {}) {
  let added = 0;
  outer: for (const [tag, genre] of GENRE_TAGS) {
    const cur = cursorGet.get(tag);
    if (cur?.exhausted) continue; // whole tag already crawled — skip the network entirely
    for (let offset = cur?.next_off || 0; offset < perTag; offset += PAGE) {
      if (shouldStop() || artistStmts.count.get().c >= target) break outer;
      const list = await mbTag(tag, offset);
      await sleep(1100); // MusicBrainz ~1 req/s
      for (const x of list) {
        const norm = normName(x.name);
        if (artistStmts.byNorm.get(norm)) continue; // additive: never re-add
        artistStmts.upsert.run(artistRow(norm, { name: x.name, genre, mbid: x.mbid, country: x.country, beginYear: x.beginYear }, "musicbrainz"));
        added++;
      }
      const done = list.length < PAGE; // exhausted this tag's results
      cursorSet.run(tag, offset + PAGE, done ? 1 : 0, Date.now());
      tick({ phase: "crawl", added, total: artistStmts.count.get().c, note: tag });
      if (done) break;
    }
  }
  return added;
}

// Phase 2: rank the artists still missing popularity via Deezer. Resumable.
export async function enrichThin({ shouldStop = () => false, tick = () => {} } = {}) {
  const rows = db.prepare("SELECT norm,name,genre,mbid,country,formed,data FROM artists WHERE popularity IS NULL").all();
  let ranked = 0, done = 0;
  for (const row of rows) {
    if (shouldStop()) break;
    const dz = await deezerArtist(row.name);
    await sleep(80); // gentle on the keyless API
    if (dz && typeof dz.nb_fan === "number") {
      let data = {}; try { data = JSON.parse(row.data || "{}"); } catch {}
      const photo = dz.picture_xl || dz.picture_big || null;
      const merged = {
        ...data, name: row.name, genre: row.genre, mbid: row.mbid, country: row.country, beginYear: row.formed,
        popularity: popFromFans(dz.nb_fan), followers: dz.nb_fan,
        photo: data.photo || photo, photoCredit: data.photo ? data.photoCredit : (photo ? "Deezer" : null),
      };
      artistStmts.upsert.run(artistRow(row.norm, merged, "deezer"));
      ranked++;
    }
    if (++done % 25 === 0) tick({ phase: "enrich", ranked, done, of: rows.length });
  }
  tick({ phase: "enrich", ranked, done, of: rows.length });
  return ranked;
}

// ---- In-process background job (admin console) ----
let state = { running: false, stopRequested: false, phase: "idle", target: 0, added: 0, ranked: 0, total: 0, startedAt: 0, finishedAt: 0, error: null, note: "" };

export function catalogSeedStatus() {
  return { ...state, total: artistStmts.count.get().c };
}

// Ask a running job to stop at the next page/artist boundary (finishes cleanly,
// keeps everything already seeded; the cursor means a later run resumes here).
export function stopCatalogSeed() {
  if (state.running) { state.stopRequested = true; state.note = "stopping"; }
  return catalogSeedStatus();
}

export function startCatalogSeed({ target = 10000, perTag = 600, enrich = true } = {}) {
  if (state.running) return { started: false, reason: "already-running", status: catalogSeedStatus() };
  state = { running: true, stopRequested: false, phase: "crawl", target, added: 0, ranked: 0, total: artistStmts.count.get().c, startedAt: Date.now(), finishedAt: 0, error: null, note: "" };
  const shouldStop = () => state.stopRequested;
  (async () => {
    try {
      await crawlArtists({ target, perTag, shouldStop, tick: ({ added, total, note }) => { state.added = added; state.total = total; if (note) state.note = note; } });
      if (enrich && !state.stopRequested) { state.phase = "enrich"; await enrichThin({ shouldStop, tick: ({ ranked }) => { state.ranked = ranked; } }); }
      state.phase = state.stopRequested ? "stopped" : "done"; state.finishedAt = Date.now();
    } catch (e) {
      state.error = String(e?.message || e); state.phase = "error"; state.finishedAt = Date.now();
    } finally {
      state.running = false; state.stopRequested = false;
    }
  })();
  return { started: true, status: catalogSeedStatus() };
}
