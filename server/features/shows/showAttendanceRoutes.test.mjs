import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { clean, cleanDate, LIMITS } from "../../validate.js";
import { createShowAttendanceRepository } from "./showAttendanceRepository.js";
import { showAttendanceRoutes } from "./showAttendanceRoutes.js";
import { ensureShowSchema } from "./showSchema.js";

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT NOT NULL,
      initials TEXT,
      avatar_uri TEXT,
      avatar_color TEXT,
      role TEXT NOT NULL DEFAULT 'fan',
      verified INTEGER NOT NULL DEFAULT 0,
      email_verified_at INTEGER NOT NULL DEFAULT 1,
      is_banned INTEGER NOT NULL DEFAULT 0,
      suspended_until INTEGER
    );
    CREATE TABLE going (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      concert_key TEXT NOT NULL,
      artist TEXT NOT NULL,
      venue TEXT NOT NULL,
      city TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id,concert_key)
    );
    CREATE TABLE follows (
      follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      followee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (follower_id,followee_id)
    );
    CREATE TABLE blocks (
      blocker_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (blocker_id,blocked_id)
    );
  `);
  ensureShowSchema(database);
  return database;
}

function addUser(database, id, { verified = true, banned = false } = {}) {
  database.prepare(`INSERT INTO users
    (id,name,handle,initials,avatar_color,email_verified_at,is_banned)
    VALUES (?,?,?,?,?,?,?)`).run(id, id, id, id.slice(0, 2).toUpperCase(), "#123456", verified ? 1 : 0, banned ? 1 : 0);
  return database.prepare("SELECT * FROM users WHERE id=?").get(id);
}

function encodeCursor(row) {
  return Buffer.from(JSON.stringify([row.created_at, row.id]), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (!value) return null;
  const [createdAt, id] = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
  return { createdAt, id };
}

function fixture() {
  const database = createDatabase();
  let clock = 2_000_000_000_000;
  let beforeAtomicWrite = null;
  const userById = database.prepare("SELECT * FROM users WHERE id=?");
  const calls = { limits: [], safety: [] };
  const routes = showAttendanceRoutes({
    database,
    ApiError,
    assertSafeAuthoredFields(fields) {
      calls.safety.push(fields);
      if (fields?.tour === "unsafe tour" || fields?.artist === "unsafe artist") {
        throw new ApiError(422, "Tour rejected.", "CONTENT_REJECTED");
      }
    },
    atomicWrite(work) {
      const before = beforeAtomicWrite;
      beforeAtomicWrite = null;
      before?.();
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = work();
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
    clean,
    cleanDate,
    decodeShowKey: (ctx) => decodeURIComponent(ctx.params.key),
    finishPage(rows, limit) {
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      return { rows: page, nextCursor: hasMore ? encodeCursor(page.at(-1)) : null };
    },
    limits: LIMITS,
    now: () => clock,
    pageRequest(ctx, defaultLimit, maxLimit) {
      const requested = Number(ctx.query?.limit);
      return {
        cursor: decodeCursor(ctx.query?.before),
        limit: Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, maxLimit) : defaultLimit,
      };
    },
    projectUser: (row) => row ? ({
      id: row.id,
      name: row.name,
      handle: row.handle,
      initials: row.initials,
      avatarUri: row.avatar_uri,
      avatarColor: row.avatar_color,
      role: row.role,
      verified: !!row.verified,
    }) : null,
    rateLimit: (...args) => calls.limits.push(args),
    requireSessionUser(ctx) {
      if (!ctx.user) throw new ApiError(401, "Sign in.", "AUTH_REQUIRED");
      return ctx.user;
    },
    requireUser(ctx) {
      if (!ctx.user) throw new ApiError(401, "Sign in.", "AUTH_REQUIRED");
      if (ctx.user.is_banned || (ctx.user.suspended_until && ctx.user.suspended_until > clock)) {
        throw new ApiError(403, "Restricted.", "FORBIDDEN");
      }
      return ctx.user;
    },
    requireVerifiedUser(ctx) {
      if (!ctx.user) throw new ApiError(401, "Sign in.", "AUTH_REQUIRED");
      if (ctx.user.is_banned || (ctx.user.suspended_until && ctx.user.suspended_until > clock)) {
        throw new ApiError(403, "Restricted.", "FORBIDDEN");
      }
      if (!ctx.user.email_verified_at) throw new ApiError(403, "Verify.", "EMAIL_VERIFICATION_REQUIRED");
      return ctx.user;
    },
    userById,
  });
  return {
    database,
    routes,
    calls,
    setBeforeAtomicWrite(work) { beforeAtomicWrite = work; },
    setNow(value) { clock = value; },
  };
}

function context(overrides = {}) {
  const headers = {};
  return {
    body: {},
    query: {},
    params: {},
    setHeader(name, value) { headers[name] = value; },
    headers,
    ...overrides,
  };
}

const show = Object.freeze({
  key: "the artist|the room|2026-08-21",
  artist: "The Artist",
  artistKey: "the artist",
  venue: "The Room",
  venueKey: "the-room-toronto",
  city: "Toronto",
  date: "2026-08-21",
  tour: "The Tour",
});

test("canonical show schema is additive, namespace-safe, indexed, and never startup-backfills going", () => {
  const database = createDatabase();
  try {
    addUser(database, "legacy");
    database.prepare(`INSERT INTO going
      (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run("legacy", show.key, show.artist, show.venue, show.city, show.date, 1);
    ensureShowSchema(database);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM show_attendance").get().count, 0);

    const repository = createShowAttendanceRepository(database);
    const first = repository.ensureShow({ ...show, at: 2 });
    const memberCreated = database.prepare("SELECT * FROM shows WHERE id=?").get(first.id);
    assert.deepEqual({
      artist: memberCreated.artist,
      artistKey: memberCreated.artist_key,
      venue: memberCreated.venue,
      venueKey: memberCreated.venue_key,
      tour: memberCreated.tour,
      identitySource: memberCreated.identity_source,
      publicEligible: memberCreated.public_eligible,
    }, {
      artist: "",
      artistKey: null,
      venue: "",
      venueKey: null,
      tour: null,
      identitySource: "member_legacy_alias",
      publicEligible: 0,
    }, "member display text and relation keys never become shared Show authority");
    database.prepare(`INSERT INTO shows
      (id,canonical_key,created_at,updated_at) VALUES ('provider-show','provider-canonical',2,2)`).run();
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at) VALUES ('provider_event',?,'provider-show',2)`).run(show.key);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM show_aliases WHERE alias_value=?").get(show.key).count, 2,
      "the same opaque value may exist safely in separate identity namespaces");
    assert.match(first.id, /^show_[a-f0-9]{64}$/);

    const existingAliasKey = "trusted-provider|room|2026-09-01";
    database.prepare(`INSERT INTO shows
      (id,canonical_key,artist,artist_key,venue,venue_key,identity_source,public_eligible,created_at,updated_at)
      VALUES ('trusted-provider-show','trusted-provider-canonical','Trusted Artist','trusted-artist',
        'Trusted Room','trusted-room','ticketmaster',1,3,3)`).run();
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at)
      VALUES ('legacy_concert_key',?,'trusted-provider-show',3)`).run(existingAliasKey);
    const showCountBefore = database.prepare("SELECT COUNT(*) count FROM shows").get().count;
    const resolved = repository.ensureShow({
      key: existingAliasKey,
      artist: "Member Rewrite",
      artistKey: "member-rewrite",
      venue: "Member Room",
      venueKey: "member-room",
      at: 4,
    });
    assert.equal(resolved.id, "trusted-provider-show");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, showCountBefore,
      "resolving an existing legacy alias cannot leave a deterministic orphan Show");
    const trusted = database.prepare("SELECT artist,artist_key,venue,venue_key FROM shows WHERE id='trusted-provider-show'").get();
    assert.deepEqual({ ...trusted }, {
      artist: "Trusted Artist",
      artist_key: "trusted-artist",
      venue: "Trusted Room",
      venue_key: "trusted-room",
    });

    const indexes = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(({ name }) => name));
    for (const name of [
      "idx_show_aliases_show",
      "idx_show_aliases_value_show",
      "idx_show_attendance_user_updated",
      "idx_show_attendance_show_state_cursor",
      "idx_show_attendance_show_visibility_state",
      "idx_show_attendance_verifications_show",
      "idx_shows_provider_identity",
    ]) assert.ok(indexes.has(name), `missing ${name}`);
    const attendanceColumns = new Set(database.prepare("PRAGMA table_info(show_attendance)").all()
      .map(({ name }) => name));
    for (const name of [
      "legacy_concert_key",
      "legacy_artist",
      "legacy_artist_key",
      "legacy_venue",
      "legacy_venue_key",
      "legacy_city",
      "legacy_date",
      "legacy_tour",
    ]) assert.ok(attendanceColumns.has(name), `missing ${name}`);
    assert.throws(() => database.prepare(`INSERT INTO show_attendance
      (show_id,user_id,state,visibility,created_at,updated_at) VALUES (?,?,?, ?,1,1)`)
      .run(first.id, "legacy", "maybe", "members"), /CHECK constraint failed/i);
  } finally {
    database.close();
  }
});

