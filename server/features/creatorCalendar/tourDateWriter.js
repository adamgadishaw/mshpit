import { ApiError } from "../../errors.js";
// Shared persistence for the existing batch form and creator composer.
export function writeTourDateBatch(db, {batch, user, uid, at}) {
  if (!db.isTransaction) throw new TypeError('Calendar writes require a transaction');
  const source = user.role === 'artist' ? 'artist-submitted' : 'admin-submitted';
  return batch.dates.map((entry) => {
        const existing = db.prepare(`SELECT id,music_evidence FROM tour_dates
          WHERE owner_id=? AND lower(artist)=lower(?) AND lower(venue)=lower(?)
            AND lower(place)=lower(?) AND date=? LIMIT 1`)
          .get(user.id, batch.artist, entry.venue, entry.place, entry.date);
        if (existing?.music_evidence === "mshpit:creator-calendar") {
          throw new ApiError(409, "Use Show dates in Post to followers to change this calendar record.", "CONFLICT");
        }
        const updatedAt = Math.max(at, Date.parse(`${entry.date}T00:00:00.000Z`) || at);
        const id = existing?.id || uid("td");
        if (existing) {
          db.prepare(`UPDATE tour_dates SET artist=?,venue=?,place=?,lat=NULL,lng=NULL,ticket_url=?,sold_out=0,
            source=?,creator_revision=creator_revision+1,updated_at=?,release_at=?,event_name=?,event_kind=?,event_end_date=?,billed_artists=?,
            music_evidence=CASE WHEN music_evidence='mshpit:creator-calendar' THEN music_evidence ELSE ? END,music_qualified=1,event_source_url=? WHERE id=? AND owner_id=?`)
            .run(batch.artist, entry.venue, entry.place, entry.ticketUrl, source, updatedAt, batch.releaseAt,
              entry.eventName || null, entry.eventKind || "concert", entry.eventEndDate || null,
              JSON.stringify(entry.billedArtists || []), entry.eventName ? "staff:verified-official-source" : null,
              entry.eventSourceUrl || null, id, user.id);
        } else {
          db.prepare(`INSERT INTO tour_dates
            (id,artist,venue,place,lat,lng,date,ticket_url,sold_out,source,updated_at,owner_id,release_at,
              event_name,event_kind,event_end_date,billed_artists,music_evidence,music_qualified,event_source_url)
            VALUES (?,?,?,?,NULL,NULL,?,?,0,?,?,?,?,?,?,?,?,?,1,?)`)
            .run(id, batch.artist, entry.venue, entry.place, entry.date, entry.ticketUrl, source, updatedAt, user.id, batch.releaseAt,
              entry.eventName || null, entry.eventKind || "concert", entry.eventEndDate || null,
              JSON.stringify(entry.billedArtists || []), entry.eventName ? "staff:verified-official-source" : null,
              entry.eventSourceUrl || null);
        }
        return db.prepare("SELECT * FROM tour_dates WHERE id=?").get(id);
      });
}
