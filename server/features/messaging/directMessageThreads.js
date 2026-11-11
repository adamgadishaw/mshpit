// Walk one peer key at a time through the existing directional indexes. DISTINCT
// still visits every historical message, even when there are only a few peers.
// The recursive range seeks skip each peer's history without inventing a second
// conversation identity or requiring writers to maintain another projection.
export const INCOMING_MESSAGE_PEERS_CTE = `incoming_peers(other_id) AS (
  SELECT MIN(from_id) FROM dms WHERE to_id=$viewer
  UNION ALL
  SELECT (SELECT MIN(from_id) FROM dms WHERE to_id=$viewer AND from_id>incoming_peers.other_id)
    FROM incoming_peers WHERE other_id IS NOT NULL
)`;

export const MESSAGE_PEERS_CTES = `${INCOMING_MESSAGE_PEERS_CTE},
  outgoing_peers(other_id) AS (
    SELECT MIN(to_id) FROM dms WHERE from_id=$viewer
    UNION ALL
    SELECT (SELECT MIN(to_id) FROM dms WHERE from_id=$viewer AND to_id>outgoing_peers.other_id)
      FROM outgoing_peers WHERE other_id IS NOT NULL
  ), message_peers AS MATERIALIZED (
    SELECT other_id FROM incoming_peers WHERE other_id IS NOT NULL
    UNION SELECT other_id FROM outgoing_peers WHERE other_id IS NOT NULL
  )`;

// Each direction contributes at most one visible row per peer. Only these two
// candidates are compared before sorting the final conversation previews. The
// created_at/id order is identical to message pagination, including tied times.
// A limit of -1 is used by the existing full-thread hydration route.
export function directMessageLatestPerPeer(database, userId, limit = 200) {
  return database.prepare(`WITH RECURSIVE ${MESSAGE_PEERS_CTES}, candidates AS MATERIALIZED (
      SELECT other_id,
        (SELECT id FROM dms WHERE from_id=$viewer AND to_id=message_peers.other_id AND removed=0
          ORDER BY created_at DESC,id DESC LIMIT 1) AS outgoing_id,
        (SELECT id FROM dms WHERE from_id=message_peers.other_id AND to_id=$viewer AND removed=0
          ORDER BY created_at DESC,id DESC LIMIT 1) AS incoming_id
      FROM message_peers
    ) SELECT d.id,d.from_id,d.to_id,d.text,d.created_at,c.other_id
    FROM candidates c JOIN dms d ON d.id=(
      SELECT id FROM dms WHERE id IN (c.outgoing_id,c.incoming_id)
      ORDER BY created_at DESC,id DESC LIMIT 1
    ) ORDER BY d.created_at DESC,d.id DESC LIMIT $limit`)
    .all({ $viewer: userId, $limit: limit });
}

// Preserve the inbox's existing global tombstone limit without visiting visible
// history. No direction can contribute more than that limit to the global top
// rows, so each indexed removed range can stop there too. The per-thread route
// still returns every removal, including those older than the inbox window.
export function directMessageInboxRemovedIds(database, userId, limit) {
  return database.prepare(`WITH RECURSIVE ${MESSAGE_PEERS_CTES}, candidates AS (
      SELECT d.id,d.created_at FROM message_peers p JOIN dms d ON d.id IN (
        SELECT id FROM dms WHERE from_id=$viewer AND to_id=p.other_id AND removed=1
          ORDER BY created_at DESC,id DESC LIMIT $limit
      )
      UNION
      SELECT d.id,d.created_at FROM message_peers p JOIN dms d ON d.id IN (
        SELECT id FROM dms WHERE from_id=p.other_id AND to_id=$viewer AND removed=1
          ORDER BY created_at DESC,id DESC LIMIT $limit
      )
    ) SELECT id FROM candidates ORDER BY created_at DESC,id DESC LIMIT $limit`)
    .all({ $viewer: userId, $limit: limit }).map(row => row.id);
}