test("legacy going rows remain readable without a read-side migration or identity leak", () => {
  const { database, routes } = fixture();
  try {
    const member = addUser(database, "legacy_member");
    database.prepare(`INSERT INTO going
      (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(member.id, show.key, show.artist, show.venue, show.city, show.date, 10);

    const mineCtx = context({ user: member });
    const mine = routes["GET /api/me/going"](mineCtx);
    assert.deepEqual(mine.going, [{
      key: show.key,
      artist: show.artist,
      venue: show.venue,
      city: show.city,
      date: show.date,
    }]);
    assert.equal(mine.attendance[0].state, "going");
    assert.equal(mine.attendance[0].visibility, "members");
    assert.match(mine.attendance[0].showId, /^show_[a-f0-9]{64}$/);
    assert.equal(mineCtx.headers["Cache-Control"], "no-store");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, 0,
      "private and public reads do not write lazy identities");

    const publicResult = routes["GET /api/going/:key/attendees"](context({
      params: { key: encodeURIComponent(show.key) },
    }));
    assert.deepEqual(publicResult.attendees, []);
    assert.equal(publicResult.total, 1);
    assert.equal(publicResult.viewerGoing, false);
    assert.deepEqual(publicResult.stateCounts, { interested: 0, going: 1, here: 0, went: 0 });
    assert.equal(publicResult.verifiedAttendeeCount, 0);

    const signedIn = routes["GET /api/going/:key/attendees"](context({
      user: member,
      params: { key: encodeURIComponent(show.key) },
    }));
    assert.equal(signedIn.attendees.length, 1);
    assert.equal(signedIn.attendees[0].id, member.id);
    assert.equal(signedIn.attendees[0].state, "going");
    assert.equal(signedIn.attendees[0].verifiedAttendance, false);
  } finally {
    database.close();
  }
});

test("minimal legacy Going updates preserve the full private snapshot and original attendance time", () => {
  const { database, routes } = fixture();
  try {
    const privacyMember = addUser(database, "legacy_privacy_member");
    const desiredMember = addUser(database, "legacy_desired_member");
    const privacyKey = "legacy privacy band|legacy hall|2024-06-01";
    const desiredKey = "legacy desired band|other hall|2023-05-02";
    const insertLegacy = database.prepare(`INSERT INTO going
      (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)`);
    insertLegacy.run(privacyMember.id, privacyKey,
      "Legacy Privacy Band", "Legacy Hall", "Montreal", "2024-06-01", 101);
    insertLegacy.run(desiredMember.id, desiredKey,
      "Legacy Desired Band", "Other Hall", "Vancouver", "2023-05-02", 202);

    const privacy = routes["POST /api/going"](context({
      user: privacyMember,
      body: { key: privacyKey, visibility: "private" },
    }));
    assert.equal(privacy.attendance.visibility, "private");
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(privacyMember.id), undefined);
    const privacyRow = database.prepare(`SELECT legacy_artist,legacy_venue,legacy_city,legacy_date,created_at
      FROM show_attendance WHERE user_id=?`).get(privacyMember.id);
    assert.deepEqual({ ...privacyRow }, {
      legacy_artist: "Legacy Privacy Band",
      legacy_venue: "Legacy Hall",
      legacy_city: "Montreal",
      legacy_date: "2024-06-01",
      created_at: 101,
    });
    const privacyMine = routes["GET /api/me/going"](context({ user: privacyMember }));
    assert.deepEqual(privacyMine.going[0], {
      key: privacyKey,
      artist: "Legacy Privacy Band",
      venue: "Legacy Hall",
      city: "Montreal",
      date: "2024-06-01",
    });
    assert.equal(privacyMine.attendance[0].createdAt, 101);

    const desired = routes["POST /api/going"](context({
      user: desiredMember,
      body: { key: desiredKey, going: true },
    }));
    assert.equal(desired.attendance.state, "going");
    const desiredRow = database.prepare(`SELECT legacy_artist,legacy_venue,legacy_city,legacy_date,created_at
      FROM show_attendance WHERE user_id=?`).get(desiredMember.id);
    assert.deepEqual({ ...desiredRow }, {
      legacy_artist: "Legacy Desired Band",
      legacy_venue: "Other Hall",
      legacy_city: "Vancouver",
      legacy_date: "2023-05-02",
      created_at: 202,
    });
    const preservedLegacy = database.prepare(`SELECT artist,venue,city,date,created_at FROM going
      WHERE user_id=? AND concert_key=?`).get(desiredMember.id, desiredKey);
    assert.deepEqual({ ...preservedLegacy }, {
      artist: "Legacy Desired Band",
      venue: "Other Hall",
      city: "Vancouver",
      date: "2023-05-02",
      created_at: 202,
    });
    const desiredMine = routes["GET /api/me/going"](context({ user: desiredMember }));
    assert.equal(desiredMine.going[0].artist, "Legacy Desired Band");
    assert.equal(desiredMine.attendance[0].createdAt, 202);
  } finally {
    database.close();
  }
});

test("trusted canonical keys and legacy aliases read, de-duplicate, privatize, and delete as one Show", () => {
  const { database, routes } = fixture();
  try {
    const member = addUser(database, "alias_complete_member");
    const canonicalKey = "trusted-canonical-key";
    const legacyAlias = "trusted artist|trusted room|2026-11-01";
    database.prepare(`INSERT INTO shows
      (id,canonical_key,artist,venue,identity_source,public_eligible,created_at,updated_at)
      VALUES ('trusted-complete-show',?,'Trusted Artist','Trusted Room','ticketmaster',1,50,50)`)
      .run(canonicalKey);
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at)
      VALUES ('legacy_concert_key',?,'trusted-complete-show',50)`).run(legacyAlias);
    const insertLegacy = database.prepare(`INSERT INTO going
      (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)`);
    insertLegacy.run(member.id, legacyAlias, "Trusted Artist", "Trusted Room", "Toronto", "2026-11-01", 51);
    insertLegacy.run(member.id, canonicalKey, "Trusted Artist", "Trusted Room", "Toronto", "2026-11-01", 52);

    const crowd = routes["GET /api/going/:key/attendees"](context({
      user: member,
      params: { key: encodeURIComponent(legacyAlias) },
    }));
    assert.equal(crowd.total, 1);
    assert.equal(crowd.attendees.length, 1,
      "canonical-key and alias legacy rows de-duplicate to one attendee");
    const before = routes["GET /api/me/going"](context({ user: member }));
    assert.equal(before.going.length, 1);
    assert.equal(before.attendance.length, 1);
    assert.equal(before.attendance[0].showId, "trusted-complete-show");
    assert.equal(before.attendance[0].key, canonicalKey);

    const privatized = routes["POST /api/going"](context({
      user: member,
      body: { key: legacyAlias, visibility: "private" },
    }));
    assert.equal(privatized.attendance.visibility, "private");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM going WHERE user_id=?").get(member.id).count, 0,
      "privacy transition through an alias clears both alias and canonical legacy projections");
    const afterPrivatize = routes["GET /api/me/going"](context({ user: member }));
    assert.equal(afterPrivatize.going[0].key, legacyAlias,
      "the exact legacy projection preserves the alias current clients use for isGoing");
    assert.equal(afterPrivatize.attendance[0].key, legacyAlias);
    assert.equal(afterPrivatize.attendance[0].canonicalKey, canonicalKey);
    assert.equal(afterPrivatize.attendance[0].showId, "trusted-complete-show");
    const removed = routes["POST /api/going"](context({
      user: member,
      body: { key: legacyAlias, going: false },
    }));
    assert.equal(removed.attendance, null);
    assert.equal(database.prepare("SELECT 1 FROM show_attendance WHERE user_id=?").get(member.id), undefined);

    const shadowedCanonical = "shadowed-canonical-key";
    const primaryAlias = "primary alias|room|2025-01-01";
    database.prepare(`INSERT INTO shows
      (id,canonical_key,identity_source,created_at,updated_at)
      VALUES ('shadowed-primary',?,'ticketmaster',60,60)`).run(shadowedCanonical);
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at)
      VALUES ('legacy_concert_key',?,'shadowed-primary',60)`).run(primaryAlias);
    database.prepare(`INSERT INTO shows
      (id,canonical_key,identity_source,created_at,updated_at)
      VALUES ('shadowing-alias-owner','shadowing-owner','ticketmaster',61,61)`).run();
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at)
      VALUES ('legacy_concert_key',?,'shadowing-alias-owner',61)`).run(shadowedCanonical);
    insertLegacy.run(member.id, primaryAlias, "Primary", "Room", "Toronto", "2025-01-01", 62);
    insertLegacy.run(member.id, shadowedCanonical, "Shadowing", "Other Room", "Toronto", "2025-02-01", 63);
    routes["POST /api/going"](context({
      user: member,
      body: { key: primaryAlias, going: false },
    }));
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=? AND concert_key=?")
      .get(member.id, primaryAlias), undefined);
    assert.ok(database.prepare("SELECT 1 FROM going WHERE user_id=? AND concert_key=?")
      .get(member.id, shadowedCanonical),
    "a canonical key shadowed by another Show's legacy alias is never swept with the wrong Show");
    const afterCollision = routes["GET /api/me/going"](context({ user: member }));
    assert.equal(afterCollision.attendance.length, 1);
    assert.equal(afterCollision.attendance[0].showId, "shadowing-alias-owner");
  } finally {
    database.close();
  }
});

