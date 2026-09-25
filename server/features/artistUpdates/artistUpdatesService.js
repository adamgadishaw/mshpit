import { releaseHeadline, showsHeadline } from "../../../src/domain/artistNews.mjs";
import { activeAccountSql } from "../../accountVisibility.js";
import { artistAuthoredTourDateVisibleSql } from "../../artistAuthoredTourDateVisibility.js";
import { tourDateHasNoPublishedMemorialSql } from "../../artistMemorialTourDateVisibility.js";
import { isIndexableMusicEventRecord } from "../seo/publicEntityPolicy.js";

// Artist news, from sources we can stand behind:
//   - new releases: an artist's own Deezer album list, only for artists whose
//     Deezer identity is already stored and whose name matches exactly;
//   - new tour dates: public tour dates Mshpit sees for the first time.
// The first look at an artist or at the catalogue is a quiet baseline, so a
// back catalogue never floods the news as if it were new.

const DAY = 86_400_000;
const RELEASE_TYPES = new Set(["album", "ep", "single"]);
const MAX_SHOW_DATES = 60;
// A catalogue expansion can add a whole existing tour at once for an artist
// Mshpit had never seen. That is not news, so a first sighting larger than
// this is recorded quietly.
const NEW_ARTIST_QUIET_BATCH = 10;

