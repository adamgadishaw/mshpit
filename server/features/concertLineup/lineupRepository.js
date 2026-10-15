import { activeAccountSql } from "../../accountVisibility.js";
import { inPersonReviewSql } from "../../onlineReviews.js";
import { storedLineupAct } from "../../supportingActs.js";

// Sets an artist played on other people's bills: as an opener, a co-headliner
// or at a festival, from post_lineup_acts (kept by triggers on posts). The
// same visibility rules as artist reviews: live posts from active accounts,
// minus anyone the viewer blocked or who blocked them.
const BLOCK_FILTER = `AND (? IS NULL OR NOT EXISTS (
  SELECT 1 FROM blocks b
  WHERE (b.blocker_id=? AND b.blocked_id=p.user_id)
     OR (b.blocker_id=p.user_id AND b.blocked_id=?)
))`;
const visibleSets = `a.artist_ref IN (?, 'name:' || lower(trim(?)))
  AND p.removed=0 AND ${inPersonReviewSql("p")} AND ${activeAccountSql("u")}
  ${BLOCK_FILTER}`;
const SET_LIMIT = 12;
const DAY_MS = 86_400_000;
const isDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const shiftDate = (value, days) => new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
const parseNames = (value) => {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((name) => typeof name === "string" && name.trim()).map((name) => name.trim()) : [];
  } catch { return []; } // architecture: allow-ambiguous-result -- a damaged provider billing adds no suggestions
};