test("idempotent legacy-key claims preserve ordering and stale preferences never cross Show aliases", () => {
  const { database, routes } = fixture();
  try {
    const upgradingMember = addUser(database, "preferred_key_upgrade");
    const staleMember = addUser(database, "preferred_key_stale");
    const canonicalKey = "provider-upgrade-canonical";
    const aliasA = "provider upgrade|room a|2026-12-01";
    const aliasB = "provider upgrade|room b|2026-12-02";
    database.prepare(`INSERT INTO shows
      (id,canonical_key,artist,identity_source,public_eligible,created_at,updated_at)
      VALUES ('provider-upgrade-show',?,'Provider Upgrade','ticketmaster',1,70,70)`)
      .run(canonicalKey);
    const insertAlias = database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at)
      VALUES ('legacy_concert_key',?,'provider-upgrade-show',70)`);
    insertAlias.run(aliasA);
    insertAlias.run(aliasB);
    database.prepare(`INSERT INTO show_attendance
      (show_id,user_id,state,visibility,legacy_artist,created_at,updated_at)
      VALUES ('provider-upgrade-show',?,'going','members','Provider Upgrade',71,72)`)
      .run(upgradingMember.id);

    routes["POST /api/going"](context({
      user: upgradingMember,
      body: { key: aliasB, going: true },
    }));
    const claimed = database.prepare(`SELECT legacy_concert_key,created_at,updated_at
      FROM show_attendance WHERE show_id='provider-upgrade-show' AND user_id=?`)
      .get(upgradingMember.id);
    assert.deepEqual({ ...claimed }, {
      legacy_concert_key: aliasB,
      created_at: 71,
      updated_at: 72,
    }, "an upgrade claim cannot reorder an unchanged attendance relation");
    const reloaded = routes["GET /api/me/going"](context({ user: upgradingMember }));
    assert.equal(reloaded.going[0].key, aliasB);
    assert.equal(reloaded.attendance[0].canonicalKey, canonicalKey);

    database.prepare(`INSERT INTO show_attendance
      (show_id,user_id,state,visibility,legacy_concert_key,legacy_artist,created_at,updated_at)
      VALUES ('provider-upgrade-show',?,'going','private',?,'Provider Upgrade',73,73)`)
      .run(staleMember.id, canonicalKey);
    database.prepare(`INSERT INTO shows
      (id,canonical_key,identity_source,created_at,updated_at)
      VALUES ('provider-shadow-owner','provider-shadow-owner-key','ticketmaster',74,74)`).run();
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at)
      VALUES ('legacy_concert_key',?,'provider-shadow-owner',74)`).run(canonicalKey);

    const staleReload = routes["GET /api/me/going"](context({ user: staleMember }));
    assert.equal(staleReload.going[0].key, aliasA,
      "a stale saved key falls back to a safe alias owned by the attended Show");
    assert.equal(staleReload.attendance[0].showId, "provider-upgrade-show");
    assert.equal(staleReload.attendance[0].canonicalKey, canonicalKey);
  } finally {
    database.close();
  }
});