export function ensureArtistUpdatesSchema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS artist_updates (
    id TEXT PRIMARY KEY,
    artist_key TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('release','shows')),
    dedupe_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}' CHECK(length(payload) <= 20000),
    source TEXT NOT NULL,
    source_url TEXT,
    occurred_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    notified_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_artist_updates_recent ON artist_updates(created_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_artist_updates_artist ON artist_updates(artist_key, created_at DESC);
  CREATE TABLE IF NOT EXISTS artist_update_tour_seen (
    tour_date_id TEXT PRIMARY KEY,
    artist_key TEXT,
    first_seen_at INTEGER NOT NULL,
    baseline INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_artist_update_tour_seen_artist ON artist_update_tour_seen(artist_key);
  CREATE TABLE IF NOT EXISTS artist_release_seen (
    release_key TEXT PRIMARY KEY,
    artist_key TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS artist_release_checks (
    artist_key TEXT PRIMARY KEY,
    deezer_id TEXT,
    checked_at INTEGER NOT NULL,
    baseline_done INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok'
  );
  CREATE TABLE IF NOT EXISTS artist_update_notices (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_key TEXT NOT NULL,
    notified_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, artist_key)
  );
  CREATE TABLE IF NOT EXISTS artist_update_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
}

const today = (at) => new Date(at).toISOString().slice(0, 10);
const isoDay = (value) => (/^\d{4}-\d{2}-\d{2}$/u.test(String(value || "")) ? value : null);
const dayMs = (value) => Date.parse(`${value}T00:00:00Z`);
const text = (value, max) => (typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, max) : "");
const parse = (value) => { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; } };
const stateGet = (database, key) => database.prepare("SELECT value FROM artist_update_state WHERE key=?").get(key)?.value || null;
const stateSet = (database, key, value) => database.prepare(`INSERT INTO artist_update_state(key,value) VALUES (?,?)
  ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));

// The same public rules as event pages and the sitemap: released, active,
// upcoming, not a held artist identity, not a memorialised artist.
export function publicUpcomingTourDateSql() {
  return `td.release_at<=@at AND td.date>=@today
    AND td.date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
    AND TRIM(COALESCE(td.artist,''))<>'' AND TRIM(COALESCE(td.venue,''))<>''
    AND (td.owner_id IS NOT NULL OR COALESCE(td.provider_active,1)=1)
    AND (td.owner_id IS NULL OR EXISTS (SELECT 1 FROM users owner WHERE owner.id=td.owner_id AND ${activeAccountSql("owner")}))
    AND ${artistAuthoredTourDateVisibleSql("td")}
    AND ${tourDateHasNoPublishedMemorialSql("td")}`;
}

const TOUR_COLUMNS = `td.id,td.artist,td.artist_key,td.venue,td.place,td.venue_city,td.date,td.event_name,td.owner_id,
  td.music_qualified,td.event_kind,td.music_evidence,td.billed_artists,td.event_end_date`;

function artistName(database, artistKey, fallback) {
  return database.prepare("SELECT name FROM artists WHERE norm=?").get(artistKey)?.name || text(fallback, 160) || artistKey;
}

function dateCard(row) {
  return { id: row.id, date: row.date, venue: text(row.venue, 180), city: text(row.venue_city || row.place, 120) };
}

function insertUpdate(database, values) {
  database.prepare(`INSERT INTO artist_updates(id,artist_key,artist_name,kind,dedupe_key,title,payload,source,source_url,occurred_at,created_at,updated_at)
    VALUES (@id,@artistKey,@artistName,@kind,@dedupeKey,@title,@payload,@source,@sourceUrl,@occurredAt,@at,@at)`).run(values);
  return database.prepare("SELECT * FROM artist_updates WHERE id=?").get(values.id);
}

// New public tour dates since the last pass, one news item per artist per day.
export function scanNewTourDates(database, { now = Date.now(), newId, visibilitySql = publicUpcomingTourDateSql(), limit = 5000 } = {}) {
  const baselineDone = !!stateGet(database, "tour_baseline_at");
  const rows = database.prepare(`SELECT ${TOUR_COLUMNS} FROM tour_dates td
    LEFT JOIN artist_update_tour_seen seen ON seen.tour_date_id=td.id
    WHERE seen.tour_date_id IS NULL AND ${visibilitySql}
    ORDER BY td.date ASC, td.id ASC LIMIT @limit`).all({ at: now, today: today(now), limit });
  const priorCount = database.prepare("SELECT COUNT(*) c FROM artist_update_tour_seen WHERE artist_key=?");
  const known = new Map();
  for (const row of rows) {
    if (row.artist_key && !known.has(row.artist_key)) known.set(row.artist_key, priorCount.get(row.artist_key).c);
  }
  const markSeen = database.prepare("INSERT OR IGNORE INTO artist_update_tour_seen(tour_date_id,artist_key,first_seen_at,baseline) VALUES (?,?,?,?)");
  for (const row of rows) markSeen.run(row.id, row.artist_key || null, now, baselineDone ? 0 : 1);
  if (!baselineDone) {
    if (rows.length < limit) stateSet(database, "tour_baseline_at", now);
    return { baseline: rows.length, created: [] };
  }

  const byArtist = new Map();
  for (const row of rows) {
    if (!row.artist_key || !isIndexableMusicEventRecord(row)) continue;
    if (!byArtist.has(row.artist_key)) byArtist.set(row.artist_key, []);
    byArtist.get(row.artist_key).push(row);
  }
  const created = [];
  for (const [artistKey, dates] of byArtist) {
    if (known.get(artistKey) === 0 && dates.length > NEW_ARTIST_QUIET_BATCH) continue;
    const dedupeKey = `shows:${artistKey}:${today(now)}`;
    const existing = database.prepare("SELECT * FROM artist_updates WHERE dedupe_key=?").get(dedupeKey);
    const prior = existing ? parse(existing.payload).dates || [] : [];
    const merged = [...prior, ...dates.map(dateCard).filter((card) => !prior.some((item) => item.id === card.id))]
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, MAX_SHOW_DATES);
    const count = (existing ? parse(existing.payload).count || prior.length : 0) + dates.filter((row) => !prior.some((item) => item.id === row.id)).length;
    const payload = JSON.stringify({ count, dates: merged });
    if (existing) {
      database.prepare("UPDATE artist_updates SET payload=?,title=?,updated_at=? WHERE id=?").run(payload, showsHeadline(count), now, existing.id);
      continue;
    }
    created.push(insertUpdate(database, {
      id: newId("au"), artistKey, artistName: artistName(database, artistKey, dates[0].artist), kind: "shows",
      dedupeKey, title: showsHeadline(count), payload, source: "mshpit", sourceUrl: null, occurredAt: now, at: now,
    }));
  }
  return { baseline: 0, created };
}

// Artists worth checking for releases: followed or touring, with a stored
// Deezer identity, not checked in the last day. Followed artists first.
function releaseCandidates(database, { now, limit, minGapMs }) {
  const rows = database.prepare(`WITH followed AS (
      SELECT artist AS key, COUNT(*) followers FROM fan_club_members GROUP BY artist
    ), touring AS (
      SELECT artist_key AS key, COUNT(*) upcoming FROM tour_dates WHERE artist_key IS NOT NULL AND date>=? GROUP BY artist_key
    ), keys AS (SELECT key FROM followed UNION SELECT key FROM touring)
    SELECT a.norm, a.name, a.data, COALESCE(a.popularity,0) popularity,
      COALESCE((SELECT followers FROM followed f WHERE f.key=a.norm OR f.key=LOWER(TRIM(a.name))),0) followers,
      COALESCE((SELECT upcoming FROM touring t WHERE t.key=a.norm),0) upcoming
    FROM keys k JOIN artists a ON a.norm=k.key
    LEFT JOIN artist_release_checks c ON c.artist_key=a.norm
    WHERE a.data LIKE '%"deezerId"%' AND (c.checked_at IS NULL OR c.checked_at<?)`).all(today(now), now - minGapMs);
  return rows
    .map((row) => ({ ...row, deezerId: String(parse(row.data).deezerId || "") }))
    .filter((row) => /^\d{1,15}$/u.test(row.deezerId))
    .sort((a, b) => b.followers - a.followers || b.upcoming - a.upcoming || b.popularity - a.popularity)
    .slice(0, limit);
}

const normalName = (value) => String(value || "").normalize("NFKC").trim().toLowerCase().replace(/\s+/gu, " ");

// New albums, EPs and singles for followed and touring artists.
export async function checkArtistReleases(database, { now = Date.now(), fetchJson, newId, limit = 30, minGapMs = 20 * 60 * 60 * 1000, minFans = 500, signal } = {}) {
  const outcome = { checked: 0, created: [], skipped: 0 };
  const day = today(now);
  for (const artist of releaseCandidates(database, { now, limit, minGapMs })) {
    if (signal?.aborted) break;
    const check = database.prepare("SELECT * FROM artist_release_checks WHERE artist_key=?").get(artist.norm);
    const record = (status, baselineDone) => database.prepare(`INSERT INTO artist_release_checks(artist_key,deezer_id,checked_at,baseline_done,status)
      VALUES (?,?,?,?,?) ON CONFLICT(artist_key) DO UPDATE SET deezer_id=excluded.deezer_id,checked_at=excluded.checked_at,
      baseline_done=MAX(artist_release_checks.baseline_done,excluded.baseline_done),status=excluded.status`)
      .run(artist.norm, artist.deezerId, now, baselineDone ? 1 : 0, status);
    try {
      // The stored id must still be this exact, established act before any of
      // its releases can be presented as this artist's news.
      const profile = await fetchJson(`https://api.deezer.com/artist/${artist.deezerId}`, { signal });
      if (normalName(profile?.name) !== normalName(artist.name) || (Number(profile?.nb_fan) || 0) < minFans) {
        record("identity_mismatch", !!check?.baseline_done);
        outcome.skipped += 1;
        continue;
      }
      const list = await fetchJson(`https://api.deezer.com/artist/${artist.deezerId}/albums?limit=100`, { signal });
      const releases = (Array.isArray(list?.data) ? list.data : [])
        .filter((item) => item?.id && RELEASE_TYPES.has(item.record_type) && text(item.title, 200) && isoDay(item.release_date))
        .sort((a, b) => String(b.release_date).localeCompare(String(a.release_date)));
      const baseline = !check?.baseline_done;
      const oldest = dayMs(day) - (baseline ? 14 : 30) * DAY;
      const newest = dayMs(day) + 120 * DAY;
      const seen = database.prepare("SELECT 1 FROM artist_release_seen WHERE release_key=?");
      const markSeen = database.prepare("INSERT OR IGNORE INTO artist_release_seen(release_key,artist_key,first_seen_at) VALUES (?,?,?)");
      let madeForArtist = 0;
      for (const release of releases) {
        const key = `deezer:${release.id}`;
        if (seen.get(key)) continue;
        markSeen.run(key, artist.norm, now);
        const released = dayMs(release.release_date);
        if (released < oldest || released > newest || madeForArtist >= 3) continue;
        const link = /^https:\/\/www\.deezer\.com\//u.test(String(release.link || "")) ? release.link : `https://www.deezer.com/album/${release.id}`;
        const cover = /^https:\/\//u.test(String(release.cover_xl || release.cover_big || release.cover_medium || ""))
          ? (release.cover_big || release.cover_medium || release.cover_xl) : null;
        const payload = { release: { id: String(release.id), title: text(release.title, 200), type: release.record_type, releaseDate: release.release_date, cover, url: link } };
        const createdRow = database.prepare("SELECT 1 FROM artist_updates WHERE dedupe_key=?").get(`release:${release.id}`) ? null : insertUpdate(database, {
          id: newId("au"), artistKey: artist.norm, artistName: artist.name, kind: "release", dedupeKey: `release:${release.id}`,
          title: releaseHeadline(payload.release), payload: JSON.stringify(payload), source: "deezer", sourceUrl: link,
          occurredAt: released, at: now,
        });
        if (createdRow) { outcome.created.push(createdRow); madeForArtist += 1; }
      }
      record("ok", true);
      outcome.checked += 1;
    } catch (error) {
      if (signal?.aborted) break;
      record("error", !!check?.baseline_done);
      outcome.skipped += 1;
    }
  }
  return outcome;
}

