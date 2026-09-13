import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-provider-attendance-projection-"));
process.env.PIT_DATA_DIR = dataDir;
globalThis.fetch = async () => { throw new Error("Provider networking is disabled in this fixture"); };
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
const date = `${new Date().getUTCFullYear() + 1}-10-20`;
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

function user(id) {
  q.insertUser.run(id, `${id}@example.test`, id, id.replace(/[^a-z0-9_]/g, "").slice(0, 20),
    "fixture-hash", "fan", "Toronto", 43.65, -79.38, "FX", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=1 WHERE id=?").run(id);
  return q.userById.get(id);
}

function event(id, { artist = "sports.", billed = ["Jungle", "Sports"], venue = id, releaseAt = 0 } = {}) {
  db.prepare(`INSERT INTO tour_dates
    (id,artist,venue,place,date,source,updated_at,release_at,provider_event_id,event_name,
      event_kind,music_qualified,music_evidence,billed_artists,start_date_time,event_timezone)
    VALUES (?,?,?,'Toronto',?,'ticketmaster',1,?,?,?,'concert',1,'provider classification',?,?, 'UTC')`)
    .run(id, artist, venue, date, releaseAt, id, `${billed[0] || artist} Live`, JSON.stringify(billed), `${date}T23:00:00Z`);
  return { id, venue, oldKey: `${artist}|${venue}|${date}`.toLowerCase(), key: `${billed[0]}|${venue}|${date}`.toLowerCase() };
}

function going(member, show, extra = {}) {
  return routes["POST /api/going"]({ user: member, ip: member?.id || "guest", body: {
    tourDateId: show.id, key: show.key, state: "going", visibility: "private", ...extra,
  } });
}
function messages(member, key) {
  return routes["GET /api/lounges/:key/messages"]({ user: member, params: { key: encodeURIComponent(key) } });
}
const denied = (member, key) => assert.throws(() => messages(member, key), { status: 403, code: "LOUNGE_ATTENDANCE_REQUIRED" });

test("projected provider Going uses the visible artist alias without accepting arbitrary client aliases", () => {
  const member = user("projection_owner");
  const stranger = user("projection_stranger");
  const show = event("projection_unique");
  const projected = routes["GET /api/tourdates"]({ user: member }).tourDates.find((row) => row.id === show.id);
  assert.equal(projected.artist, "Jungle");
  const result = going(member, show, { key: "forged|other room|2099-01-01", artist: "Forged" });
  assert.equal(db.prepare("SELECT artist FROM shows WHERE id=?").get(result.showId).artist, "Jungle");
  assert.deepEqual(messages(member, show.key).messages, []);
  assert.deepEqual(messages(member, show.oldKey).messages, []);
  denied(member, "forged|other room|2099-01-01");
  denied(stranger, show.key);
  going(member, show, { state: null });
  denied(member, show.key);
  denied(member, show.oldKey);
});

test("existing exact-show aliases and member attendance survive the display repair", () => {
  const member = user("projection_existing");
  const show = event("projection_existing", { billed: ["sports."] });
  show.key = show.oldKey;
  const first = going(member, show);
  db.prepare("UPDATE tour_dates SET billed_artists=? WHERE id=?").run(JSON.stringify(["Jungle", "Sports"]), show.id);
  show.key = `jungle|${show.venue}|${date}`;
  const next = going(member, show);
  assert.equal(next.showId, first.showId);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM show_attendance WHERE user_id=?").get(member.id).count, 1);
  assert.deepEqual(messages(member, show.oldKey).messages, []);
  assert.deepEqual(messages(member, show.key).messages, []);
});

for (const canonicalLegacy of [false, true]) {
  test(`legacy-only ${canonicalLegacy ? "canonical" : "going-table"} attendance survives exact projection adoption`, () => {
    const member = user(`projection_legacy_${canonicalLegacy}`);
    const show = event(`projection_legacy_${canonicalLegacy}`);
    if (canonicalLegacy) {
      routes["POST /api/going"]({ user: member, ip: member.id, body: {
        key: show.oldKey, artist: "sports.", venue: show.venue, date, state: "going", visibility: "private",
      } });
    } else {
      db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,city,date,created_at) VALUES (?,?,?,?,'Toronto',?,1)")
        .run(member.id, show.oldKey, "sports.", show.venue, date);
    }
    const result = going(member, show, { state: "going", visibility: "private" });
    assert.equal(result.state, "going");
    assert.deepEqual(messages(member, show.oldKey).messages, []);
    assert.deepEqual(messages(member, show.key).messages, []);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM show_attendance WHERE user_id=?").get(member.id).count, 1);
    going(member, show, { state: null });
    denied(member, show.oldKey);
    denied(member, show.key);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM going WHERE user_id=?").get(member.id).count, 0);
  });
}