test("database projection guards stop old writers from reviving private canonical attendance", () => {
  const { database, routes } = fixture();
  try {
    const privateMember = addUser(database, "old_writer_private");
    const memberVisible = addUser(database, "old_writer_members");
    const legacyOnly = addUser(database, "old_writer_legacy");
    const canonicalOnly = addUser(database, "old_writer_canonical");
    const collisionMember = addUser(database, "old_writer_collision");
    const oldWrite = database.prepare(`INSERT INTO going
      (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(user_id,concert_key) DO UPDATE SET artist=excluded.artist,venue=excluded.venue,
        city=excluded.city,date=excluded.date`);
    const post = (user, body) => routes["POST /api/going"](context({
      user,
      body: { ...show, ...body },
    }));

    const privateGoing = post(privateMember, { state: "going", visibility: "private" });
    oldWrite.run(privateMember.id, show.key, show.artist, show.venue, show.city, show.date, 10);
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(privateMember.id), undefined,
      "an old process cannot recreate visibility-blind Going over Private Going");
    database.prepare(`UPDATE show_attendance SET state='here',visibility='private',checked_in_at=?
      WHERE show_id=? AND user_id=?`).run(11, privateGoing.showId, privateMember.id);
    oldWrite.run(privateMember.id, show.key, show.artist, show.venue, show.city, show.date, 11);
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(privateMember.id), undefined,
      "an old process cannot expose a Private Here check-in");

    const safeGoing = post(memberVisible, { state: "going", visibility: "members" });
    oldWrite.run(memberVisible.id, show.key, "Updated Artist", "Updated Venue", show.city, show.date, 12);
    assert.ok(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(memberVisible.id),
      "member-visible canonical Going remains a legitimate rolling-deploy projection");
    database.prepare("UPDATE show_attendance SET visibility='private' WHERE show_id=? AND user_id=?")
      .run(safeGoing.showId, memberVisible.id);
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(memberVisible.id), undefined,
      "a canonical privacy transition prunes an existing old projection at the database boundary");
    oldWrite.run(memberVisible.id, show.key, show.artist, show.venue, show.city, show.date, 13);
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(memberVisible.id), undefined);

    const legacyOnlyKey = "legacy only guard|room|2022-01-01";
    oldWrite.run(legacyOnly.id, legacyOnlyKey, "Legacy Only", "Room", "Ottawa", "2022-01-01", 14);
    assert.ok(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(legacyOnly.id),
      "a genuine legacy-only record remains compatible");

    const canonicalOnlyKey = "canonical-only-unsafe";
    database.prepare(`INSERT INTO shows
      (id,canonical_key,identity_source,created_at,updated_at)
      VALUES ('canonical-only-show',?,'ticketmaster',15,15)`).run(canonicalOnlyKey);
    database.prepare(`INSERT INTO show_attendance
      (show_id,user_id,state,visibility,created_at,updated_at)
      VALUES ('canonical-only-show',?,'went','private',15,15)`).run(canonicalOnly.id);
    oldWrite.run(canonicalOnly.id, canonicalOnlyKey, "Canonical", "Room", "Toronto", "2020-01-01", 15);
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(canonicalOnly.id), undefined,
      "canonical-key fallback protects a trusted Show before it receives a legacy alias");

    const collisionKey = "alias-first-collision";
    database.prepare(`INSERT INTO shows
      (id,canonical_key,identity_source,created_at,updated_at)
      VALUES ('collision-canonical',?,'ticketmaster',16,16)`).run(collisionKey);
    database.prepare(`INSERT INTO show_attendance
      (show_id,user_id,state,visibility,created_at,updated_at)
      VALUES ('collision-canonical',?,'went','private',16,16)`).run(collisionMember.id);
    oldWrite.run(collisionMember.id, collisionKey, "Collision", "Room", "Toronto", "2020-01-01", 16);
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(collisionMember.id), undefined);
    database.prepare(`INSERT INTO shows
      (id,canonical_key,identity_source,created_at,updated_at)
      VALUES ('collision-alias-target','alias-target','ticketmaster',17,17)`).run();
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at)
      VALUES ('legacy_concert_key',?,'collision-alias-target',17)`).run(collisionKey);
    database.prepare(`INSERT INTO show_attendance
      (show_id,user_id,state,visibility,created_at,updated_at)
      VALUES ('collision-alias-target',?,'going','members',17,17)`).run(collisionMember.id);
    oldWrite.run(collisionMember.id, collisionKey, "Alias Target", "Room", "Toronto", "2026-01-01", 17);
    assert.ok(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(collisionMember.id),
      "legacy alias precedence wins over a colliding canonical key exactly as the repository does");
  } finally {
    database.close();
  }
});

test("attendance removal never creates a canonical Show for an absent or legacy-only key", () => {
  const { database, routes } = fixture();
  try {
    const member = addUser(database, "removal_member");
    const remove = (key, extra = {}) => routes["POST /api/going"](context({
      user: member,
      body: { key, going: false, ...extra },
    }));

    const absent = remove("absent artist|absent room|2026-10-01");
    assert.equal(absent.going, false);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM show_aliases").get().count, 0);

    const legacyKey = "legacy only|the room|2025-01-02";
    database.prepare(`INSERT INTO going
      (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(member.id, legacyKey, "Legacy Only", "The Room", "Toronto", "2025-01-02", 10);
    const legacy = remove(legacyKey, { artist: "unsafe artist", tour: "unsafe tour" });
    assert.equal(legacy.going, false);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM going").get().count, 0);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, 0,
      "deleting a legacy-only relation must not allocate a shared Show");
  } finally {
    database.close();
  }
});