// Who follows an artist: members who added it to their favourite artists
// (the Follow button) and members of its fan club.
const FOLLOWERS_SQL = `SELECT f.user_id AS user_id FROM fan_club_members f WHERE f.artist=@key OR f.artist=@name
  UNION SELECT u.id FROM users u, json_each(CASE WHEN json_valid(u.favorite_artists) THEN u.favorite_artists ELSE '[]' END) fav
    WHERE LOWER(TRIM(fav.value))=@name`;

// Followers hear about news at most once per artist every 12 hours each.
export function notifyFollowers(database, update, { notify, now = Date.now(), cooldownMs = 12 * 60 * 60 * 1000 }) {
  const recipients = database.prepare(`SELECT DISTINCT followers.user_id FROM (${FOLLOWERS_SQL}) followers
    JOIN users member ON member.id=followers.user_id AND COALESCE(member.is_banned,0)=0
    LEFT JOIN artist_update_notices n ON n.user_id=followers.user_id AND n.artist_key=@key
    WHERE n.notified_at IS NULL OR n.notified_at<@since`)
    .all({ key: update.artist_key, name: update.artist_name.trim().toLowerCase(), since: now - cooldownMs }).map((row) => row.user_id);
  const remember = database.prepare(`INSERT INTO artist_update_notices(user_id,artist_key,notified_at) VALUES (?,?,?)
    ON CONFLICT(user_id,artist_key) DO UPDATE SET notified_at=excluded.notified_at`);
  for (const userId of recipients) {
    notify(userId, update);
    remember.run(userId, update.artist_key, now);
  }
  database.prepare("UPDATE artist_updates SET notified_at=? WHERE id=?").run(now, update.id);
  return recipients.length;
}

