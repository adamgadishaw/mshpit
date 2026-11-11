import { normalizeShowAliasKey, normalizeStableShowId } from "./showIdentity.js";
import { tourDateArtistIdentityPending } from "../../providerArtistBinding.js";
import { liveEventTimeZone } from "../../../src/domain/eventLifecycle.mjs";
import { tourDateShowLifecycle } from "./showLifecycle.js";

function attendanceView(row) {
  if (!row) return null;
  return {
    state: row.state,
    visibility: row.visibility,
    verified: !!row.attendance_verified,
    checkedInAt: row.checked_in_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function providerBacked(row) {
  return !!row?.provider && !!row?.provider_event_id;
}

function providerSourceMatches(show, source) {
  return !!source && source.owner_id == null && providerBacked(show)
    && String(source.source || "").toLowerCase() === String(show.provider).toLowerCase()
    && source.provider_event_id === show.provider_event_id;
}

function sourceTiming(source, at) {
  const startAt = Date.parse(source.start_date_time || "");
  return {
    date: source.date || "",
    localDate: source.date || null,
    startsAt: Number.isFinite(startAt) ? startAt : null,
    startLocalTime: source.start_local_time || null,
    timezone: liveEventTimeZone(source),
    lifecycle: tourDateShowLifecycle(source, at),
  };
}

export function createShowRepository(database, { now = () => Date.now() } = {}) {
  if (!database?.prepare) throw new TypeError("Show repository requires a database");

  // All identity lookups use primary/unique indexes. This read path never calls
  // the lazy attendance allocator, so an unknown URL cannot create catalogue data.
  const byId = database.prepare("SELECT * FROM shows WHERE id=?");
  const sourceFields = `owner_id,artist_identity_status,source,provider_event_id,
    date,start_date_time,start_local_time,event_timezone,event_status`;
  const sourceById = database.prepare(`SELECT ${sourceFields} FROM tour_dates WHERE id=?`);
  const sourceByProvider = database.prepare(`SELECT owner_id,artist_identity_status FROM tour_dates
    WHERE owner_id IS NULL AND source=? AND provider_event_id=?
      AND artist_identity_status IN ('pending','conflict') LIMIT 1`);
  const timingSourcesByProvider = database.prepare(`SELECT ${sourceFields} FROM tour_dates
    WHERE owner_id IS NULL AND source=? AND provider_event_id=? LIMIT 2`);
  const canonicalId = database.prepare("SELECT id FROM shows WHERE canonical_key=?");
  const aliasShowIds = database.prepare(`SELECT show_id AS id FROM show_aliases
    WHERE alias_value=? GROUP BY show_id ORDER BY show_id LIMIT 2`);
  const aliasesByShow = database.prepare(`SELECT alias_type,alias_value FROM show_aliases
    WHERE show_id=? ORDER BY alias_type,alias_value LIMIT 100`);
  const performersByShow = database.prepare(`SELECT performer_key,performer_name,role,position
    FROM show_performers WHERE show_id=? ORDER BY position,performer_name LIMIT 100`);
  const attendanceByViewer = database.prepare(`SELECT a.*,
    EXISTS (SELECT 1 FROM show_attendance_verifications v
      WHERE v.show_id=a.show_id AND v.user_id=a.user_id AND v.revoked_at IS NULL) AS attendance_verified
    FROM show_attendance a WHERE a.show_id=? AND a.user_id=?`);

  function resolve(value) {
    if (typeof value !== "string") return null;
    const raw = value.normalize("NFKC").trim();
    if (!raw || [...raw].length > 300) return null;
    const showId = normalizeStableShowId(raw);
    if (showId) return byId.get(showId) || null;
    const key = normalizeShowAliasKey(raw);
    if (!key) return null;
    // Alias types are separate namespaces and may intentionally reuse an opaque
    // value. Canonical keys can also collide with such a value. A URL without
    // an explicit namespace must therefore resolve to exactly one distinct Show
    // or fail closed; priority ordering would silently open the wrong night.
    const matches = new Set(aliasShowIds.all(key).map(({ id }) => id));
    const canonical = canonicalId.get(key);
    if (canonical) matches.add(canonical.id);
    return matches.size === 1 ? (byId.get(matches.values().next().value) || null) : null;
  }

  function read(value, viewerId = null) {
    const row = resolve(value);
    if (!row) return null;
    const attendance = viewerId ? attendanceByViewer.get(row.id, viewerId) : null;
    const isPublic = !!row.public_eligible && providerBacked(row);
    if (!isPublic && !attendance) return null;
    // A stored Show can predate provider identity review. Recheck its source
    // without mutating it so stale performer keys cannot bypass a later hold.
    const exactSource = row.tour_date_id ? sourceById.get(row.tour_date_id) : null;
    const sources = exactSource ? [exactSource] : providerBacked(row)
      ? sourceByProvider.all(row.provider, row.provider_event_id) : [];
    const artistIdentityPending = sources.some(tourDateArtistIdentityPending);
    // Timing is mutable provider evidence, unlike the stable Show identity and
    // member's historical attendance snapshot. Resolve it on every read without
    // writing to either. A legacy provider-only Show needs one exact source;
    // an ambiguous match or a member-owned row cannot supply public facts.
    const timingSources = exactSource ? [exactSource] : providerBacked(row)
      ? timingSourcesByProvider.all(row.provider, row.provider_event_id) : [];
    const timing = timingSources.length === 1 && providerSourceMatches(row, timingSources[0])
      ? sourceTiming(timingSources[0], now()) : null;
    return {
      id: row.id,
      canonicalKey: row.canonical_key,
      aliases: aliasesByShow.all(row.id).map((alias) => ({
        type: alias.alias_type,
        value: alias.alias_value,
      })),
      artist: row.artist || "",
      artistKey: artistIdentityPending ? null : row.artist_key || null,
      ...(artistIdentityPending ? { artistIdentityPending: true } : {}),
      performers: performersByShow.all(row.id).map((performer) => ({
        key: artistIdentityPending ? null : performer.performer_key,
        name: performer.performer_name || "",
        role: performer.role,
        position: performer.position,
      })),
      venue: row.venue || "",
      venueKey: row.venue_key || null,
      city: row.city || "",
      tour: row.tour || null,
      date: row.date || "",
      localDate: row.local_date || null,
      startsAt: row.start_at || null,
      startLocalTime: row.start_local_time || null,
      timezone: row.timezone || null,
      lifecycle: row.lifecycle || "unknown",
      ...timing,
      provider: providerBacked(row) ? {
        name: row.provider,
        eventId: row.provider_event_id,
        backed: true,
      } : null,
      publicEligible: isPublic,
      indexable: isPublic,
      viewerAttendance: attendanceView(attendance),
    };
  }

  return Object.freeze({ read, resolve });
}