test("new Going, Interested, and Went states default private until an audience is chosen", () => {
  const { database, routes } = fixture();
  try {
    for (const state of ["going", "interested", "went"]) {
      const member = addUser(database, `private_default_${state}`);
      const result = routes["POST /api/going"](context({
        user: member,
        body: { ...show, state },
      }));
      assert.equal(result.attendance.state, state);
      assert.equal(result.attendance.visibility, "private");
    }
    assert.equal(database.prepare("SELECT COUNT(*) count FROM going").get().count, 0,
      "private attendance must not enter the visibility-blind legacy table");
  } finally {
    database.close();
  }
});

test("explicit Members Going dual-writes legacy state while richer states and check-ins remain canonical", () => {
  const { database, routes, calls, setNow } = fixture();
  try {
    const member = addUser(database, "state_member");
    const post = (body) => routes["POST /api/going"](context({ user: member, body: { ...show, ...body } }));

    const going = post({ going: true, visibility: "members" });
    assert.equal(going.going, true);
    assert.equal(going.attendance.state, "going");
    assert.equal(going.attendance.visibility, "members");
    assert.match(going.attendance.showId, /^show_[a-f0-9]{64}$/);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM going WHERE user_id=?").get(member.id).count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, 1);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM show_aliases").get().count, 1);
    const sharedShow = database.prepare(`SELECT artist,artist_key,venue,venue_key,city,date,tour,
      identity_source,public_eligible FROM shows WHERE id=?`).get(going.showId);
    assert.deepEqual({ ...sharedShow }, {
      artist: "",
      artist_key: null,
      venue: "",
      venue_key: null,
      city: "",
      date: "",
      tour: null,
      identity_source: "member_legacy_alias",
      public_eligible: 0,
    }, "authored text and relation keys remain private attendance snapshots");
    const storedSnapshot = database.prepare(`SELECT legacy_artist,legacy_artist_key,legacy_venue,
      legacy_venue_key,legacy_city,legacy_date,legacy_tour,created_at,updated_at
      FROM show_attendance WHERE user_id=?`).get(member.id);
    assert.deepEqual({
      artist: storedSnapshot.legacy_artist,
      artistKey: storedSnapshot.legacy_artist_key,
      venue: storedSnapshot.legacy_venue,
      venueKey: storedSnapshot.legacy_venue_key,
      city: storedSnapshot.legacy_city,
      date: storedSnapshot.legacy_date,
      tour: storedSnapshot.legacy_tour,
    }, {
      artist: show.artist,
      artistKey: show.artistKey,
      venue: show.venue,
      venueKey: show.venueKey,
      city: show.city,
      date: show.date,
      tour: show.tour,
    });
    assert.equal(calls.safety[0].tour, show.tour, "tour text reaches the authored-content safety gate");
    const legacyCreatedAt = database.prepare("SELECT created_at FROM going WHERE user_id=?").get(member.id).created_at;

    setNow(2_000_000_000_500);
    const identicalGoing = post({ going: true });
    const unchangedGoing = database.prepare(`SELECT created_at,updated_at FROM show_attendance
      WHERE user_id=?`).get(member.id);
    assert.deepEqual({ ...unchangedGoing }, {
      created_at: storedSnapshot.created_at,
      updated_at: storedSnapshot.updated_at,
    });
    assert.equal(identicalGoing.attendance.updatedAt, going.attendance.updatedAt);
    assert.equal(database.prepare("SELECT created_at FROM going WHERE user_id=?").get(member.id).created_at, legacyCreatedAt,
      "an identical Going command cannot reorder either attendance representation");

    setNow(2_000_000_001_000);
    assert.throws(
      () => post({ state: "here", visibility: "followers" }),
      (error) => error.status === 409 && error.code === "CHECK_IN_UNAVAILABLE",
      "an authored show key cannot manufacture a trusted live check-in window",
    );
    database.prepare(`UPDATE shows SET provider='ticketmaster',provider_event_id='trusted-event',
      start_at=?,timezone='America/Toronto',lifecycle='happening' WHERE id=?`)
      .run(2_000_000_001_000, going.showId);
    const here = post({ state: "here" });
    assert.equal(here.going, true);
    assert.equal(here.attendance.state, "here");
    assert.equal(here.attendance.visibility, "private",
      "a fresh live-presence transition requires new audience consent");
    assert.equal(here.attendance.checkedInAt, 2_000_000_001_000);
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=? AND concert_key=?").get(member.id, show.key), undefined,
      "Here never enters a visibility-blind legacy table");
    assert.equal(createShowAttendanceRepository(database).hasAttendeeAccess(member.id, show.key), true,
      "canonical Private attendance still grants current attendee-only access");
    const privateHereMine = routes["GET /api/me/going"](context({ user: member }));
    assert.deepEqual(privateHereMine.going, [], "legacy clients never mistake Here history for a Going toggle");
    assert.equal(privateHereMine.attendance[0].state, "here");

    setNow(2_000_000_001_500);
    const identicalHere = post({ state: "here" });
    assert.equal(identicalHere.attendance.checkedInAt, here.attendance.checkedInAt);
    assert.equal(identicalHere.attendance.updatedAt, here.attendance.updatedAt,
      "an identical Here command preserves both check-in time and ordering");
    setNow(2_000_000_002_000);
    const went = post({ state: "went" });
    assert.equal(went.attendance.checkedInAt, null,
      "the live Here timestamp is cleared from the social relationship outside Here");
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=? AND concert_key=?").get(member.id, show.key), undefined,
      "Private attendance never leaks through a rolling-deploy legacy reader");
    const privateMine = routes["GET /api/me/going"](context({ user: member }));
    assert.deepEqual(privateMine.going, [], "legacy Going excludes completed Went history");
    assert.equal(privateMine.attendance[0].state, "went",
      "the richer attendance projection preserves completed private history");

    const interested = post({ state: "interested", visibility: "private", verified: true });
    assert.equal(interested.going, false);
    assert.equal(interested.attendance.state, "interested");
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=? AND concert_key=?").get(member.id, show.key), undefined,
      "Interested never enters the legacy attendee table used by lounge admission");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM show_attendance_verifications").get().count, 0,
      "member input cannot self-verify attendance");

    const mine = routes["GET /api/me/going"](context({ user: member }));
    assert.deepEqual(mine.going, []);
    assert.equal(mine.attendance[0].state, "interested");
    assert.equal(mine.attendance[0].visibility, "private");

    const removed = post({ going: false });
    assert.deepEqual({ going: removed.going, attendance: removed.attendance }, { going: false, attendance: null });
    assert.equal(database.prepare("SELECT COUNT(*) count FROM show_attendance").get().count, 0);
    assert.equal(calls.limits.length, 8);
    assert.ok(calls.limits.every(([, name]) => name === "going"));
  } finally {
    database.close();
  }
});

