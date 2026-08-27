import {
  isAttendeeState,
  normalizeShowAliasKey,
  normalizeStableShowId,
  showCheckInAvailable,
  stableShowIdForAlias,
} from "./showIdentity.js";

const LEGACY_ALIAS_TYPE = "legacy_concert_key";
const ATTENDEE_STATES_SQL = "('going','here','went')";

function placeholders(values) {
  return values.map(() => "?").join(",");
}

function rowShow(row, aliases = []) {
  if (!row) return null;
  return {
    id: row.id,
    canonicalKey: row.canonical_key,
    artist: row.artist || "",
    artistKey: row.artist_key || null,
    venue: row.venue || "",
    venueKey: row.venue_key || null,
    city: row.city || "",
    date: row.date || "",
    tour: row.tour || null,
    startAt: row.start_at || null,
    timezone: row.timezone || null,
    lifecycle: row.lifecycle || "unknown",
    provider: row.provider || null,
    providerEventId: row.provider_event_id || null,
    publicEligible: !!row.public_eligible,
    aliases,
    persisted: true,
  };
}

export function createShowAttendanceRepository(database) {
  if (!database?.prepare) throw new TypeError("Show attendance repository requires a database");

  const showByAlias = database.prepare(`SELECT s.* FROM show_aliases a
    JOIN shows s ON s.id=a.show_id WHERE a.alias_type=? AND a.alias_value=?`);
  const showById = database.prepare("SELECT * FROM shows WHERE id=?");
  const showByCanonicalKey = database.prepare("SELECT * FROM shows WHERE canonical_key=?");
  const aliasesByShow = database.prepare(`SELECT alias_type,alias_value FROM show_aliases
    WHERE show_id=? ORDER BY alias_type,alias_value`);
  const insertShow = database.prepare(`INSERT OR IGNORE INTO shows
    (id,canonical_key,identity_source,public_eligible,created_at,updated_at)
    VALUES (?,?,'member_legacy_alias',0,?,?)`);
  const insertAlias = database.prepare(`INSERT OR IGNORE INTO show_aliases
    (alias_type,alias_value,show_id,created_at) VALUES (?,?,?,?)`);
  const attendanceByUserShow = database.prepare(`SELECT a.*,
    EXISTS (SELECT 1 FROM show_attendance_verifications v
      WHERE v.show_id=a.show_id AND v.user_id=a.user_id AND v.revoked_at IS NULL) AS attendance_verified
    FROM show_attendance a WHERE a.user_id=? AND a.show_id=?`);
  const upsertAttendance = database.prepare(`INSERT INTO show_attendance
    (show_id,user_id,state,visibility,checked_in_at,
      legacy_concert_key,legacy_artist,legacy_artist_key,legacy_venue,legacy_venue_key,
      legacy_city,legacy_date,legacy_tour,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(show_id,user_id) DO UPDATE SET
      state=excluded.state,visibility=excluded.visibility,
      checked_in_at=excluded.checked_in_at,
      legacy_concert_key=excluded.legacy_concert_key,
      legacy_artist=excluded.legacy_artist,
      legacy_artist_key=excluded.legacy_artist_key,
      legacy_venue=excluded.legacy_venue,
      legacy_venue_key=excluded.legacy_venue_key,
      legacy_city=excluded.legacy_city,
      legacy_date=excluded.legacy_date,
      legacy_tour=excluded.legacy_tour,
      updated_at=excluded.updated_at`);
  const deleteAttendance = database.prepare("DELETE FROM show_attendance WHERE show_id=? AND user_id=?");
  const claimLegacyConcertKey = database.prepare(`UPDATE show_attendance
    SET legacy_concert_key=?
    WHERE show_id=? AND user_id=? AND legacy_concert_key IS NULL`);
  const insertLegacyGoing = database.prepare(`INSERT INTO going
    (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(user_id,concert_key) DO UPDATE SET
      artist=excluded.artist,venue=excluded.venue,city=excluded.city,date=excluded.date`);

  function resolveShow(value) {
    const key = normalizeShowAliasKey(value);
    if (!key) return null;
    const showId = normalizeStableShowId(value);
    if (showId) {
      const exact = showById.get(showId);
      if (!exact) return null;
      const aliases = aliasesByShow.all(exact.id)
        .filter(({ alias_type: type }) => type === LEGACY_ALIAS_TYPE)
        .map(({ alias_value: alias }) => alias);
      return rowShow(exact, aliases);
    }
    const row = showByAlias.get(LEGACY_ALIAS_TYPE, key) || showByCanonicalKey.get(key);
    if (!row) {
      return {
        id: stableShowIdForAlias(key),
        canonicalKey: key,
        artist: "",
        artistKey: null,
        venue: "",
        venueKey: null,
        city: "",
        date: "",
        tour: null,
        startAt: null,
        timezone: null,
        lifecycle: "unknown",
        provider: null,
        providerEventId: null,
        aliases: [key],
        persisted: false,
      };
    }
    const aliases = aliasesByShow.all(row.id)
      .filter(({ alias_type: type }) => type === LEGACY_ALIAS_TYPE)
      .map(({ alias_value: alias }) => alias);
    return rowShow(row, aliases.length ? aliases : [row.canonical_key]);
  }

  function ensureShow({ key: value, at }) {
    const key = normalizeShowAliasKey(value);
    if (normalizeStableShowId(value)) return resolveShow(value);
    const existingAlias = showByAlias.get(LEGACY_ALIAS_TYPE, key);
    if (existingAlias) return resolveShow(key);
    const existingCanonical = showByCanonicalKey.get(key);
    if (existingCanonical) {
      insertAlias.run(LEGACY_ALIAS_TYPE, key, existingCanonical.id, at);
      return resolveShow(key);
    }
    const id = stableShowIdForAlias(key);
    insertShow.run(id, key, at, at);
    const canonical = showByCanonicalKey.get(key);
    if (!canonical) throw new Error("Canonical show identity could not be allocated");
    insertAlias.run(LEGACY_ALIAS_TYPE, key, canonical.id, at);
    const assigned = showByAlias.get(LEGACY_ALIAS_TYPE, key);
    if (!assigned) throw new Error("Canonical show alias could not be allocated");
    return resolveShow(key);
  }

  function aliasKeys(show, requestedKey) {
    const requested = normalizeStableShowId(requestedKey) ? null : normalizeShowAliasKey(requestedKey);
    const keys = [...(show?.aliases || []), requested];
    const canonicalKey = normalizeShowAliasKey(show?.canonicalKey);
    if (canonicalKey) {
      const shadowingAlias = showByAlias.get(LEGACY_ALIAS_TYPE, canonicalKey);
      if (!shadowingAlias || shadowingAlias.id === show.id) keys.push(canonicalKey);
    }
    return [...new Set(keys.filter(Boolean))];
  }

  function keyResolvesToShow(value, showId) {
    if (!showId) return false;
    const resolved = resolveShow(value);
    return resolved?.id === showId;
  }

  function legacyKeyForShow(show, requestedKey) {
    const requested = normalizeStableShowId(requestedKey) ? null : normalizeShowAliasKey(requestedKey);
    if (requested && keyResolvesToShow(requested, show?.id)) return requested;
    for (const alias of show?.aliases || []) {
      if (keyResolvesToShow(alias, show?.id)) return normalizeShowAliasKey(alias);
    }
    const canonical = normalizeShowAliasKey(show?.canonicalKey);
    return canonical && keyResolvesToShow(canonical, show?.id) ? canonical : null;
  }

  function preferredLegacyKey(row) {
    for (const candidate of [row.legacy_concert_key, row.fallback_legacy_key, row.canonical_key]) {
      const key = normalizeShowAliasKey(candidate);
      if (key && keyResolvesToShow(key, row.show_id)) return key;
    }
    return null;
  }

  function deleteLegacyAttendance(userId, aliases) {
    if (!aliases.length) return;
    database.prepare(`DELETE FROM going WHERE user_id=? AND concert_key IN (${placeholders(aliases)})`)
      .run(userId, ...aliases);
  }

  function ownAttendance(userId, value) {
    const show = resolveShow(value);
    if (!show) return { show: null, attendance: null };
    const canonical = show.persisted ? attendanceByUserShow.get(userId, show.id) : null;
    if (canonical) {
      return {
        show,
        attendance: {
          state: canonical.state,
          visibility: canonical.visibility,
          createdAt: canonical.created_at,
          updatedAt: canonical.updated_at,
          checkedInAt: canonical.checked_in_at || null,
          verified: !!canonical.attendance_verified,
        },
      };
    }
    const aliases = aliasKeys(show, value);
    const legacy = database.prepare(`SELECT artist,venue,city,date,created_at FROM going
      WHERE user_id=? AND concert_key IN (${placeholders(aliases)})
      ORDER BY created_at DESC LIMIT 1`).get(userId, ...aliases);
    return {
      show,
      attendance: legacy ? {
        state: "going",
        visibility: "members",
        createdAt: legacy.created_at,
        updatedAt: legacy.created_at,
        checkedInAt: null,
        verified: false,
        legacy: true,
        snapshot: {
          artist: legacy.artist || "",
          artistKey: null,
          venue: legacy.venue || "",
          venueKey: null,
          city: legacy.city || "",
          date: legacy.date || "",
          tour: null,
        },
      } : null,
    };
  }

  function writeAttendance({ userId, key, state, visibility, artist, artistKey, venue, venueKey, city, date, tour, at }) {
    if (!state) {
      const existing = ownAttendance(userId, key);
      const show = existing.show;
      const aliases = aliasKeys(show, key);
      deleteLegacyAttendance(userId, aliases);
      if (show?.persisted) deleteAttendance.run(show.id, userId);
      return { show, attendance: null, previous: existing.attendance };
    }
    const existing = ownAttendance(userId, key);
    const show = ensureShow({ key, at });
    if (!show) return { show: null, attendance: null, previous: existing.attendance };
    const aliases = aliasKeys(show, key);
    const legacyKey = legacyKeyForShow(show, key);
    const previous = attendanceByUserShow.get(userId, show.id);
    const legacySnapshot = existing.attendance?.legacy ? existing.attendance.snapshot : null;
    const createdAt = previous?.created_at ?? existing.attendance?.createdAt ?? at;
    const snapshot = {
      artist: artist || previous?.legacy_artist || legacySnapshot?.artist || "",
      artistKey: artistKey || previous?.legacy_artist_key || legacySnapshot?.artistKey || null,
      venue: venue || previous?.legacy_venue || legacySnapshot?.venue || "",
      venueKey: venueKey || previous?.legacy_venue_key || legacySnapshot?.venueKey || null,
      city: city || previous?.legacy_city || legacySnapshot?.city || "",
      date: date || previous?.legacy_date || legacySnapshot?.date || "",
      tour: tour || previous?.legacy_tour || legacySnapshot?.tour || null,
    };
    if (previous?.state === state && previous?.visibility === visibility) {
      // Rows created before legacy_concert_key was added claim the exact alias
      // the current client used without changing attendance ordering/timestamps.
      // Never replace a previously claimed preference implicitly.
      if (legacyKey) claimLegacyConcertKey.run(legacyKey, show.id, userId);
      if (state === "going" && visibility === "members" && legacyKey) {
        insertLegacyGoing.run(userId, legacyKey, snapshot.artist,
          snapshot.venue, snapshot.city, snapshot.date, previous.created_at);
      } else {
        deleteLegacyAttendance(userId, aliases);
      }
      return { show, attendance: ownAttendance(userId, key).attendance, previous };
    }
    deleteLegacyAttendance(userId, aliases);
    const checkedInAt = state === "here"
      ? (previous?.state === "here" ? (previous.checked_in_at ?? at) : at)
      : null;
    upsertAttendance.run(show.id, userId, state, visibility, checkedInAt,
      legacyKey, snapshot.artist, snapshot.artistKey, snapshot.venue, snapshot.venueKey,
      snapshot.city, snapshot.date, snapshot.tour, createdAt, at);
    // Only member-visible Going has the exact semantics old binaries understand.
    // Here, Went, Interested, and narrower audiences remain canonical-only.
    if (state === "going" && visibility === "members" && legacyKey) {
      insertLegacyGoing.run(userId, legacyKey, snapshot.artist,
        snapshot.venue, snapshot.city, snapshot.date, createdAt);
    }
    return { show, attendance: ownAttendance(userId, key).attendance, previous };
  }

  function listForUser(userId) {
    const canonicalRows = database.prepare(`SELECT a.*,s.canonical_key,
      (SELECT sa.alias_value FROM show_aliases sa
        WHERE sa.show_id=s.id AND sa.alias_type='legacy_concert_key'
        ORDER BY sa.alias_value LIMIT 1) AS fallback_legacy_key,
      s.artist AS canonical_artist,s.artist_key AS canonical_artist_key,
      s.venue AS canonical_venue,s.venue_key AS canonical_venue_key,
      s.city AS canonical_city,s.date AS canonical_date,s.tour AS canonical_tour,
      EXISTS (SELECT 1 FROM show_attendance_verifications v
        WHERE v.show_id=a.show_id AND v.user_id=a.user_id AND v.revoked_at IS NULL) AS attendance_verified
      FROM show_attendance a JOIN shows s ON s.id=a.show_id
      WHERE a.user_id=? ORDER BY a.updated_at DESC,s.id`).all(userId);
    const byShow = new Map(canonicalRows.map((row) => [row.show_id, {
      showId: row.show_id,
      // Alias-first resolution is repeated at read time because a provider
      // alias added later can legitimately shadow a stored canonical value.
      // Never hand old clients a key that now identifies a different Show.
      key: preferredLegacyKey(row),
      canonicalKey: row.canonical_key,
      artist: row.legacy_artist || row.canonical_artist || "",
      artistKey: row.legacy_artist_key || row.canonical_artist_key || null,
      venue: row.legacy_venue || row.canonical_venue || "",
      venueKey: row.legacy_venue_key || row.canonical_venue_key || null,
      city: row.legacy_city || row.canonical_city || "",
      date: row.legacy_date || row.canonical_date || "",
      tour: row.legacy_tour || row.canonical_tour || null,
      state: row.state,
      visibility: row.visibility,
      verified: !!row.attendance_verified,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      checkedInAt: row.checked_in_at || null,
    }]));
    const legacyRows = database.prepare(`WITH resolved_going AS (
      SELECT g.*,
        COALESCE(
          (SELECT a.show_id FROM show_aliases a
            WHERE a.alias_type='legacy_concert_key'
              AND a.alias_value=g.concert_key COLLATE NOCASE),
          (SELECT s.id FROM shows s
            WHERE s.canonical_key=g.concert_key COLLATE NOCASE)
        ) AS show_id
      FROM going g WHERE g.user_id=?
    )
    SELECT rg.*,s.canonical_key AS resolved_key
    FROM resolved_going rg LEFT JOIN shows s ON s.id=rg.show_id
    ORDER BY rg.created_at DESC,rg.concert_key`).all(userId);
    for (const row of legacyRows) {
      const showId = row.show_id || stableShowIdForAlias(row.concert_key);
      if (byShow.has(showId)) continue;
      byShow.set(showId, {
        showId,
        key: normalizeShowAliasKey(row.concert_key),
        canonicalKey: normalizeShowAliasKey(row.resolved_key) || null,
        artist: row.artist || "",
        artistKey: null,
        venue: row.venue || "",
        venueKey: null,
        city: row.city || "",
        date: row.date || "",
        tour: null,
        state: "going",
        visibility: "members",
        verified: false,
        createdAt: row.created_at,
        updatedAt: row.created_at,
        checkedInAt: null,
        legacy: true,
      });
    }
    return [...byShow.values()].sort((left, right) =>
      (right.updatedAt - left.updatedAt) || right.showId.localeCompare(left.showId));
  }

  function crowdCte({ show, requestedKey, viewerId, scope, activeAt }) {
    const aliases = aliasKeys(show, requestedKey);
    const args = [show.id, show.id, ...aliases, show.id, activeAt];
    const filters = [];
    if (viewerId) {
      filters.push(`NOT EXISTS (SELECT 1 FROM blocks b WHERE
        (b.blocker_id=? AND b.blocked_id=c.user_id)
        OR (b.blocker_id=c.user_id AND b.blocked_id=?))`);
      args.push(viewerId, viewerId);
      filters.push(`(c.user_id=? OR c.visibility='members'
        OR (c.visibility='followers' AND EXISTS (
          SELECT 1 FROM follows vf WHERE vf.follower_id=? AND vf.followee_id=c.user_id)))`);
      args.push(viewerId, viewerId);
      if (scope === "following") {
        filters.push("EXISTS (SELECT 1 FROM follows sf WHERE sf.follower_id=? AND sf.followee_id=c.user_id)");
        args.push(viewerId);
      } else if (scope === "friends") {
        filters.push(`EXISTS (SELECT 1 FROM follows sf WHERE sf.follower_id=? AND sf.followee_id=c.user_id)
          AND EXISTS (SELECT 1 FROM follows sr WHERE sr.follower_id=c.user_id AND sr.followee_id=?)`);
        args.push(viewerId, viewerId);
      }
    } else {
      // Logged-out pages retain aggregate social proof for member-visible rows,
      // but never receive attendee identities or follower/private counts.
      filters.push("c.visibility='members'");
      if (scope !== "everyone") filters.push("0");
    }
    return {
      sql: `WITH crowd AS (
        SELECT a.user_id,a.state,a.visibility,a.created_at,a.updated_at,a.show_id
        FROM show_attendance a WHERE a.show_id=?
        UNION ALL
        SELECT g.user_id,'going' AS state,'members' AS visibility,
          MIN(g.created_at) AS created_at,MAX(g.created_at) AS updated_at,? AS show_id
        FROM going g
        WHERE g.concert_key IN (${placeholders(aliases)})
          AND NOT EXISTS (SELECT 1 FROM show_attendance ca
            WHERE ca.show_id=? AND ca.user_id=g.user_id)
        GROUP BY g.user_id
      ), eligible AS (
        SELECT c.*,
          EXISTS (SELECT 1 FROM show_attendance_verifications v
            WHERE v.show_id=c.show_id AND v.user_id=c.user_id AND v.revoked_at IS NULL)
            AS attendance_verified
        FROM crowd c JOIN users u ON u.id=c.user_id
        WHERE COALESCE(u.email_verified_at,0)>0
          AND u.is_banned=0 AND (u.suspended_until IS NULL OR u.suspended_until<=?)
          AND ${filters.join(" AND ")}
      )`,
      args,
    };
  }

  function crowdSnapshot({ key, viewerId = null, scope = "everyone", activeAt, cursor = null, limit }) {
    const show = resolveShow(key);
    if (!show) return null;
    const cte = crowdCte({ show, requestedKey: key, viewerId, scope, activeAt });
    const counts = database.prepare(`${cte.sql}
      SELECT state,COUNT(*) AS count,
        SUM(CASE WHEN attendance_verified THEN 1 ELSE 0 END) AS verified_count
      FROM eligible GROUP BY state`).all(...cte.args);
    const stateCounts = { interested: 0, going: 0, here: 0, went: 0 };
    let verifiedAttendeeCount = 0;
    for (const row of counts) {
      if (Object.hasOwn(stateCounts, row.state)) stateCounts[row.state] = row.count;
      if (isAttendeeState(row.state)) verifiedAttendeeCount += row.verified_count || 0;
    }
    const total = stateCounts.going + stateCounts.here + stateCounts.went;
    let rows = [];
    if (viewerId) {
      const cursorSql = cursor
        ? "AND (updated_at < ? OR (updated_at = ? AND user_id < ?))"
        : "";
      const pageArgs = [...cte.args];
      if (cursor) pageArgs.push(cursor.createdAt, cursor.createdAt, cursor.id);
      pageArgs.push(limit + 1);
      rows = database.prepare(`${cte.sql}
        SELECT user_id AS id,state,visibility,attendance_verified,
          updated_at AS created_at
        FROM eligible WHERE state IN ${ATTENDEE_STATES_SQL} ${cursorSql}
        ORDER BY updated_at DESC,user_id DESC LIMIT ?`).all(...pageArgs);
    }
    return {
      show,
      rows,
      stateCounts,
      total,
      verifiedAttendeeCount,
      viewerAttendance: viewerId ? ownAttendance(viewerId, key).attendance : null,
    };
  }

  return Object.freeze({
    checkInAvailable: (key, at) => showCheckInAvailable(resolveShow(key), at),
    crowdSnapshot,
    ensureShow,
    hasAttendeeAccess: (userId, key) => isAttendeeState(ownAttendance(userId, key).attendance?.state),
    listForUser,
    ownAttendance,
    resolveShow,
    writeAttendance,
  });

}