// Newest first, with a (created_at, id) cursor. `followerId` limits it to the
// artists that member follows.
export function listArtistUpdates(database, { artistKey = null, followerId = null, cursor = null, limit = 20 } = {}) {
  const size = Math.max(1, Math.min(60, Number(limit) || 20));
  const where = [];
  const args = [];
  if (artistKey) { where.push("u.artist_key=?"); args.push(artistKey); }
  if (followerId) {
    where.push(`(EXISTS (SELECT 1 FROM fan_club_members f WHERE f.user_id=? AND (f.artist=u.artist_key OR f.artist=LOWER(TRIM(u.artist_name))))
      OR EXISTS (SELECT 1 FROM users member, json_each(CASE WHEN json_valid(member.favorite_artists) THEN member.favorite_artists ELSE '[]' END) fav
        WHERE member.id=? AND LOWER(TRIM(fav.value)) IN (u.artist_key, LOWER(TRIM(u.artist_name)))))`);
    args.push(followerId, followerId);
  }
  if (cursor && Number.isFinite(cursor.createdAt) && typeof cursor.id === "string") {
    where.push("(u.created_at<? OR (u.created_at=? AND u.id<?))");
    args.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const rows = database.prepare(`SELECT u.* FROM artist_updates u ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY u.created_at DESC, u.id DESC LIMIT ?`).all(...args, size + 1);
  const page = rows.slice(0, size);
  const last = page.at(-1);
  return { rows: page, nextCursor: rows.length > size && last ? { createdAt: last.created_at, id: last.id } : null };
}

// Public shape. Tour dates are re-checked against the public rules on every
// read, so a cancelled or hidden date drops out, and an item with none left
// is not shown at all.
export function projectArtistUpdate(row, { artist = null, visibleDates = new Map(), day, eventPathFor = () => null }) {
  const payload = parse(row.payload);
  const base = {
    id: row.id,
    kind: row.kind,
    artist: { key: row.artist_key, name: artist?.name || row.artist_name, publicSlug: artist?.public_slug || null, photo: artist?.photo || null },
    createdAt: row.created_at,
  };
  if (row.kind === "release") {
    const release = payload.release || {};
    if (!release.title) return null;
    return {
      ...base,
      title: row.title,
      release: { title: release.title, type: release.type, releaseDate: release.releaseDate, cover: release.cover || null, url: release.url || null, upcoming: !!day && release.releaseDate > day },
      source: { name: "Deezer", url: release.url || row.source_url || null },
    };
  }
  const dates = (payload.dates || []).filter((item) => visibleDates.has(item.id))
    .map((item) => ({ ...item, path: eventPathFor(item.id) }));
  if (!dates.length) return null;
  return { ...base, title: showsHeadline(dates.length), shows: { count: dates.length, dates: dates.slice(0, 12) }, source: { name: "Mshpit", url: null } };
}

export function tourDateIdsIn(rows) {
  return [...new Set(rows.filter((row) => row.kind === "shows").flatMap((row) => (parse(row.payload).dates || []).map((item) => item.id)))];
}
