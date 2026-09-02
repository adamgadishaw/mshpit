const MAX_PEERS = 200;

const cleanText = (value, max = 160) => typeof value === "string"
  ? value.replace(/[\u0000-\u001f\u007f]/gu, "").replace(/\s+/gu, " ").trim().slice(0, max)
  : "";

const validIsoDate = (value) => {
  const date = cleanText(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) return null;
  const [, year, month, day] = match.map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day ? date : null;
};

const peerIdsForRead = (viewerId, values) => [...new Set((Array.isArray(values) ? values : [])
  .map((value) => cleanText(value, 200))
  .filter((value) => value && value !== viewerId))].slice(0, MAX_PEERS);

const showIdentity = (show) => [show.artist, show.venue, show.date]
  .map((value) => cleanText(value).normalize("NFKC").toLocaleLowerCase("en-US"))
  .join("\u0000");

const publicShow = (row, source) => {
  const artist = cleanText(row?.artist);
  const venue = cleanText(row?.venue);
  const date = validIsoDate(row?.date);
  if (!artist || !venue || !date) return null;
  return {
    ...(cleanText(row?.show_id, 200) ? { showId: cleanText(row.show_id, 200) } : {}),
    artist,
    venue,
    city: cleanText(row?.city, 120) || null,
    date,
    source,
  };
};

function preferSharedShow(current, candidate) {
  if (!candidate) return current || null;
  if (!current) return candidate;
  if (candidate.date !== current.date) return candidate.date > current.date ? candidate : current;
  if (candidate.source !== current.source) return candidate.source === "visible_attendance" ? candidate : current;
  return showIdentity(candidate).localeCompare(showIdentity(current)) < 0 ? candidate : current;
}

