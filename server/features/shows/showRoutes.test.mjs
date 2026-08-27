import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ensureShowSchema } from "./showSchema.js";
import { createShowRepository } from "./showRepository.js";
import { showRoutes } from "./showRoutes.js";

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const SHOW_ID = `show_${"a".repeat(64)}`;

function fixture() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY, is_banned INTEGER NOT NULL DEFAULT 0,
      suspended_until INTEGER, email_verified_at INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE going (
      user_id TEXT NOT NULL, concert_key TEXT NOT NULL, artist TEXT NOT NULL,
      venue TEXT NOT NULL, city TEXT NOT NULL DEFAULT '', date TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id,concert_key)
    );
  `);
  ensureShowSchema(database);
  database.prepare("INSERT INTO users(id) VALUES (?)").run("fan-a");
  database.prepare(`INSERT INTO shows
    (id,canonical_key,artist,artist_key,venue,venue_key,city,date,local_date,start_at,
      start_local_time,timezone,lifecycle,tour,provider,provider_event_id,identity_source,
      public_eligible,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    SHOW_ID, "provider:tm:event-7", "The Artist", "the-artist", "The Room", "the-room",
    "Toronto", "2026-09-03", "2026-09-03", 1_788_400_800_000, "20:00",
    "America/Toronto", "upcoming", "World Tour", "ticketmaster", "event-7",
    "provider_event", 1, 1, 1,
  );
  database.prepare("INSERT INTO show_aliases(alias_type,alias_value,show_id,created_at) VALUES (?,?,?,?)")
    .run("provider_event", "ticketmaster:event-7", SHOW_ID, 1);
  database.prepare(`INSERT INTO show_performers
    (show_id,performer_key,performer_name,role,position,created_at) VALUES (?,?,?,?,?,?)`)
    .run(SHOW_ID, "the-artist", "The Artist", "headliner", 0, 1);
  const routes = showRoutes({
    database,
    ApiError,
    decodeShowKey: (ctx) => decodeURIComponent(ctx.params.key),
    requireUser(ctx) {
      if (!ctx.user || ctx.user.is_banned) throw new ApiError(403, "Restricted.", "FORBIDDEN");
      return ctx.user;
    },
  });
  return { database, repository: createShowRepository(database), routes };
}

function context(key, user = null) {
  const headers = {};
  return {
    params: { key: encodeURIComponent(key) },
    user,
    setHeader(name, value) { headers[name] = value; },
    headers,
  };
}

test("canonical ID and provider alias resolve the same bounded public Show document", () => {
  const { database, routes } = fixture();
  database.prepare(`INSERT INTO show_attendance
    (show_id,user_id,state,visibility,created_at,updated_at)
    VALUES (?,?,'going','private',1,1)`).run(SHOW_ID, "fan-a");
  const byId = routes["GET /api/shows/:key"](context(SHOW_ID));
  const byAlias = routes["GET /api/shows/:key"](context("ticketmaster:event-7", { id: "fan-a" }));
  assert.equal(byId.show.id, SHOW_ID);
  assert.equal(byAlias.show.id, byId.show.id);
  assert.equal(byAlias.show.provider.backed, true);
  assert.equal(byAlias.show.lifecycle, "upcoming");
  assert.equal(byAlias.show.startsAt, 1_788_400_800_000);
  assert.deepEqual(byAlias.show.performers.map(({ name }) => name), ["The Artist"]);
  assert.equal(byId.show.viewerAttendance, null, "guest reads never expose private viewer state");
  assert.equal(byAlias.show.viewerAttendance.visibility, "private");
});

test("unknown and malformed identities return 404 without allocating catalogue rows", () => {
  const { database, routes } = fixture();
  const before = database.prepare("SELECT COUNT(*) AS count FROM shows").get().count;
  assert.throws(
    () => routes["GET /api/shows/:key"](context("not-a-real-show")),
    (error) => error.status === 404 && error.code === "NOT_FOUND",
  );
  assert.throws(
    () => routes["GET /api/shows/:key"]({ ...context("x"), params: { key: "%E0%A4%A" } }),
    (error) => error.status === 404,
  );
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM shows").get().count, before);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM show_aliases").get().count, 1);
});

