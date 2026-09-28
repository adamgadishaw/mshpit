// Cosmetic membership milestones only. This module never changes a role or the
// staff-reviewed identity check (`users.verified`). A confirmed inbox is not a
// verified identity, and one inbox/account is not proof of one human.
export const FIRST_WAVE_LIMIT = 1000;
const BACKFILL_KEY = "member-badges:first-wave-backfill:v1";
const statements = new WeakMap();

function write(database, work) {
  const nested = database.isTransaction;
  database.exec(nested ? "SAVEPOINT member_badges_write" : "BEGIN IMMEDIATE");
  try {
    const result = work();
    database.exec(nested ? "RELEASE member_badges_write" : "COMMIT");
    return result;
  } catch (error) {
    database.exec(nested ? "ROLLBACK TO member_badges_write; RELEASE member_badges_write" : "ROLLBACK");
    throw error;
  }
}

function queries(database) {
  let result = statements.get(database);
  if (result) return result;
  const hasNews = !!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='news_stories'").get();
  const eligible = `u.email_verified_at>0 AND u.is_banned=0 AND u.dormant_at IS NULL
    AND (u.suspended_until IS NULL OR u.suspended_until<=@at)
    AND (u.onboarding_version IS NULL OR u.onboarding_version>0)
    AND u.role IN ('fan','artist','admin','moderator')
    AND u.pass_hash LIKE 'scrypt:%'
    AND lower(u.handle) NOT IN ('news_mod','demo') AND u.id NOT GLOB 'u_demo*'
    AND u.id NOT IN ('u_artist','u_mara','u_devon','u_priya')
    AND instr(u.email,'@')>1
    AND lower(substr(u.email,instr(u.email,'@')+1)) NOT IN ('example.com','example.net','example.org','localhost')
    AND lower(u.email) NOT LIKE '%.invalid' AND lower(u.email) NOT LIKE '%.test'
    AND u.id<>@serviceId
    AND NOT EXISTS (SELECT 1 FROM app_meta m WHERE m.key='news-desk:publisher-identity:v1'
      AND json_extract(CASE WHEN json_valid(m.value) THEN m.value ELSE '{}' END,'$.userId')=u.id)
    ${hasNews ? "AND NOT EXISTS (SELECT 1 FROM posts p WHERE p.user_id=u.id AND EXISTS (SELECT 1 FROM news_stories s WHERE s.post_id=p.id))" : ""}
    AND NOT EXISTS (SELECT 1 FROM artist_profiles a WHERE a.owner_id=u.id AND a.identity_review_status IN ('pending','rejected'))`;
  result = {
    eligible: database.prepare(`SELECT u.id,(SELECT slot FROM first_wave_grants g WHERE g.user_id=u.id) AS slot
      FROM users u WHERE u.id=@id AND ${eligible}`),
    backfill: database.prepare(`SELECT u.id FROM users u WHERE ${eligible}
      AND NOT EXISTS (SELECT 1 FROM first_wave_grants g WHERE g.user_id=u.id)
      ORDER BY u.created_at,u.id LIMIT @limit`),
    held: database.prepare("SELECT slot FROM first_wave_grants WHERE user_id=?"),
    last: database.prepare("SELECT COALESCE(MAX(slot),0) AS slot FROM first_wave_grants"),
    grant: database.prepare("INSERT INTO first_wave_grants(slot,user_id,granted_at) VALUES (?,?,?)"),
  };
  statements.set(database, result);
  return result;
}

function parameters(at, env) {
  if (!Number.isSafeInteger(at) || at<=0) throw new TypeError("A valid badge timestamp is required");
  return { at, serviceId: String(env?.NEWS_DESK_ACCOUNT_ID || "").trim() };
}

export function grantFirstWaveBadge(database, userId, { at=Date.now(), env=process.env }={}) {
  if (typeof userId!=="string" || !userId) return null;
  const args = { ...parameters(at,env), id:userId };
  const q = queries(database);
  return write(database, () => {
    if (!q.eligible.get(args)) return null;
    const held = q.held.get(userId);
    if (held) return held.slot;
    const slot = q.last.get().slot+1;
    if (slot>FIRST_WAVE_LIMIT) return null;
    q.grant.run(slot,userId,at);
    return slot;
  });
}

export function backfillFirstWaveBadges(database, { at=Date.now(), env=process.env }={}) {
  const args = parameters(at,env);
  const q = queries(database);
  return write(database, () => {
    if (database.prepare("SELECT 1 FROM app_meta WHERE key=?").get(BACKFILL_KEY)) return 0;
    let slot = q.last.get().slot;
    const users = q.backfill.all({ ...args, limit:Math.max(0,FIRST_WAVE_LIMIT-slot) });
    for (const user of users) q.grant.run(++slot,user.id,at);
    database.prepare("INSERT INTO app_meta(key,value) VALUES (?,?)").run(BACKFILL_KEY,JSON.stringify({ version:1,at }));
    return users.length;
  });
}

export function ensureMemberBadgeSchema(database, options={}) {
  // SET NULL erases account linkage on deletion but permanently burns its place.
  // Immutability means cleanup/revocation cannot recycle slots or transfer them.
  database.exec(`CREATE TABLE IF NOT EXISTS first_wave_grants (
    slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 1 AND ${FIRST_WAVE_LIMIT}),
    user_id TEXT UNIQUE REFERENCES users(id) ON DELETE SET NULL,
    granted_at INTEGER NOT NULL CHECK(granted_at>0)
  );
  CREATE TRIGGER IF NOT EXISTS first_wave_grants_no_delete BEFORE DELETE ON first_wave_grants
    BEGIN SELECT RAISE(ABORT,'First Wave places cannot be recycled'); END;
  CREATE TRIGGER IF NOT EXISTS first_wave_grants_no_transfer BEFORE UPDATE ON first_wave_grants
    WHEN NEW.slot<>OLD.slot OR NEW.granted_at<>OLD.granted_at
      OR NOT (NEW.user_id IS OLD.user_id OR (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL))
    BEGIN SELECT RAISE(ABORT,'First Wave places cannot be transferred'); END;`);
  return backfillFirstWaveBadges(database,options);
}

export function memberBadgeFor(database,user,{at=Date.now(),env=process.env}={}) {
  // Read-only and authorized from the fresh stored account, not caller fields. No address,
  // confirmation timestamp, rank, or account-age metadata leaves this module.
  if (!user?.id) return null;
  const q = queries(database);
  const eligible = q.eligible.get({ ...parameters(at,env),id:user.id });
  if (!eligible) return null;
  return eligible.slot ? "first-wave" : "email-confirmed";
}
