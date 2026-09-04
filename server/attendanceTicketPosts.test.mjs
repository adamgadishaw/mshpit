import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-attendance-ticket-posts-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
// Keep the focused test runnable against either side of the additive rolling
// migration; production db.js owns these columns, not this API test.
const ensureColumn = (table, name, definition) => {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  if (!columns.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
};
ensureColumn("posts", "attendance_ticket", "TEXT");
ensureColumn("tour_dates", "tour_name", "TEXT");
ensureColumn("tour_dates", "access_start_date_time", "TEXT");
ensureColumn("tour_dates", "access_start_approximate", "INTEGER");

const { ApiError, routes } = await import("./api.js");
const FUTURE_YEAR = new Date().getUTCFullYear() + 1;
const DEFAULT_EVENT_DATE = `${FUTURE_YEAR}-10-20`;

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id.replace(/[^a-z0-9_]/g, "").slice(0, 20),
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}

const insertEvent = db.prepare(`INSERT INTO tour_dates
  (id,artist,artist_key,venue,place,date,ticket_url,source,updated_at,release_at,
    provider_event_id,event_name,tour_name,start_date_time,start_local_time,
    access_start_date_time,access_start_approximate,event_timezone,venue_city,event_kind,
    event_image_url,event_image_attribution,event_image_width,event_image_height)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

function addEvent({
  id,
  artist = "Server Artist",
  venue = "Server Room",
  date = DEFAULT_EVENT_DATE,
  providerEventId = id,
} = {}) {
  db.prepare(`INSERT OR IGNORE INTO artists
    (norm,name,photo,rank_score,data,source,created_at,updated_at)
    VALUES ('server artist','Server Artist','https://images.example.com/server-artist.jpg',0,'{}','test',1,1)`).run();
  insertEvent.run(
    id,
    artist,
    null,
    venue,
    "Toronto, Ontario, Canada",
    date,
    `https://www.ticketmaster.ca/event/${providerEventId}`,
    "ticketmaster",
    Date.now(),
    0,
    providerEventId,
    `${artist} Live`,
    "The Exact Tour",
    `${date}T23:00:00Z`,
    "19:00:00",
    `${date}T22:00:00Z`,
    1,
    "America/Toronto",
    "Toronto",
    "concert",
    "https://s1.ticketm.net/dam/a/111/attendance-ticket-test.jpg",
    "Ticketmaster",
    1024,
    576,
  );
}

function attendanceKey({ artist = "Server Artist", venue = "Server Room", date = DEFAULT_EVENT_DATE } = {}) {
  return `${artist.toLowerCase()}|${venue.toLowerCase()}|${date}`;
}

function markAttendance(user, event, state = "going") {
  return routes["POST /api/going"]({
    user,
    ip: `attendance-${user.id}-${state}`,
    body: {
      key: attendanceKey(event),
      artist: event.artist || "Server Artist",
      venue: event.venue || "Server Room",
      city: "Toronto",
      date: event.date || DEFAULT_EVENT_DATE,
      state,
      visibility: "private",
    },
  });
}

function markExactAttendance(user, event, state = "going") {
  return routes["POST /api/going"]({
    user,
    ip: `exact-attendance-${user.id}-${state}`,
    body: {
      tourDateId: event.id,
      key: attendanceKey(event),
      // Exact writes must ignore these client copies and project the event from
      // the server-owned tour_dates row instead.
      artist: "Forged Client Artist",
      venue: "Forged Client Venue",
      city: "Forged Client City",
      date: "2099-01-01",
      tour: "Forged Client Tour",
      state,
      visibility: "private",
    },
  });
}

function ticketBody(tourDateId, mutationId, extra = {}) {
  return {
    kind: "status",
    clientMutationId: mutationId,
    review: "Secured my seat — see you there.",
    attendanceTicket: {
      tourDateId,
      includeSeat: true,
      section: "118",
      row: "D",
      seat: "12",
    },
    ...extra,
  };
}

