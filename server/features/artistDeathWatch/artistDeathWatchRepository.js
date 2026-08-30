const CANDIDATE_COLUMNS = `artist_key,artist_mbid,wikidata_id,artist_name,death_date,status,
  first_detected_at,last_confirmed_at,reviewed_by,reviewed_at,review_history,created_at,updated_at`;

function priorReviews(row) {
  try {
    const value = JSON.parse(row?.review_history || "[]");
    return Array.isArray(value) ? value.slice(-19) : [];
  } catch (error) {
    throw new Error("Artist death candidate review history is invalid", { cause: error });
  }
}

export function createArtistDeathWatchRepository(database) {
  if (!database?.prepare || typeof database.exec !== "function") {
    throw new TypeError("Artist death watch requires a database");
  }

  const settings = database.prepare(`SELECT singleton,enabled,cursor_artist_key,last_scan_at,
    last_success_at,next_scan_at,last_error_code,updated_at
    FROM artist_death_watch_settings WHERE singleton=1`);
  const updateEnabled = database.prepare(`UPDATE artist_death_watch_settings
    SET enabled=?,updated_at=? WHERE singleton=1`);
  const updateScan = database.prepare(`UPDATE artist_death_watch_settings SET
    cursor_artist_key=?,last_scan_at=?,last_success_at=?,next_scan_at=?,last_error_code=?,updated_at=?
    WHERE singleton=1`);
  const eligibleAfter = database.prepare(`SELECT norm AS artist_key,name AS artist_name,
      lower(mbid) AS artist_mbid
    FROM artists
    WHERE norm>? AND mbid IS NOT NULL
      AND (SELECT COUNT(*) FROM artists same_identity
        WHERE lower(same_identity.mbid)=lower(artists.mbid))=1
      AND NOT EXISTS (
        SELECT 1 FROM artist_memorials memorial
        WHERE memorial.artist_key=artists.norm AND memorial.artist_mbid=lower(artists.mbid)
          AND memorial.status='published'
      )
    ORDER BY norm ASC LIMIT ?`);
  const eligibleCount = database.prepare(`SELECT COUNT(*) AS count FROM artists
    WHERE mbid IS NOT NULL
      AND (SELECT COUNT(*) FROM artists same_identity
        WHERE lower(same_identity.mbid)=lower(artists.mbid))=1`);
  const catalogByMbid = database.prepare(`SELECT norm AS artist_key,name AS artist_name,
      lower(mbid) AS artist_mbid
    FROM artists
    WHERE lower(mbid)=?
    ORDER BY COALESCE(popularity,0) DESC,COALESCE(rank_score,0) DESC,norm ASC LIMIT 2`);
  const byKey = database.prepare(`SELECT ${CANDIDATE_COLUMNS} FROM artist_death_candidates WHERE artist_key=?`);
  const byMbid = database.prepare(`SELECT ${CANDIDATE_COLUMNS} FROM artist_death_candidates WHERE lower(artist_mbid)=?`);
  const insertCandidate = database.prepare(`INSERT INTO artist_death_candidates
    (artist_key,artist_mbid,wikidata_id,artist_name,death_date,status,first_detected_at,
      last_confirmed_at,reviewed_by,reviewed_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'pending',?,?,NULL,NULL,?,?)`);
  const reconfirmCandidate = database.prepare(`UPDATE artist_death_candidates SET
    artist_name=?,wikidata_id=?,death_date=?,last_confirmed_at=?,updated_at=?
    WHERE artist_key=? AND lower(artist_mbid)=?`);
  const reopenDismissedCandidate = database.prepare(`UPDATE artist_death_candidates SET
    artist_name=?,wikidata_id=?,death_date=?,status='pending',last_confirmed_at=?,
    reviewed_by=NULL,reviewed_at=NULL,review_history=?,updated_at=?
    WHERE artist_key=? AND lower(artist_mbid)=? AND status='dismissed'`);
  const reconcilePublishedMemorials = database.prepare(`UPDATE artist_death_candidates AS candidate SET
    status='memorialized',reviewed_at=COALESCE(reviewed_at,last_confirmed_at),
    updated_at=MAX(updated_at,last_confirmed_at)
    WHERE status<>'memorialized' AND EXISTS (
      SELECT 1 FROM artist_memorials memorial
      WHERE memorial.artist_key=candidate.artist_key
        AND lower(memorial.artist_mbid)=lower(candidate.artist_mbid)
        AND memorial.status='published'
    )`);
  const listStatements = new Map();
  const countByStatus = database.prepare(`SELECT status,COUNT(*) AS count
    FROM artist_death_candidates GROUP BY status`);
  const reviewCandidate = database.prepare(`UPDATE artist_death_candidates SET
    status=?,reviewed_by=?,reviewed_at=?,updated_at=? WHERE artist_key=?`);
  const memorializeCandidate = database.prepare(`UPDATE artist_death_candidates SET
    status='memorialized',reviewed_by=?,reviewed_at=COALESCE(reviewed_at,?),updated_at=?
    WHERE artist_key=? AND lower(artist_mbid)=? AND status<>'memorialized'`);

  function listStatement(status) {
    const key = status || "all";
    if (listStatements.has(key)) return listStatements.get(key);
    const statement = database.prepare(`SELECT ${CANDIDATE_COLUMNS} FROM artist_death_candidates AS candidate
      WHERE ${status ? "candidate.status=? AND" : ""}
        (candidate.status='memorialized' OR NOT EXISTS (
          SELECT 1 FROM artist_memorials memorial
          WHERE memorial.artist_key=candidate.artist_key
            AND lower(memorial.artist_mbid)=lower(candidate.artist_mbid)
            AND memorial.status='published'
        ))
      ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'dismissed' THEN 1 ELSE 2 END,
        first_detected_at DESC,artist_key ASC LIMIT ?`);
    listStatements.set(key, statement);
    return statement;
  }

  return Object.freeze({
    readSettings() {
      return settings.get() || null;
    },

    setEnabled({ enabled, at }) {
      updateEnabled.run(enabled ? 1 : 0, at);
      return settings.get() || null;
    },

    recordScan({ cursorArtistKey, lastScanAt, lastSuccessAt, nextScanAt, lastErrorCode, at }) {
      updateScan.run(cursorArtistKey || null, lastScanAt ?? null, lastSuccessAt ?? null,
        nextScanAt ?? null, lastErrorCode || null, at);
      return settings.get() || null;
    },

    eligibleArtistsAfter({ cursorArtistKey = "", limit }) {
      return eligibleAfter.all(cursorArtistKey, limit);
    },

    eligibleArtistCount() {
      return Number(eligibleCount.get()?.count) || 0;
    },

    catalogArtistForSignal({ artistMbid }) {
      const rows = catalogByMbid.all(artistMbid);
      // One external identity must map to one local profile. A duplicated MBID
      // is an ambiguous ownership decision, so staff receive no candidate until
      // the catalogue identity is repaired.
      return rows.length === 1 ? rows[0] : null;
    },

    findCandidateByKey(artistKey) {
      return byKey.get(artistKey) || null;
    },

    findCandidateByMbid(artistMbid) {
      return byMbid.get(artistMbid) || null;
    },

    saveConfirmedCandidate({ artistKey, artistMbid, wikidataId, artistName, deathDate, at }) {
      const existing = byKey.get(artistKey) || byMbid.get(artistMbid) || null;
      if (existing) {
        if (existing.artist_key !== artistKey || String(existing.artist_mbid).toLowerCase() !== artistMbid) {
          return { conflict: true, row: existing };
        }
        const evidenceChanged = existing.wikidata_id !== wikidataId || existing.death_date !== deathDate;
        if (existing.status === "dismissed" && evidenceChanged) {
          const reviewHistory = priorReviews(existing);
          reviewHistory.push(Object.freeze({
            status: "dismissed",
            reviewerId: existing.reviewed_by || null,
            reviewedAt: existing.reviewed_at ?? null,
            wikidataId: existing.wikidata_id,
            deathDate: existing.death_date,
            reopenedAt: at,
          }));
          reopenDismissedCandidate.run(
            artistName, wikidataId, deathDate, at, JSON.stringify(reviewHistory), at,
            artistKey, artistMbid,
          );
          return { inserted: false, reopened: true, row: byKey.get(artistKey) || null };
        }
        reconfirmCandidate.run(artistName, wikidataId, deathDate, at, at, artistKey, artistMbid);
        return { inserted: false, reopened: false, row: byKey.get(artistKey) || null };
      }
      insertCandidate.run(artistKey, artistMbid, wikidataId, artistName, deathDate, at, at, at, at);
      return { inserted: true, reopened: false, row: byKey.get(artistKey) || null };
    },

    listCandidates({ status = null, limit = 50 } = {}) {
      reconcilePublishedMemorials.run();
      return listStatement(status).all(...(status ? [status, limit] : [limit]));
    },

    candidateCounts() {
      reconcilePublishedMemorials.run();
      return Object.fromEntries(countByStatus.all().map((row) => [row.status, Number(row.count) || 0]));
    },

    reconcilePublishedMemorials() {
      return reconcilePublishedMemorials.run().changes;
    },

    review({ artistKey, status, reviewerId, at }) {
      const changed = reviewCandidate.run(status, status === "pending" ? null : reviewerId,
        status === "pending" ? null : at, at, artistKey).changes === 1;
      return changed ? byKey.get(artistKey) || null : null;
    },

    markMemorialized({ artistKey, artistMbid, reviewerId, at }) {
      memorializeCandidate.run(reviewerId || null, at, at, artistKey, artistMbid);
      return byKey.get(artistKey) || null;
    },

    transaction(work) {
      if (typeof work !== "function") throw new TypeError("Artist death watch transactions require work");
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try { database.exec("ROLLBACK"); }
        catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Artist death watch transaction and rollback both failed");
        }
        throw error;
      }
    },
  });
}
