// Directional inbox acceptance is independent of read position and message
// retention. It never grants permission to send: the existing age/contact/block
// checks remain authoritative for every new message.
export function ensureDirectMessageConsentSchema(db, at = Date.now()) {
  const existed = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='dm_acceptances'").get();
  db.exec(`CREATE TABLE IF NOT EXISTS dm_acceptances (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    other_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted_at INTEGER NOT NULL CHECK(accepted_at >= 0),
    source TEXT NOT NULL CHECK(source IN ('sent','follow','explicit')),
    PRIMARY KEY(user_id,other_id),
    CHECK(user_id <> other_id)
  )`);
  // Called under the database migration's writer transaction. Backfill only
  // choices the viewer already made: sending to this person, or following them
  // while an actual conversation exists. Receiving alone never implies consent.
  if (!existed) {
    db.exec(`INSERT OR IGNORE INTO dm_acceptances (user_id,other_id,accepted_at,source)
      SELECT from_id,to_id,MAX(0,MIN(created_at)),'sent' FROM dms
      WHERE from_id<>to_id GROUP BY from_id,to_id`);
    db.prepare(`INSERT OR IGNORE INTO dm_acceptances (user_id,other_id,accepted_at,source)
      SELECT f.follower_id,f.followee_id,?,'follow' FROM follows f
      WHERE f.follower_id<>f.followee_id AND EXISTS (
        SELECT 1 FROM dms d WHERE (d.from_id=f.follower_id AND d.to_id=f.followee_id)
          OR (d.from_id=f.followee_id AND d.to_id=f.follower_id)
      )`).run(at);
  }
  // Database triggers also cover writes by an older process during a rolling
  // release. The acceptance and its evidence commit or roll back together.
  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_dm_acceptance_on_send
    AFTER INSERT ON dms WHEN NEW.from_id<>NEW.to_id
    BEGIN
      INSERT OR IGNORE INTO dm_acceptances (user_id,other_id,accepted_at,source)
        VALUES (NEW.from_id,NEW.to_id,MAX(0,NEW.created_at),'sent');
      INSERT OR IGNORE INTO dm_acceptances (user_id,other_id,accepted_at,source)
        SELECT NEW.to_id,NEW.from_id,MAX(0,NEW.created_at),'follow'
        WHERE EXISTS (SELECT 1 FROM follows WHERE follower_id=NEW.to_id AND followee_id=NEW.from_id);
    END;
    CREATE TRIGGER IF NOT EXISTS trg_dm_acceptance_on_follow
    AFTER INSERT ON follows WHEN NEW.follower_id<>NEW.followee_id
    BEGIN
      INSERT OR IGNORE INTO dm_acceptances (user_id,other_id,accepted_at,source)
        SELECT NEW.follower_id,NEW.followee_id,CAST(strftime('%s','now') AS INTEGER)*1000,'follow'
        WHERE EXISTS (SELECT 1 FROM dms WHERE
          (from_id=NEW.follower_id AND to_id=NEW.followee_id)
          OR (from_id=NEW.followee_id AND to_id=NEW.follower_id));
    END`);
}

export function directMessageConsentProjection(db, userId) {
  const accepted = new Set(db.prepare("SELECT other_id FROM dm_acceptances WHERE user_id=?").all(userId).map(row => row.other_id));
  const inbound = new Set(db.prepare("SELECT DISTINCT from_id FROM dms WHERE to_id=? AND removed=0").all(userId).map(row => row.from_id));
  return {
    forOther(otherId) {
      return { requestState: accepted.has(otherId) ? "accepted" : inbound.has(otherId) ? "pending" : "none" };
    },
  };
}

export function directMessageConsentFor(db, userId, otherId) {
  if (db.prepare("SELECT 1 FROM dm_acceptances WHERE user_id=? AND other_id=?").get(userId, otherId)) {
    return { requestState: "accepted" };
  }
  const inbound = db.prepare("SELECT 1 FROM dms WHERE from_id=? AND to_id=? AND removed=0 LIMIT 1").get(otherId, userId);
  return { requestState: inbound ? "pending" : "none" };
}

export function directMessageConsentRoutes({ database, requireUser, userById, blockedEitherWay, atomicWrite, limit, now, mayStartDirectMessage, ApiError }) {
  return {
    "POST /api/dms/:otherId/accept": (ctx) => {
      requireUser(ctx);
      limit(ctx, "dm-accept", 60, 10 * 60 * 1000);
      return atomicWrite(() => {
        const user = requireUser(ctx);
        const otherId = ctx.params.otherId;
        if (otherId === user.id) throw new ApiError(400, "You can't accept your own message.", "VALIDATION_FAILED");
        const other = userById.get(otherId);
        if (!other) throw new ApiError(404, "This conversation isn't available.", "NOT_FOUND");
        if (blockedEitherWay(user.id, otherId)) throw new ApiError(403, "This conversation isn't available.", "FORBIDDEN");
        const inbound = database.prepare("SELECT 1 FROM dms WHERE from_id=? AND to_id=? AND removed=0 LIMIT 1").get(otherId, user.id);
        if (!inbound) throw new ApiError(404, "There isn't a message request to accept.", "NOT_FOUND");
        // Acceptance is not a way around the existing reply restrictions. In
        // particular, unknown/teen age bands still require the same safeguards.
        const permission = mayStartDirectMessage({
          conversationExists: true,
          recipientPolicy: other.dm_policy,
          senderAgeBand: user.age_band,
          recipientAgeBand: other.age_band,
          senderFollowsRecipient: !!database.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(user.id, otherId),
          recipientFollowsSender: !!database.prepare("SELECT 1 FROM follows WHERE follower_id=? AND followee_id=?").get(otherId, user.id),
        });
        if (!permission.allowed) throw new ApiError(403, "This conversation can't be accepted right now.", "CONTACT_NOT_ALLOWED");
        database.prepare(`INSERT OR IGNORE INTO dm_acceptances (user_id,other_id,accepted_at,source)
          VALUES (?,?,?,'explicit')`).run(user.id, otherId, now());
        return { ok: true, requestState: "accepted" };
      });
    },
  };
}