export function createLineupRepository(database) {
  if (!database?.prepare) throw new TypeError("Lineups require a database");
  const setRows = database.prepare(`SELECT a.role, a.rating, a.position, p.id AS post_id, p.user_id, p.artist, p.artist_key,
      p.venue, p.city, p.date, p.end_date, p.show_format, p.supporting_acts, p.created_at, ar.public_slug AS headliner_slug
    FROM post_lineup_acts a
    JOIN posts p ON p.id=a.post_id
    JOIN users u ON u.id=p.user_id
    LEFT JOIN artists ar ON ar.norm=p.artist_key
    WHERE ${visibleSets}
    ORDER BY CASE WHEN p.date<>'' THEN p.date ELSE '' END DESC, p.created_at DESC, p.id, a.position
    LIMIT ?`);
  const summaryRows = database.prepare(`SELECT a.role, COUNT(*) AS sets, COUNT(a.rating) AS rated, AVG(a.rating) AS average
    FROM post_lineup_acts a JOIN posts p ON p.id=a.post_id JOIN users u ON u.id=p.user_id
    WHERE ${visibleSets}
    GROUP BY a.role`);
  const openedForRows = database.prepare(`SELECT MIN(p.artist) AS name, p.artist_key, MAX(ar.public_slug) AS public_slug, COUNT(DISTINCT p.id) AS shows
    FROM post_lineup_acts a JOIN posts p ON p.id=a.post_id JOIN users u ON u.id=p.user_id
    LEFT JOIN artists ar ON ar.norm=p.artist_key
    WHERE a.role IN ('opener','co_headliner') AND p.show_format<>'festival' AND ${visibleSets}
    GROUP BY CASE WHEN COALESCE(p.artist_key,'')<>'' THEN p.artist_key ELSE 'name:' || lower(trim(p.artist)) END
    ORDER BY shows DESC, name
    LIMIT 6`);
  const festivalRows = database.prepare(`SELECT MIN(p.artist) AS name, MAX(p.date) AS last_date, COUNT(DISTINCT p.id) AS reviews
    FROM post_lineup_acts a JOIN posts p ON p.id=a.post_id JOIN users u ON u.id=p.user_id
    WHERE a.role='festival_set' AND ${visibleSets}
    GROUP BY lower(trim(p.artist))
    ORDER BY last_date DESC, name
    LIMIT 6`);
  const billedNear = database.prepare(`SELECT billed_artists, event_name, venue, date FROM tour_dates
    WHERE (artist_key=? OR lower(trim(artist))=lower(trim(?))) AND date BETWEEN ? AND ?
    ORDER BY CASE WHEN lower(trim(COALESCE(venue,'')))=lower(trim(?)) THEN 0 ELSE 1 END, date
    LIMIT 4`);
  const festivalBilling = database.prepare(`SELECT billed_artists, date FROM tour_dates
    WHERE event_kind IN ('festival','multi_day') AND instr(lower(COALESCE(event_name, artist)), lower(trim(?)))>0
      AND date BETWEEN ? AND ?
    ORDER BY date
    LIMIT 40`);
  const fansOpeners = database.prepare(`SELECT MIN(a.name) AS name, COUNT(DISTINCT p.user_id) AS fans
    FROM post_lineup_acts a JOIN posts p ON p.id=a.post_id JOIN users u ON u.id=p.user_id
    WHERE a.role IN ('opener','co_headliner') AND p.removed=0 AND ${inPersonReviewSql("p")} AND ${activeAccountSql("u")}
      AND (p.artist_key=? OR (COALESCE(p.artist_key,'')='' AND lower(trim(p.artist))=lower(trim(?))))
      AND (?='' OR (p.date<>'' AND p.date BETWEEN ? AND ?))
    GROUP BY a.artist_ref
    ORDER BY fans DESC, name
    LIMIT 8`);

  return Object.freeze({
    // Everything the artist page shows about sets on other people's bills.
    artistSets({ artistKey = null, name = "", viewerId = null }) {
      const identity = [artistKey || "", name || ""];
      const viewer = viewerId ? String(viewerId) : null;
      const blockArgs = [viewer, viewer, viewer];
      const summary = Object.fromEntries(summaryRows.all(...identity, ...blockArgs).map((row) => [row.role, {
        sets: Number(row.sets) || 0,
        rated: Number(row.rated) || 0,
        average: row.average == null ? null : Math.round(Number(row.average) * 10) / 10,
      }]));
      const sets = setRows.all(...identity, ...blockArgs, SET_LIMIT).map((row) => {
        const act = storedLineupAct(row.supporting_acts, Number(row.position));
        return {
          postId: row.post_id,
          userId: row.user_id,
          role: row.role,
          rating: row.rating == null ? null : Number(row.rating),
          review: act?.review || "",
          day: act?.day || null,
          stage: act?.stage || null,
          showFormat: row.show_format || "headline",
          headliner: { name: row.artist, artistKey: row.artist_key || null, publicSlug: row.headliner_slug || null },
          venue: row.venue || "",
          city: row.city || "",
          date: row.date || "",
          endDate: row.end_date || "",
          createdAt: row.created_at,
        };
      });
      const openedFor = openedForRows.all(...identity, ...blockArgs).map((row) => ({
        name: row.name, artistKey: row.artist_key || null, publicSlug: row.public_slug || null, shows: Number(row.shows) || 0,
      }));
      const festivals = festivalRows.all(...identity, ...blockArgs).map((row) => ({
        name: row.name, lastDate: row.last_date || "", reviews: Number(row.reviews) || 0,
      }));
      return { summary, sets, openedFor, festivals };
    },

    // Acts to offer while someone writes the lineup: the provider's billing for
    // that show, then the openers other fans listed on the same run of dates.
    // A festival gets its billing with the day each act plays.
    suggestions({ artist, artistKey = null, date = "", venue = "", showFormat = "headline" }) {
      const main = String(artist || "").trim().toLowerCase();
      const out = [];
      const seen = new Set([main]);
      const add = (name, extra) => {
        const key = name.toLowerCase();
        if (!name || seen.has(key) || out.length >= 24) return;
        seen.add(key);
        out.push({ name, ...extra });
      };
      if (showFormat === "festival") {
        if (main.length >= 3) {
          const from = isDate(date) ? shiftDate(date, -3) : new Date(Date.now() - 400 * DAY_MS).toISOString().slice(0, 10);
          const to = isDate(date) ? shiftDate(date, 14) : new Date(Date.now() + 400 * DAY_MS).toISOString().slice(0, 10);
          for (const row of festivalBilling.all(main, from, to)) {
            for (const name of parseNames(row.billed_artists)) add(name, { source: "billed", day: isDate(row.date) ? row.date : null });
          }
        }
        return out;
      }
      if (isDate(date)) {
        for (const row of billedNear.all(artistKey || "", artist || "", shiftDate(date, -1), shiftDate(date, 1), venue || "")) {
          for (const name of parseNames(row.billed_artists)) add(name, { source: "billed" });
        }
      }
      const window = isDate(date) ? [date, shiftDate(date, -150), shiftDate(date, 150)] : ["", "", ""];
      for (const row of fansOpeners.all(artistKey || "", artist || "", ...window)) {
        add(row.name, { source: "fans", fans: Number(row.fans) || 0 });
      }
      return out;
    },
  });
}