export function createMessageRelationshipContextService(database) {
  if (!database?.prepare) throw new TypeError("Message relationship context requires a database");

  const peerRelationships = database.prepare(`SELECT peer.id,peer.role,
      EXISTS (SELECT 1 FROM follows mine
        WHERE mine.follower_id=@viewerId AND mine.followee_id=peer.id) AS viewer_follows,
      EXISTS (SELECT 1 FROM follows theirs
        WHERE theirs.follower_id=peer.id AND theirs.followee_id=@viewerId) AS peer_follows,
      CASE WHEN COALESCE(viewer.email_verified_at,0)>0
        AND viewer.is_banned=0
        AND (viewer.suspended_until IS NULL OR viewer.suspended_until<=@activeAt)
        THEN 1 ELSE 0 END AS viewer_can_read_attendance
    FROM users peer JOIN users viewer ON viewer.id=@viewerId
    WHERE peer.id IN (SELECT value FROM json_each(@peerIds))
      AND peer.id<>@viewerId
      AND viewer.is_banned=0
      AND (viewer.suspended_until IS NULL OR viewer.suspended_until<=@activeAt)
      AND peer.is_banned=0
      AND (peer.suspended_until IS NULL OR peer.suspended_until<=@activeAt)
      AND NOT EXISTS (SELECT 1 FROM blocks blocked WHERE
        (blocked.blocker_id=@viewerId AND blocked.blocked_id=peer.id)
        OR (blocked.blocker_id=peer.id AND blocked.blocked_id=@viewerId))
    ORDER BY peer.id`);

  const concertBuddies = database.prepare(`SELECT DISTINCT
      CASE WHEN tags.author_id=@viewerId THEN tags.user_id ELSE tags.author_id END AS peer_id
    FROM post_user_tags tags JOIN posts post
      ON post.id=tags.post_id AND post.user_id=tags.author_id
    WHERE post.removed=0
      AND COALESCE(post.kind,'review')='review'
      AND COALESCE(post.experience_type,'in_person')='in_person'
      AND TRIM(COALESCE(post.artist,''))<>''
      AND TRIM(COALESCE(post.venue,''))<>''
      AND TRIM(COALESCE(post.date,''))<>''
      AND ((tags.author_id=@viewerId AND tags.user_id IN (SELECT value FROM json_each(@peerIds)))
        OR (tags.user_id=@viewerId AND tags.author_id IN (SELECT value FROM json_each(@peerIds))))`);

  const visibleSharedAttendance = database.prepare(`WITH ranked AS (
      SELECT peer.user_id AS peer_id,shows.id AS show_id,
        COALESCE(NULLIF(peer.legacy_artist,''),NULLIF(shows.artist,''),'') AS artist,
        COALESCE(NULLIF(peer.legacy_venue,''),NULLIF(shows.venue,''),'') AS venue,
        COALESCE(NULLIF(peer.legacy_city,''),NULLIF(shows.city,''),'') AS city,
        COALESCE(NULLIF(peer.legacy_date,''),NULLIF(shows.date,''),'') AS date,
        ROW_NUMBER() OVER (PARTITION BY peer.user_id ORDER BY
          COALESCE(NULLIF(peer.legacy_date,''),NULLIF(shows.date,''),'') DESC,
          peer.updated_at DESC,shows.id) AS row_number
      FROM show_attendance mine
      JOIN show_attendance peer ON peer.show_id=mine.show_id AND peer.user_id<>mine.user_id
      JOIN shows ON shows.id=peer.show_id
      WHERE mine.user_id=@viewerId
        AND mine.state IN ('going','here','went')
        AND peer.state IN ('going','here','went')
        AND peer.user_id IN (SELECT value FROM json_each(@peerIds))
        AND (peer.visibility='members' OR (peer.visibility='followers' AND EXISTS (
          SELECT 1 FROM follows visible_follow
          WHERE visible_follow.follower_id=@viewerId AND visible_follow.followee_id=peer.user_id)))
    ) SELECT peer_id,show_id,artist,venue,city,date FROM ranked WHERE row_number<=5`);

  const publicReviewSharedShows = database.prepare(`WITH mine AS (
      SELECT COALESCE(NULLIF(TRIM(artist_key),''),LOWER(TRIM(artist))) AS artist_identity,
        NULLIF(TRIM(venue_key),'') AS venue_key_identity,
        LOWER(TRIM(venue)) AS venue_name_identity,
        LOWER(TRIM(city)) AS city_identity,
        date,artist,venue,city
      FROM posts
      WHERE user_id=@viewerId AND removed=0
        AND COALESCE(kind,'review')='review'
        AND COALESCE(experience_type,'in_person')='in_person'
        AND TRIM(COALESCE(artist,''))<>''
        AND TRIM(COALESCE(venue,''))<>''
        AND TRIM(COALESCE(date,''))<>''
    ), ranked AS (
      SELECT peer.user_id AS peer_id,
        COALESCE(NULLIF(peer.artist,''),mine.artist) AS artist,
        COALESCE(NULLIF(peer.venue,''),mine.venue) AS venue,
        COALESCE(NULLIF(peer.city,''),mine.city) AS city,
        peer.date,
        ROW_NUMBER() OVER (PARTITION BY peer.user_id ORDER BY peer.date DESC,peer.created_at DESC,peer.id) AS row_number
      FROM mine JOIN posts peer
        ON COALESCE(NULLIF(TRIM(peer.artist_key),''),LOWER(TRIM(peer.artist)))=mine.artist_identity
        AND peer.date=mine.date
        AND (
          (mine.venue_key_identity IS NOT NULL
            AND NULLIF(TRIM(peer.venue_key),'')=mine.venue_key_identity)
          OR (mine.venue_key_identity IS NULL
            AND NULLIF(TRIM(peer.venue_key),'') IS NULL
            AND LOWER(TRIM(peer.venue))=mine.venue_name_identity
            AND mine.city_identity<>''
            AND LOWER(TRIM(peer.city))=mine.city_identity)
        )
      WHERE peer.user_id IN (SELECT value FROM json_each(@peerIds))
        AND peer.removed=0
        AND COALESCE(peer.kind,'review')='review'
        AND COALESCE(peer.experience_type,'in_person')='in_person'
        AND TRIM(COALESCE(peer.artist,''))<>''
        AND TRIM(COALESCE(peer.venue,''))<>''
        AND TRIM(COALESCE(peer.date,''))<>''
    ) SELECT peer_id,artist,venue,city,date FROM ranked WHERE row_number<=5`);

  function forPeers(viewerIdValue, peerIdValues, { activeAt = Date.now() } = {}) {
    const viewerId = cleanText(viewerIdValue, 200);
    const requestedPeerIds = peerIdsForRead(viewerId, peerIdValues);
    if (!viewerId || !requestedPeerIds.length) return new Map();
    const params = {
      viewerId,
      peerIds: JSON.stringify(requestedPeerIds),
    };
    const relationshipRows = peerRelationships.all({
      ...params,
      activeAt: Number.isFinite(Number(activeAt)) ? Number(activeAt) : Date.now(),
    });
    const contexts = new Map(relationshipRows.map((row) => {
      const following = !!row.viewer_follows;
      const followsYou = !!row.peer_follows;
      return [row.id, {
        artist: String(row.role || "").toLowerCase() === "artist",
        friend: following && followsYou,
        following,
        followsYou,
        concertBuddy: false,
        sharedShow: null,
      }];
    }));
    if (!contexts.size) return contexts;
    const eligiblePeerIds = JSON.stringify([...contexts.keys()]);
    const eligibleParams = { ...params, peerIds: eligiblePeerIds };

    for (const row of concertBuddies.all(eligibleParams)) {
      const context = contexts.get(row.peer_id);
      if (context) context.concertBuddy = true;
    }

    const viewerCanReadAttendance = relationshipRows.some((row) => !!row.viewer_can_read_attendance);
    if (viewerCanReadAttendance) {
      for (const row of visibleSharedAttendance.all(eligibleParams)) {
        const context = contexts.get(row.peer_id);
        if (context) context.sharedShow = preferSharedShow(context.sharedShow, publicShow(row, "visible_attendance"));
      }
    }
    for (const row of publicReviewSharedShows.all(eligibleParams)) {
      const context = contexts.get(row.peer_id);
      if (context) context.sharedShow = preferSharedShow(context.sharedShow, publicShow(row, "public_reviews"));
    }
    return contexts;
  }

  return Object.freeze({
    forPair(viewerId, peerId, options) {
      return forPeers(viewerId, [peerId], options).get(peerId) || null;
    },
    forPeers,
  });
}