test("duplicate projected tuples never grant one exact event attendance to another lounge", () => {
  const member = user("projection_duplicate");
  const first = event("projection_duplicate_a", { venue: "duplicate room" });
  const second = event("projection_duplicate_b", { artist: "Jungle", venue: "duplicate room" });
  const result = going(member, first);
  denied(member, first.key);
  assert.deepEqual(messages(member, first.oldKey).messages, []);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM show_aliases WHERE show_id=? AND alias_value=?").get(result.showId, second.key).count, 0);
  assert.deepEqual(messages(member, result.showId).messages, []);
});

test("bounded candidate overflow fails closed for aliases but preserves exact event attendance", () => {
  const member = user("projection_overflow");
  const first = event("projection_overflow_target", { venue: "overflow room" });
  for (let index = 0; index < 200; index += 1) event(`projection_overflow_${index}`, {
    artist: `Other ${index}`, billed: [`Other ${index}`], venue: "overflow room",
  });
  const result = going(member, first);
  denied(member, first.key);
  denied(member, first.oldKey);
  assert.deepEqual(messages(member, result.showId).messages, []);
});

test("venue normalization and missing venues cannot hide duplicate projected tuples", () => {
  for (const [suffix, firstVenue, secondVenue, publicVenue] of [
    ["unicode", "CAFÉ Room", "café  Room", "café room"],
    ["missing", "", "", "venue tba"],
  ]) {
    const member = user(`projection_${suffix}`);
    const first = event(`projection_${suffix}_a`, { venue: firstVenue });
    event(`projection_${suffix}_b`, { artist: "Jungle", venue: secondVenue });
    const result = going(member, first);
    denied(member, `jungle|${publicVenue}|${date}`);
    assert.deepEqual(messages(member, result.showId).messages, []);
  }
});

test("independently assigned old and projected rooms are not merged or erased by exact attendance", () => {
  const member = user("projection_separate");
  const show = event("projection_separate");
  const legacy = (key, artist) => routes["POST /api/going"]({ user: member, ip: member.id, body: {
    key, artist, venue: show.venue, date, state: "going", visibility: "private",
  } });
  const oldRoom = legacy(show.oldKey, "sports.");
  const newRoom = legacy(show.key, "Jungle");
  const exact = going(member, show);
  assert.equal(exact.showId, newRoom.showId);
  assert.notEqual(exact.showId, oldRoom.showId);
  assert.deepEqual(messages(member, show.oldKey).messages, []);
  assert.deepEqual(messages(member, show.key).messages, []);
  going(member, show, { state: null });
  denied(member, show.key);
  assert.deepEqual(messages(member, show.oldKey).messages, []);
  assert.equal(db.prepare("SELECT show_id FROM show_aliases WHERE alias_value=?").get(show.oldKey).show_id, oldRoom.showId);
});

test("unclaimed ambiguous keys cannot erase separately authorized legacy attendance", () => {
  const member = user("projection_erase");
  const first = event("projection_erase_a", { venue: "erase room" });
  event("projection_erase_b", { artist: "Jungle", venue: "erase room" });
  const legacy = routes["POST /api/going"]({ user: member, ip: member.id, body: {
    key: first.key, artist: "Jungle", venue: first.venue, date, state: "going", visibility: "members",
  } });
  const exact = going(member, first);
  assert.notEqual(exact.showId, legacy.showId);
  going(member, first, { state: null });
  assert.deepEqual(messages(member, first.key).messages, []);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM going WHERE user_id=? AND concert_key=?").get(member.id, first.key).count, 1);
});

test("projection does not bypass provider visibility or current-session authorization", () => {
  const member = user("projection_hidden");
  const show = event("projection_hidden");
  db.prepare("UPDATE tour_dates SET provider_active=0 WHERE id=?").run(show.id);
  assert.throws(() => going(member, show), { status: 404 });
  assert.throws(() => going(null, { ...show, id: "projection_unique" }), { status: 401 });
  db.prepare("UPDATE users SET suspended_until=? WHERE id=?").run(Date.now() + 86_400_000, member.id);
  assert.throws(() => going(q.userById.get(member.id), { ...show, id: "projection_unique" }), { status: 403 });
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM show_attendance WHERE user_id=?").get(member.id).count, 0);
});
