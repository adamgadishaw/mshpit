import { ticketmasterAttractionMatchesArtist } from "../../artistBillingIdentity.js";
import { PROVIDER_ARTIST_SOURCE } from "../../providerArtistRegistration.js";
import { ticketmasterRows } from "../../tourdates.js";

const providerId = value => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/u.test(value) ? value : null;
const norm = value => String(value || "").trim().toLowerCase();
const searchKey = value => String(value || "").normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

// Read-only counterpart to provider registration. Lookup must not register an
// attraction, touch last_seen_at, spend a budget, or turn a name into a crosswalk.
export function createTicketmasterLookupIdentity(database) {
  const byKey = database.prepare("SELECT norm,name,source FROM artists WHERE norm=?");
  const occupied = database.prepare(`SELECT norm,name,source FROM artists
    WHERE norm=? OR lower(trim(name))=lower(trim(?)) OR search_key=? LIMIT 3`);
  const mapped = database.prepare(`SELECT m.artist_key,a.norm,a.name,a.source
    FROM provider_artist_identities m LEFT JOIN artists a ON a.norm=m.artist_key
    WHERE m.provider='ticketmaster' AND m.provider_id=? COLLATE BINARY`);
  const hasMapping = database.prepare("SELECT 1 FROM provider_artist_identities WHERE artist_key=? LIMIT 1");
  const held = database.prepare(`SELECT 1 FROM artist_profiles WHERE artist_key=?
    AND (removed<>0 OR COALESCE(identity_review_status,'clear') IN ('pending','rejected')) LIMIT 1`);
  const retained = database.prepare(`SELECT artist_key,artist_identity_status,provider_artist_id FROM tour_dates
    WHERE id=? AND source='ticketmaster' AND owner_id IS NULL`);

  function candidates(data, artist) {
    const result = [];
    for (const event of data?._embedded?.events || []) {
      const rows = ticketmasterRows({ _embedded: { events: [event] } }, { requestedArtist: artist });
      const attractions = Array.isArray(event?._embedded?.attractions) ? event._embedded.attractions : [];
      const matching = attractions.filter(attraction => ticketmasterAttractionMatchesArtist(attraction, artist));
      const ids = [...new Set(matching.map(attraction => providerId(attraction.id)).filter(Boolean))];
      // Keep raw billing evidence even when primary-artist parsing returns no
      // ID for an approved alias or joint bill. Otherwise those IDs could evade
      // a contradictory registry mapping merely by changing name spelling.
      const ambiguous = attractions.length > 50 || !matching.length || ids.length > 1
        || matching.some(attraction => attraction.id != null && !providerId(attraction.id))
        || (matching.length > 1 && matching.some(attraction => !providerId(attraction.id)));
      for (const row of rows) result.push({ row, providerId: ids[0] || null, ambiguous });
    }
    const pageIds = new Set(result.map(candidate => candidate.providerId).filter(Boolean));
    return result.map(candidate => ({ ...candidate, ambiguousLegacyPage: pageIds.size > 1 }));
  }

  function proof(candidate, { artist, artistKey }) {
    const { row, providerId: id } = candidate;
    if (candidate.ambiguous || ["pending", "conflict"].includes(row.artist_identity_status)) return null;
    const selected = artistKey ? byKey.get(artistKey) : null;
    if (artistKey && (!selected || norm(selected.name) !== norm(artist))) return null;
    const previous = retained.get(row.id);
    if (previous && (["pending", "conflict"].includes(previous.artist_identity_status)
      || (artistKey && previous.artist_key && previous.artist_key !== artistKey)
      || (previous.provider_artist_id && previous.provider_artist_id !== id))) return null;
    const known = id ? mapped.get(id) : null;
    if (known) {
      if (!known.norm || (artistKey && known.norm !== artistKey)
        || (previous?.artist_key && previous.artist_key !== known.norm)
        || !ticketmasterAttractionMatchesArtist({ name: known.name }, artist)
        || known.source === "artist-created" || held.get(known.norm)) return null;
      // Without an explicit selection, a shared display name is still ambiguous.
      if (!artistKey && occupied.all(norm(artist), artist, searchKey(artist)).some(value => value.norm !== known.norm)) return null;
      return JSON.stringify(["mapped", id, known.norm]);
    }
    const matches = occupied.all(norm(artist), artist, searchKey(artist));
    if (candidate.ambiguousLegacyPage || matches.length > 1) return null;
    const legacy = matches[0];
    if (previous?.artist_key && previous.artist_key !== legacy?.norm) return null;
    if (legacy && (norm(legacy.name) !== norm(artist) || (artistKey && legacy.norm !== artistKey)
      || [PROVIDER_ARTIST_SOURCE, "artist-created"].includes(legacy.source)
      || hasMapping.get(legacy.norm) || held.get(legacy.norm))) return null;
    if (artistKey && !legacy) return null;
    return JSON.stringify(["legacy", id, legacy?.norm || null]);
  }
  return { candidates, proof };
}
