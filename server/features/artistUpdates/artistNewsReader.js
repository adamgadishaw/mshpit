import { isIndexableMusicEventRecord } from "../seo/publicEntityPolicy.js";
import {
  ensureArtistUpdatesSchema,
  listArtistUpdates,
  projectArtistUpdate,
  publicUpcomingTourDateSql,
  tourDateIdsIn,
} from "./artistUpdatesService.js";

// One reader for every place news appears: the API, artist pages and the
// public /news page. Each read re-checks tour dates against the public event
// rules, so nothing hidden, cancelled or past is ever shown as news.
//
// `ensureSchema: false` is for read-only connections such as the sitemap
// snapshot, which must never write; a missing table just means no news.
export function createArtistNewsReader(database, { eventPathFor, artistPathFor, visibilitySql = publicUpcomingTourDateSql(), ensureSchema = true } = {}) {
  let ready = !ensureSchema;
  const prepare = () => {
    if (!ready) { ensureArtistUpdatesSchema(database); ready = true; }
  };

  function visibleDates(ids, at) {
    const visible = new Map();
    if (!ids.length) return visible;
    const today = new Date(at).toISOString().slice(0, 10);
    for (let index = 0; index < ids.length; index += 200) {
      const chunk = ids.slice(index, index + 200);
      const params = Object.fromEntries(chunk.map((id, position) => [`id${position}`, id]));
      const rows = database.prepare(`SELECT td.id,td.artist,td.venue,td.date,td.event_name,td.owner_id,td.music_qualified,
          td.event_kind,td.music_evidence,td.billed_artists,td.event_end_date
        FROM tour_dates td WHERE td.id IN (${chunk.map((_, position) => `@id${position}`).join(",")}) AND ${visibilitySql}`)
        .all({ ...params, at, today });
      for (const row of rows) if (isIndexableMusicEventRecord(row)) visible.set(row.id, row);
    }
    return visible;
  }

  function artistsFor(rows) {
    const keys = [...new Set(rows.map((row) => row.artist_key))];
    const found = new Map();
    const lookup = database.prepare("SELECT norm,name,public_slug,photo FROM artists WHERE norm=?");
    for (const key of keys) {
      const artist = lookup.get(key);
      if (artist) found.set(key, artist);
    }
    return found;
  }

  function project(rows, at) {
    const day = new Date(at).toISOString().slice(0, 10);
    const dates = visibleDates(tourDateIdsIn(rows), at);
    const artists = artistsFor(rows);
    return rows.map((row) => {
      const artist = artists.get(row.artist_key) || null;
      const item = projectArtistUpdate(row, { artist, visibleDates: dates, day, eventPathFor });
      if (!item) return null;
      return { ...item, artist: { ...item.artist, path: artistPathFor?.(artist || { name: row.artist_name }) || null } };
    }).filter(Boolean);
  }

  return Object.freeze({
    // A page of news; `followerId` limits it to the artists someone follows.
    read({ artistKey = null, followerId = null, cursor = null, limit = 20, at = Date.now() } = {}) {
      prepare();
      try {
        const { rows, nextCursor } = listArtistUpdates(database, { artistKey, followerId, cursor, limit });
        return { items: project(rows, at), nextCursor };
      } catch (error) {
        // A snapshot or test database without the full catalogue schema has no
        // news to show; it must not take the page down with it.
        if (/no such (table|column|function)/iu.test(String(error?.message))) return { items: [], nextCursor: null };
        throw error;
      }
    },
  });
}

export const encodeNewsCursor = (cursor) => (cursor ? `${cursor.createdAt}.${cursor.id}` : null);
export function decodeNewsCursor(value) {
  const match = /^(\d{1,15})\.([A-Za-z0-9_-]{1,80})$/u.exec(String(value || ""));
  return match ? { createdAt: Number(match[1]), id: match[2] } : null;
}