test("stable Show-ID attendance targets the canonical night and unknown IDs never allocate", () => {
  const { database, routes } = fixture();
  try {
    const member = addUser(database, "stable_id_member");
    const targetId = `show_${"a".repeat(64)}`;
    const shadowId = `show_${"b".repeat(64)}`;
    const missingId = `show_${"c".repeat(64)}`;
    const targetAlias = "exact target|the room|2026-08-21";
    database.prepare(`INSERT INTO shows
      (id,canonical_key,artist,venue,identity_source,public_eligible,created_at,updated_at)
      VALUES (?,?,'Exact Target','The Room','ticketmaster',1,90,90)`).run(targetId, "exact-target-canonical");
    database.prepare(`INSERT INTO shows
      (id,canonical_key,artist,venue,identity_source,public_eligible,created_at,updated_at)
      VALUES (?,?,'Alias Shadow','Other Room','ticketmaster',1,91,91)`).run(shadowId, "alias-shadow-canonical");
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at) VALUES ('legacy_concert_key',?,?,90)`)
      .run(targetAlias, targetId);
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at) VALUES ('legacy_concert_key',?,?,91)`)
      .run(targetId, shadowId);

    const result = routes["POST /api/going"](context({
      user: member,
      body: { key: targetId, state: "went", artist: "Exact Target", venue: "The Room", date: "2026-08-21" },
    }));
    assert.equal(result.showId, targetId);
    assert.equal(result.attendance.state, "went");
    assert.ok(database.prepare("SELECT 1 FROM show_attendance WHERE show_id=? AND user_id=?")
      .get(targetId, member.id));
    assert.equal(database.prepare("SELECT 1 FROM show_attendance WHERE show_id=? AND user_id=?")
      .get(shadowId, member.id), undefined,
    "an alias that merely looks like the target ID cannot redirect an exact typed mutation");

    const before = database.prepare("SELECT COUNT(*) count FROM shows").get().count;
    assert.throws(
      () => routes["POST /api/going"](context({
        user: member,
        body: { key: missingId, state: "went", artist: "Missing", venue: "Nowhere" },
      })),
      (error) => error.status === 404 && error.code === "NOT_FOUND",
    );
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, before,
      "an unknown stable ID cannot reserve a catalogue row");
  } finally {
    database.close();
  }
});

test("attendance writes require verification and tour safety rejects before allocating a Show", () => {
  const { database, routes, calls } = fixture();
  try {
    const unverified = addUser(database, "unverified_writer", { verified: false });
    assert.throws(
      () => routes["POST /api/going"](context({
        user: unverified,
        body: { ...show, going: true },
      })),
      (error) => error.status === 403 && error.code === "EMAIL_VERIFICATION_REQUIRED",
    );
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, 0);

    const member = addUser(database, "safe_writer");
    assert.throws(
      () => routes["POST /api/going"](context({
        user: member,
        body: { ...show, tour: "unsafe tour", going: true },
      })),
      (error) => error.status === 422 && error.code === "CONTENT_REJECTED",
    );
    assert.equal(calls.safety.at(-1).tour, "unsafe tour");
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, 0,
      "rejected member text cannot reserve a shared identity");
  } finally {
    database.close();
  }
});

test("unverified and restricted owners can erase or privatize existing attendance but cannot add, transition, or widen it", () => {
  const { database, routes, calls, setNow } = fixture();
  try {
    const unverified = addUser(database, "privacy_unverified", { verified: false });
    const unverifiedDelete = addUser(database, "delete_unverified", { verified: false });
    const legacyKey = "privacy legacy|old room|2024-01-01";
    const deleteKey = "delete legacy|old room|2023-01-01";
    const insertLegacy = database.prepare(`INSERT INTO going
      (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)`);
    insertLegacy.run(unverified.id, legacyKey,
      "Privacy Legacy", "Old Room", "Toronto", "2024-01-01", 41);
    insertLegacy.run(unverifiedDelete.id, deleteKey,
      "Delete Legacy", "Old Room", "Ottawa", "2023-01-01", 42);

    const privatizedLegacy = routes["POST /api/going"](context({
      user: unverified,
      body: {
        key: legacyKey,
        visibility: "private",
        artist: "unsafe artist",
        tour: "unsafe tour",
      },
    }));
    assert.deepEqual({
      state: privatizedLegacy.attendance.state,
      visibility: privatizedLegacy.attendance.visibility,
      createdAt: privatizedLegacy.attendance.createdAt,
    }, { state: "going", visibility: "private", createdAt: 41 });
    const legacyCanonical = database.prepare(`SELECT state,visibility,legacy_artist,legacy_venue,
      legacy_city,legacy_date,created_at FROM show_attendance WHERE user_id=?`).get(unverified.id);
    assert.deepEqual({ ...legacyCanonical }, {
      state: "going",
      visibility: "private",
      legacy_artist: "Privacy Legacy",
      legacy_venue: "Old Room",
      legacy_city: "Toronto",
      legacy_date: "2024-01-01",
      created_at: 41,
    });
    assert.equal(calls.safety.length, 0, "privacy-only self-service ignores stale authored snapshots");
    assert.throws(
      () => routes["POST /api/going"](context({ user: unverified, body: { key: legacyKey, going: true } })),
      (error) => error.code === "EMAIL_VERIFICATION_REQUIRED",
      "an unverified account must explicitly target Private even for an unchanged state",
    );
    assert.throws(
      () => routes["POST /api/going"](context({
        user: unverified,
        body: { key: legacyKey, visibility: "followers" },
      })),
      (error) => error.code === "EMAIL_VERIFICATION_REQUIRED",
      "privacy self-service cannot widen the audience",
    );
    const showCount = database.prepare("SELECT COUNT(*) count FROM shows").get().count;
    assert.throws(
      () => routes["POST /api/going"](context({
        user: unverified,
        body: { key: "unverified new|room|2027-01-01", going: true },
      })),
      (error) => error.code === "EMAIL_VERIFICATION_REQUIRED",
    );
    assert.equal(database.prepare("SELECT COUNT(*) count FROM shows").get().count, showCount,
      "rejected unverified additions cannot allocate a Show");

    const erasedLegacy = routes["POST /api/going"](context({
      user: unverifiedDelete,
      body: { key: deleteKey, going: false, artist: "unsafe artist", tour: "unsafe tour" },
    }));
    assert.equal(erasedLegacy.attendance, null);
    assert.equal(database.prepare("SELECT 1 FROM going WHERE user_id=?").get(unverifiedDelete.id), undefined);
    const erasedCanonical = routes["POST /api/going"](context({
      user: unverified,
      body: { key: legacyKey, going: false, artist: "unsafe artist", tour: "unsafe tour" },
    }));
    assert.equal(erasedCanonical.attendance, null);
    assert.equal(database.prepare("SELECT 1 FROM show_attendance WHERE user_id=?").get(unverified.id), undefined);

    const active = addUser(database, "privacy_suspended");
    const activePost = (body, user = active) => routes["POST /api/going"](context({
      user,
      body: { ...show, ...body },
    }));
    const going = activePost({ state: "going", visibility: "members" });
    const startsAt = 2_000_000_003_000;
    database.prepare(`UPDATE shows SET provider='ticketmaster',provider_event_id='privacy-event',
      start_at=?,timezone='America/Toronto',lifecycle='happening' WHERE id=?`)
      .run(startsAt, going.showId);
    setNow(startsAt);
    const here = activePost({ state: "here", visibility: "members" });
    const beforePrivacy = database.prepare(`SELECT state,legacy_artist,legacy_venue,legacy_city,
      legacy_date,checked_in_at FROM show_attendance WHERE show_id=? AND user_id=?`)
      .get(going.showId, active.id);
    database.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(startsAt + 60_000, active.id);
    const suspended = database.prepare("SELECT * FROM users WHERE id=?").get(active.id);
    const safetyBefore = calls.safety.length;
    const privateHere = activePost({
      state: "here",
      visibility: "private",
      artist: "unsafe artist",
      tour: "unsafe tour",
    }, suspended);
    assert.equal(privateHere.attendance.visibility, "private");
    assert.equal(privateHere.attendance.checkedInAt, here.attendance.checkedInAt);
    const afterPrivacy = database.prepare(`SELECT state,legacy_artist,legacy_venue,legacy_city,
      legacy_date,checked_in_at FROM show_attendance WHERE show_id=? AND user_id=?`)
      .get(going.showId, active.id);
    assert.deepEqual({ ...afterPrivacy }, { ...beforePrivacy },
      "Members to Private preserves state, labels, and the original live check-in");
    assert.equal(calls.safety.length, safetyBefore);
    assert.throws(
      () => activePost({ state: "here", visibility: "members" }, suspended),
      (error) => error.code === "FORBIDDEN",
    );
    assert.throws(
      () => activePost({ state: "went", visibility: "private" }, suspended),
      (error) => error.code === "FORBIDDEN",
    );
    const suspendedDelete = activePost({
      going: false,
      artist: "unsafe artist",
      tour: "unsafe tour",
    }, suspended);
    assert.equal(suspendedDelete.attendance, null);
    assert.equal(database.prepare("SELECT 1 FROM show_attendance WHERE user_id=?").get(active.id), undefined);
  } finally {
    database.close();
  }
});