test("ambiguous alias namespaces and canonical-key collisions fail closed", () => {
  const { database, repository, routes } = fixture();
  const secondId = `show_${"c".repeat(64)}`;
  database.prepare(`INSERT INTO shows
    (id,canonical_key,provider,provider_event_id,identity_source,public_eligible,created_at,updated_at)
    VALUES (?,?,'bandsintown','event-8','provider_event',1,1,1)`)
    .run(secondId, "provider:bit:event-8");
  database.prepare("INSERT INTO show_aliases(alias_type,alias_value,show_id,created_at) VALUES (?,?,?,?)")
    .run("legacy_concert_key", "ticketmaster:event-7", secondId, 1);
  assert.equal(repository.resolve("ticketmaster:event-7"), null,
    "the same opaque alias value in two namespaces cannot pick a preferred Show");
  assert.throws(
    () => routes["GET /api/shows/:key"](context("ticketmaster:event-7")),
    (error) => error.status === 404,
  );

  const thirdId = `show_${"d".repeat(64)}`;
  database.prepare(`INSERT INTO shows
    (id,canonical_key,provider,provider_event_id,identity_source,public_eligible,created_at,updated_at)
    VALUES (?,?,'ticketmaster','event-9','provider_event',1,1,1)`)
    .run(thirdId, "canonical-collision");
  database.prepare("INSERT INTO show_aliases(alias_type,alias_value,show_id,created_at) VALUES (?,?,?,?)")
    .run("provider_event", "canonical-collision", SHOW_ID, 1);
  assert.equal(repository.resolve("canonical-collision"), null,
    "a canonical key cannot silently outrank another Show's alias");
});

test("private thin Shows are invisible to guests but readable by their own attendee only", () => {
  const { database, repository } = fixture();
  const privateId = `show_${"b".repeat(64)}`;
  database.prepare(`INSERT INTO shows
    (id,canonical_key,identity_source,public_eligible,created_at,updated_at)
    VALUES (?,?,'member_legacy_alias',0,1,1)`).run(privateId, "member|room|night");
  database.prepare(`INSERT INTO show_attendance
    (show_id,user_id,state,visibility,created_at,updated_at) VALUES (?,?,'interested','private',1,1)`)
    .run(privateId, "fan-a");
  assert.equal(repository.read(privateId, null), null);
  assert.equal(repository.read(privateId, "stranger"), null);
  const own = repository.read(privateId, "fan-a");
  assert.equal(own.publicEligible, false);
  assert.equal(own.indexable, false);
  assert.equal(own.viewerAttendance.visibility, "private");
});

test("identity reads use indexed primary/unique lookup plans", () => {
  const { database } = fixture();
  const idPlan = database.prepare("EXPLAIN QUERY PLAN SELECT * FROM shows WHERE id=?").all(SHOW_ID)
    .map(({ detail }) => detail).join(" ");
  const canonicalPlan = database.prepare(
    "EXPLAIN QUERY PLAN SELECT id FROM shows WHERE canonical_key=?",
  ).all("ticketmaster:event-7").map(({ detail }) => detail).join(" ");
  const aliasPlan = database.prepare(`EXPLAIN QUERY PLAN SELECT show_id AS id FROM show_aliases
    WHERE alias_value=? GROUP BY show_id ORDER BY show_id LIMIT 2`).all("ticketmaster:event-7")
    .map(({ detail }) => detail).join(" ");
  assert.match(idPlan, /INDEX|PRIMARY KEY/u);
  assert.match(aliasPlan, /idx_show_aliases_value_show/u);
  assert.match(canonicalPlan, /sqlite_autoindex_shows_2|canonical_key/u);
  assert.doesNotMatch(canonicalPlan, /SCAN shows/u);
  assert.doesNotMatch(aliasPlan, /SCAN shows/u);
  assert.doesNotMatch(aliasPlan, /SCAN show_aliases/u);
});