let artistMediaSequence = 0;
function finalizedArtistSlotImage(owner, purpose) {
  artistMediaSequence += 1;
  const token = `ticketartist${artistMediaSequence}`;
  const objectKey = `users/${owner.id}/${purpose}/${token}.webp`;
  const publicUrl = `https://pit-media.example/${objectKey}`;
  const at = Date.now();
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?,'public',?,1024,'issued',?,?)`).run(objectKey, owner.id, purpose, at, at);
  db.prepare(`INSERT INTO legacy_media_finalize_descriptors
    (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
      output_mime_type,output_object_key,output_url,output_byte_size,width,height,status,expires_at,
      finalized_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'image/jpeg',2048,'image/webp',?,?,1024,100,100,'finalized',?,?,?,?)`)
    .run(`lm_${token.padEnd(24, "x")}`, owner.id, "d".repeat(64), purpose,
      `users/${owner.id}/${purpose}/${token}-staging.jpg`, objectKey, publicUrl,
      at + 60_000, at, at, at);
  return publicUrl;
}

test("Going ticket posts persist only a server-owned event snapshot and remain idempotent", () => {
  const user = addUser("ticket_owner");
  const event = { id: "tm_ticket_post_1" };
  addEvent(event);
  markAttendance(user, event);

  const publicEvent = routes["GET /api/tourdates"]({ user: null }).tourDates
    .find((row) => row.id === event.id);
  assert.equal(publicEvent.eventName, "Server Artist Live");
  assert.equal(publicEvent.tourName, "The Exact Tour");
  assert.equal(publicEvent.startDateTime, `${DEFAULT_EVENT_DATE}T23:00:00Z`);
  assert.equal(publicEvent.startLocalTime, "19:00:00");
  assert.equal(publicEvent.accessStartDateTime, `${DEFAULT_EVENT_DATE}T22:00:00Z`);
  assert.equal(publicEvent.accessStartApproximate, true);

  const body = ticketBody(event.id, "attendance_ticket_retry_001");
  const created = routes["POST /api/posts"]({ user, ip: "ticket-create", body });
  assert.equal(created.post.kind, "status");
  assert.equal(created.post.review, body.review);
  assert.deepEqual(created.post.attendanceTicket.seat, { section: "118", row: "D", seat: "12" });
  assert.equal(created.post.attendanceTicket.state, "going");
  assert.equal(created.post.attendanceTicket.tourDateId, event.id);
  assert.equal(created.post.attendanceTicket.artist, "Server Artist");
  assert.equal(created.post.attendanceTicket.venue, "Server Room");
  assert.equal(created.post.attendanceTicket.eventName, "Server Artist Live");
  assert.equal(created.post.attendanceTicket.tourName, "The Exact Tour");
  assert.equal(created.post.attendanceTicket.accessStartDateTime, `${DEFAULT_EVENT_DATE}T22:00:00Z`);
  assert.equal(created.post.attendanceTicket.accessStartApproximate, true);
  assert.equal(created.post.attendanceTicket.doorsAt, null,
    "Ticketmaster event access must not be upgraded to venue-confirmed doors");
  assert.equal(created.post.attendanceTicket.doorsVerified, null);
  assert.equal(created.post.attendanceTicket.artistPhotoUri, "https://images.example.com/server-artist.jpg");
  assert.equal(
    created.post.attendanceTicket.eventImageUri,
    "https://s1.ticketm.net/dam/a/111/attendance-ticket-test.jpg",
    "the immutable Going ticket keeps its exact provider event artwork",
  );
  assert.equal(Object.hasOwn(created.post.attendanceTicket, "art"), false);

  assert.throws(
    () => routes["PATCH /api/posts/:id"]({
      user,
      ip: "ticket-generic-edit",
      params: { id: created.id },
      body: { review: "Changed into an unrelated status" },
    }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "CONFLICT"
      && /cannot be edited/i.test(error.message),
  );

  const stored = JSON.parse(db.prepare("SELECT attendance_ticket FROM posts WHERE id=?").get(created.id).attendance_ticket);
  assert.equal(stored.tourDateId, event.id);
  assert.equal(Object.hasOwn(stored, "orderId"), false);
  assert.equal(Object.hasOwn(stored, "barcode"), false);

  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "ticket-duplicate-new-mutation",
      body: ticketBody(event.id, "attendance_ticket_retry_002"),
    }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "CONFLICT"
      && /already shared/i.test(error.message),
  );

  // Lost-response retries return the immutable committed card even if the
  // provider row and current Going state disappeared after the first commit.
  db.prepare("DELETE FROM tour_dates WHERE id=?").run(event.id);
  db.prepare("DELETE FROM show_attendance WHERE user_id=?").run(user.id);
  db.prepare("DELETE FROM going WHERE user_id=?").run(user.id);
  const retry = routes["POST /api/posts"]({ user, ip: "ticket-retry-after-drift", body });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.id, created.id);
  assert.deepEqual(retry.post.attendanceTicket, created.post.attendanceTicket);

  routes["DELETE /api/posts/:id"]({ user, ip: "ticket-delete", params: { id: created.id } });
  assert.equal(db.prepare("SELECT attendance_ticket FROM posts WHERE id=?").get(created.id).attendance_ticket, null,
    "author deletion scrubs the public event and optional seat snapshot");
});

test("Going ticket artwork never publishes a banner-finalized artist image as an avatar", () => {
  const user = addUser("ticket_artist_purpose");
  const event = {
    id: "tm_ticket_artist_purpose",
    artist: "Ticket Purpose Artist",
    venue: "Purpose Room",
    date: `${FUTURE_YEAR}-10-25`,
  };
  addEvent(event);
  const wrongPurposePhoto = finalizedArtistSlotImage(user, "banner");
  db.prepare(`INSERT INTO artist_profiles
    (artist_key,owner_id,avatar_uri,avatar_owner_id,feed_enabled,updated_at)
    VALUES (?,NULL,?,?,1,?)`)
    .run("ticket purpose artist", wrongPurposePhoto, user.id, Date.now());
  markAttendance(user, event);

  const created = routes["POST /api/posts"]({
    user,
    ip: "ticket-artist-purpose-create",
    body: ticketBody(event.id, "attendance_ticket_artist_purpose"),
  });
  assert.equal(created.post.attendanceTicket.artistPhotoUri, null);
  assert.notEqual(created.post.attendanceTicket.artistPhotoUri, wrongPurposePhoto);
});

test("Going ticket projection carries complete attribution only for verified licensed artist art", () => {
  const user = addUser("ticket_licensed_artist");
  const event = {
    id: "tm_ticket_licensed_artist",
    artist: "Bryson Tiller",
    venue: "Licensed Room",
    date: `${FUTURE_YEAR}-10-26`,
  };
  addEvent(event);
  markAttendance(user, event);

  const created = routes["POST /api/posts"]({
    user,
    ip: "ticket-licensed-create",
    body: ticketBody(event.id, "attendance_ticket_licensed_artist"),
  });
  assert.match(created.post.attendanceTicket.artistPhotoUri, /^https:\/\/[^/]+\/artists\/licensed\//);
  assert.deepEqual(created.post.attendanceTicket.artistPhotoAttribution, {
    source: "licensed-media",
    title: "Bryson Tiller August 2018 (cropped).jpg",
    creator: "AtlantaFX",
    license: "CC-BY-3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
    sourcePage: "https://commons.wikimedia.org/wiki/File:Bryson_Tiller_August_2018_(cropped).jpg",
    modificationNotice:
      "Source file was cropped on Wikimedia Commons from the original YouTube frame. Resized and converted to WebP by MSHpit.",
  });
});

test("ticket publication requires exact current Going attendance and rejects client event copies or secrets", () => {
  const user = addUser("ticket_guarded");
  const event = { id: "tm_ticket_post_2", date: `${FUTURE_YEAR}-11-01` };
  addEvent(event);

  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "ticket-without-going",
      body: ticketBody(event.id, "attendance_ticket_guard_001"),
    }),
    (error) => error instanceof ApiError && error.status === 403 && error.code === "FORBIDDEN",
  );

  markAttendance(user, event, "interested");
  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "ticket-interested-only",
      body: ticketBody(event.id, "attendance_ticket_guard_002"),
    }),
    (error) => error instanceof ApiError && error.status === 403 && error.code === "FORBIDDEN",
  );
  markAttendance(user, event, "going");

  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "ticket-secret",
      body: ticketBody(event.id, "attendance_ticket_guard_003", {
        attendanceTicket: {
          tourDateId: event.id,
          includeSeat: true,
          section: "118",
          barcode: "never-store-this",
        },
      }),
    }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED"
      && /never include/i.test(error.message),
  );
  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "ticket-forged-event",
      body: ticketBody(event.id, "attendance_ticket_guard_004", {
        attendanceTicket: {
          tourDateId: event.id,
          includeSeat: false,
          eventName: "Forged client event name",
        },
      }),
    }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );

  const privateSeat = routes["POST /api/posts"]({
    user,
    ip: "ticket-seat-opt-out",
    body: ticketBody(event.id, "attendance_ticket_guard_005", {
      attendanceTicket: {
        tourDateId: event.id,
        includeSeat: false,
        section: "SHOULD NOT PERSIST",
        row: "SECRET ROW",
        seat: "SECRET SEAT",
      },
    }),
  });
  assert.equal(privateSeat.post.attendanceTicket.seat, null);
  const stored = db.prepare("SELECT attendance_ticket FROM posts WHERE id=?").get(privateSeat.id).attendance_ticket;
  assert.doesNotMatch(stored, /SHOULD NOT PERSIST|SECRET ROW|SECRET SEAT/);
});

test("ambiguous legacy attendance cannot authorize either of two same-night provider events", () => {
  const user = addUser("ticket_ambiguous");
  const first = { id: "tm_ticket_collision_1", providerEventId: "collision-1", date: `${FUTURE_YEAR}-12-10` };
  const second = { id: "tm_ticket_collision_2", providerEventId: "collision-2", date: `${FUTURE_YEAR}-12-10` };
  addEvent(first);
  addEvent(second);
  markAttendance(user, first);

  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "ticket-ambiguous",
      body: ticketBody(first.id, "attendance_ticket_collision_001"),
    }),
    (error) => error instanceof ApiError && error.status === 403 && error.code === "FORBIDDEN",
  );
});

test("exact attendance authorizes only its tour date when two events share artist venue and date", () => {
  const user = addUser("ticket_exact_collision");
  const first = { id: "tm_ticket_exact_collision_1", providerEventId: "exact-collision-1", date: `${FUTURE_YEAR}-12-12` };
  const second = { id: "tm_ticket_exact_collision_2", providerEventId: "exact-collision-2", date: `${FUTURE_YEAR}-12-12` };
  addEvent(first);
  addEvent(second);

  const marked = markExactAttendance(user, first);
  assert.equal(marked.show.tourDateId, first.id);
  assert.equal(marked.attendance.tourDateId, first.id);
  const hydrated = routes["GET /api/me/going"]({ user });
  assert.equal(hydrated.attendance.find((entry) => entry.tourDateId === first.id)?.state, "going",
    "the private canonical attendance response must restore exact Going state after reload");
  const canonical = db.prepare(`SELECT s.tour_date_id,s.provider,s.provider_event_id,
    a.legacy_artist,a.legacy_venue,a.legacy_date
    FROM shows s JOIN show_attendance a ON a.show_id=s.id
    WHERE a.user_id=?`).get(user.id);
  assert.deepEqual({ ...canonical }, {
    tour_date_id: first.id,
    provider: "ticketmaster",
    provider_event_id: first.providerEventId,
    legacy_artist: "Server Artist",
    legacy_venue: "Server Room",
    legacy_date: first.date,
  });
  assert.equal(db.prepare("SELECT COUNT(*) count FROM show_aliases WHERE show_id=?")
    .get(marked.showId).count, 0, "a colliding display key must not become an alias for either exact event");
  const repeated = markExactAttendance(user, first);
  assert.equal(repeated.showId, marked.showId);
  assert.equal(repeated.attendance.createdAt, marked.attendance.createdAt);

  const created = routes["POST /api/posts"]({
    user,
    ip: "ticket-exact-collision-a",
    body: ticketBody(first.id, "attendance_ticket_exact_collision_001"),
  });
  assert.equal(created.post.attendanceTicket.tourDateId, first.id);
  assert.throws(
    () => routes["POST /api/posts"]({
      user,
      ip: "ticket-exact-collision-b",
      body: ticketBody(second.id, "attendance_ticket_exact_collision_002"),
    }),
    (error) => error instanceof ApiError && error.status === 403 && error.code === "FORBIDDEN",
  );
});