test("an existing live check-in can be retried or made private after the trusted window without moving its timestamp", () => {
  const { database, routes, setNow } = fixture();
  try {
    const member = addUser(database, "closed_window_member");
    const freshMember = addUser(database, "closed_window_fresh");
    const post = (user, body) => routes["POST /api/going"](context({
      user,
      body: { ...show, ...body },
    }));
    const going = post(member, { going: true });
    const startsAt = 2_000_000_001_000;
    database.prepare(`UPDATE shows SET provider='ticketmaster',provider_event_id='closed-window-event',
      start_at=?,timezone='America/Toronto',lifecycle='happening' WHERE id=?`)
      .run(startsAt, going.showId);
    setNow(startsAt + 100);
    const here = post(member, { state: "here", visibility: "members" });
    assert.equal(here.attendance.checkedInAt, startsAt + 100);

    const afterWindow = startsAt + 13 * 60 * 60 * 1000;
    setNow(afterWindow);
    const repeated = post(member, { state: "here" });
    assert.deepEqual({
      visibility: repeated.attendance.visibility,
      checkedInAt: repeated.attendance.checkedInAt,
      updatedAt: repeated.attendance.updatedAt,
    }, {
      visibility: "members",
      checkedInAt: here.attendance.checkedInAt,
      updatedAt: here.attendance.updatedAt,
    }, "an existing Here relation remains exactly idempotent after the live window");

    const privatized = post(member, { state: "here", visibility: "private" });
    assert.equal(privatized.attendance.visibility, "private");
    assert.equal(privatized.attendance.checkedInAt, here.attendance.checkedInAt,
      "changing the audience never rewrites when the member checked in");
    assert.throws(
      () => post(freshMember, { state: "here" }),
      (error) => error.status === 409 && error.code === "CHECK_IN_UNAVAILABLE",
      "the closed window remains enforced for a fresh check-in",
    );
  } finally {
    database.close();
  }
});

test("attendance authorization and live-transition checks use the locked current state", () => {
  const { database, routes, setBeforeAtomicWrite, setNow } = fixture();
  try {
    const restricted = addUser(database, "locked_privacy_owner", { verified: false });
    const liveMember = addUser(database, "locked_here_owner");
    const key = "locked provider|trusted room|2026-12-20";
    const startsAt = 2_000_000_000_000;
    database.prepare(`INSERT INTO shows
      (id,canonical_key,artist,venue,start_at,timezone,lifecycle,provider,provider_event_id,
        identity_source,public_eligible,created_at,updated_at)
      VALUES ('locked-provider-show',?,'Locked Provider','Trusted Room',?,'America/Toronto',
        'happening','ticketmaster','locked-event','ticketmaster',1,80,80)`)
      .run("locked-provider-canonical", startsAt);
    database.prepare(`INSERT INTO show_aliases
      (alias_type,alias_value,show_id,created_at)
      VALUES ('legacy_concert_key',?,'locked-provider-show',80)`).run(key);
    const insertAttendance = database.prepare(`INSERT INTO show_attendance
      (show_id,user_id,state,visibility,legacy_concert_key,legacy_artist,legacy_venue,
        checked_in_at,created_at,updated_at)
      VALUES ('locked-provider-show',?,?,?,?,?,?,?,?,?)`);
    insertAttendance.run(restricted.id, "going", "members", key,
      "Locked Provider", "Trusted Room", null, 81, 81);
    insertAttendance.run(liveMember.id, "here", "private", key,
      "Locked Provider", "Trusted Room", startsAt + 100, 82, 82);

    // This hook simulates another request committing its deletion after the
    // vulnerable pre-lock read but before this request acquires its write lock.
    setBeforeAtomicWrite(() => database.prepare(`DELETE FROM show_attendance
      WHERE show_id='locked-provider-show' AND user_id=?`).run(restricted.id));
    assert.throws(
      () => routes["POST /api/going"](context({
        user: restricted,
        body: { key, state: "going", visibility: "private" },
      })),
      (error) => error.code === "EMAIL_VERIFICATION_REQUIRED",
      "a stale privacy-only decision cannot recreate deleted attendance",
    );
    assert.equal(database.prepare(`SELECT 1 FROM show_attendance
      WHERE show_id='locked-provider-show' AND user_id=?`).get(restricted.id), undefined);

    setNow(startsAt + 13 * 60 * 60 * 1000);
    setBeforeAtomicWrite(() => database.prepare(`DELETE FROM show_attendance
      WHERE show_id='locked-provider-show' AND user_id=?`).run(liveMember.id));
    assert.throws(
      () => routes["POST /api/going"](context({
        user: liveMember,
        body: { key, state: "here", visibility: "private" },
      })),
      (error) => error.code === "CHECK_IN_UNAVAILABLE" && error.status === 409,
      "a stale Here snapshot cannot bypass the trusted live window",
    );
    assert.equal(database.prepare(`SELECT 1 FROM show_attendance
      WHERE show_id='locked-provider-show' AND user_id=?`).get(liveMember.id), undefined);
  } finally {
    database.close();
  }
});

test("Crowd scopes enforce attendance visibility, follows, friendship, blocks, and separate verification", () => {
  const { database, routes, setNow } = fixture();
  try {
    const viewer = addUser(database, "viewer");
    const member = addUser(database, "member");
    const followed = addUser(database, "followed");
    const nonfollow = addUser(database, "nonfollow");
    const friend = addUser(database, "friend");
    const privateOther = addUser(database, "private_other");
    const interested = addUser(database, "interested");
    const blocked = addUser(database, "blocked");
    const banned = addUser(database, "banned");
    const unverified = addUser(database, "unverified", { verified: false });
    const unverifiedLegacy = addUser(database, "unverified_legacy", { verified: false });
    const write = (user, state, visibility) => routes["POST /api/going"](context({
      user,
      body: { ...show, state, visibility },
    }));

    const viewerResult = write(viewer, "going", "private");
    write(member, "going", "members");
    write(followed, "going", "followers");
    write(nonfollow, "going", "followers");
    database.prepare(`UPDATE shows SET provider='ticketmaster',provider_event_id='trusted-crowd-event',
      start_at=?,timezone='America/Toronto',lifecycle='happening' WHERE id=?`)
      .run(2_000_000_000_000, viewerResult.showId);
    setNow(2_000_000_000_100);
    write(friend, "here", "members");
    write(privateOther, "went", "private");
    write(interested, "interested", "members");
    write(blocked, "going", "members");
    write(banned, "going", "members");
    database.prepare(`INSERT INTO show_attendance
      (show_id,user_id,state,visibility,created_at,updated_at) VALUES (?,?,?,?,?,?)`)
      .run(viewerResult.showId, unverified.id, "going", "members", 2_000_000_000_100, 2_000_000_000_100);
    database.prepare(`INSERT INTO going
      (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(unverifiedLegacy.id, show.key, show.artist, show.venue, show.city, show.date, 2_000_000_000_100);
    database.prepare("UPDATE users SET is_banned=1 WHERE id=?").run(banned.id);

    const follow = database.prepare("INSERT INTO follows (follower_id,followee_id) VALUES (?,?)");
    follow.run(viewer.id, followed.id);
    follow.run(viewer.id, friend.id);
    follow.run(friend.id, viewer.id);
    follow.run(viewer.id, interested.id);
    database.prepare("INSERT INTO blocks (blocker_id,blocked_id) VALUES (?,?)").run(blocked.id, viewer.id);
    database.prepare(`INSERT INTO show_attendance_verifications
      (show_id,user_id,source,verified_at) VALUES (?,?,?,?)`)
      .run(viewerResult.showId, friend.id, "ticket_import", 2_000_000_000_100);

    const read = (user, scope = "everyone", extraQuery = {}) => routes["GET /api/going/:key/attendees"](context({
      user,
      params: { key: encodeURIComponent(show.key) },
      query: { scope, limit: "100", ...extraQuery },
    }));
    const everyone = read(viewer);
    assert.equal(everyone.showId, viewerResult.showId);
    assert.equal(everyone.viewerAttendance.showId, viewerResult.showId);
    assert.equal(everyone.viewerAttendance.visibility, "private");
    assert.equal(everyone.total, 4);
    assert.deepEqual(everyone.stateCounts, { interested: 1, going: 3, here: 1, went: 0 });
    assert.equal(everyone.verifiedAttendeeCount, 1);
    assert.equal(everyone.liveStateRedacted, false);
    assert.deepEqual(new Set(everyone.attendees.map(({ id }) => id)),
      new Set([viewer.id, member.id, followed.id, friend.id]));
    const verifiedFriend = everyone.attendees.find(({ id }) => id === friend.id);
    assert.deepEqual(
      { state: verifiedFriend.state, verifiedAttendance: verifiedFriend.verifiedAttendance },
      { state: "here", verifiedAttendance: true },
    );
    assert.equal(Object.hasOwn(verifiedFriend, "visibility"), false,
      "another person's audience choice is enforced but not exposed");

    const following = read(viewer, "following");
    assert.equal(following.total, 2);
    assert.deepEqual(following.stateCounts, { interested: 1, going: 1, here: 1, went: 0 });
    assert.deepEqual(new Set(following.attendees.map(({ id }) => id)), new Set([followed.id, friend.id]));

    const friends = read(viewer, "friends");
    assert.equal(friends.total, 1);
    assert.deepEqual(friends.attendees.map(({ id }) => id), [friend.id]);
    assert.deepEqual(friends.stateCounts, { interested: 0, going: 0, here: 1, went: 0 });

    const guest = read(null);
    assert.deepEqual(guest.attendees, []);
    assert.equal(guest.total, 3, "guest aggregate keeps legacy social proof without private/follower rows");
    assert.deepEqual(guest.stateCounts, { interested: 1, going: 3, here: 0, went: 0 },
      "a guest cannot infer a one-person live Here state");
    assert.equal(guest.liveStateRedacted, true);

    assert.throws(
      () => read(unverified),
      (error) => error.status === 403 && error.code === "EMAIL_VERIFICATION_REQUIRED",
      "unverified sessions cannot enumerate attendee identities",
    );
  } finally {
    database.close();
  }
});

test("attendance inputs fail closed on contradictory states, invalid privacy, and invalid Crowd scopes", () => {
  const { database, routes } = fixture();
  try {
    const member = addUser(database, "validation_member");
    const post = (body) => routes["POST /api/going"](context({ user: member, body: { ...show, ...body } }));
    assert.throws(
      () => post({ state: "interested", going: true }),
      (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
    );
    assert.throws(
      () => post({ state: "going", visibility: "public" }),
      (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
    );
    assert.throws(
      () => routes["GET /api/going/:key/attendees"](context({
        user: member,
        params: { key: encodeURIComponent(show.key) },
        query: { scope: "nearby" },
      })),
      (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
    );
  } finally {
    database.close();
  }
});
