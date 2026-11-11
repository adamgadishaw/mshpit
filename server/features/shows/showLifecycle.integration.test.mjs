import assert from "node:assert/strict";
import test, { after } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dataDir = mkdtempSync(join(tmpdir(), "pit-show-lifecycle-"));
process.env.NODE_ENV = "test";
process.env.PIT_DATA_DIR = dataDir;
process.env.PIT_DISABLE_BACKGROUND_JOBS = "true";
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error("Show lifecycle tests must not contact providers"); };
const { db, q } = await import("../../db.js");
const { upsertProviderTourDateRows } = await import("../../tourdates.js");
const { routes } = await import("../../api.js");
after(() => {
  db.close();
  globalThis.fetch = originalFetch;
  rmSync(dataDir, { recursive: true, force: true });
});

const AT = Date.parse("2026-11-11T20:00:00Z");
const HOUR = 60 * 60 * 1000;
let serial = 0;
function fixture(t, { startsAt = AT - HOUR } = {}) {
  const number = ++serial;
  let clock = AT;
  t.mock.method(Date, "now", () => clock);
  const record = {
    id: `tm_lifecycle_${number}`, artist: `Lifecycle Performer ${number}`,
    artist_key: null, provider_artist_id: `lifecycle-performer-${number}`,
    venue: `Lifecycle Hall ${number}`, place: "Toronto, Canada",
    date: new Date(startsAt).toISOString().slice(0, 10), source: "ticketmaster",
    provider_event_id: `lifecycle_${number}`, event_name: `Lifecycle Concert ${number}`,
    music_qualified: 1, music_evidence: "synthetic music classification",
    billed_artists: [`Lifecycle Performer ${number}`], event_kind: "concert",
    event_status: "onsale", start_date_time: new Date(startsAt).toISOString(),
    start_local_time: "14:00", event_timezone: "America/Toronto", venue_city: "Toronto",
    venue_country_code: "CA", venue_provider_id: `lifecycle-hall-${number}`,
    ticket_url: `https://www.ticketmaster.com/event/lifecycle_${number}`,
  };
  const addUser = (suffix) => {
    const id = `lifecycle_${number}_${suffix}`;
    q.insertUser.run(id, `${id}@example.test`, id, id, "synthetic-test-hash", "fan",
      "Toronto", 43.65, -79.38, "LC", "#123456", clock);
    db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(clock, id);
    return q.userById.get(id);
  };
  const post = (user, body) => routes["POST /api/going"]({
    user, ip: `synthetic-${user.id}`, body, setHeader() {},
  });
  const read = (key) => routes["GET /api/shows/:key"]({
    params: { key: encodeURIComponent(key) }, query: {}, setHeader() {},
  }).show;
  upsertProviderTourDateRows(db, [record], { seenAt: clock });
  const owner = addUser("owner");
  const saved = post(owner, { tourDateId: record.id, state: "going", visibility: "private" });
  const alias = saved.show.aliases[0];
  assert.ok(alias, "the provider resolver proves the unique legacy alias");
  const identities = [{ key: saved.showId }, { key: alias }, { tourDateId: record.id }];
  return {
    record, owner, saved, alias, identities, post, read, addUser,
    setNow(at) { clock = at; },
    update(changes) {
      Object.assign(record, changes);
      upsertProviderTourDateRows(db, [record], { seenAt: ++clock });
    },
  };
}

for (const scenario of ["cancelled", "postponed", "rescheduled", "elapsed"]) {
  test(`actual Here routes revalidate ${scenario} source by stable ID, alias, and exact event`, (t) => {
    const f = fixture(t);
    const prior = db.prepare("SELECT * FROM show_attendance WHERE user_id=?").get(f.owner.id);
    const initial = f.read(f.saved.showId);
    assert.equal(initial.lifecycle, "happening");
    if (scenario === "elapsed") f.setNow(AT + 12 * HOUR);
    else if (scenario === "rescheduled") {
      f.update({ date: "2026-11-13", start_date_time: "2026-11-13T19:00:00Z", start_local_time: "14:00" });
    } else f.update({ event_status: scenario });
    const expectedLifecycle = { elapsed: "completed", rescheduled: "upcoming" }[scenario] || scenario;
    const current = f.read(f.saved.showId);
    assert.equal(current.lifecycle, expectedLifecycle);
    assert.equal(f.read(f.alias).lifecycle, expectedLifecycle);
    assert.equal(current.id, initial.id);
    assert.equal(current.canonicalKey, initial.canonicalKey);
    if (scenario === "rescheduled") {
      assert.equal(current.date, "2026-11-13");
      assert.equal(current.startsAt, Date.parse("2026-11-13T19:00:00Z"));
    }
    for (const [index, identity] of f.identities.entries()) {
      for (const user of [f.owner, f.addUser(`fresh_${index}`)]) {
        assert.throws(() => f.post(user, { ...identity, state: "here" }),
          (error) => error.status === 409 && error.code === "CHECK_IN_UNAVAILABLE");
      }
    }
    assert.deepEqual(db.prepare("SELECT * FROM show_attendance WHERE user_id=?").get(f.owner.id), prior,
      "failed live transitions preserve the historical member snapshot");
    assert.equal(db.prepare("SELECT COUNT(*) count FROM show_attendance WHERE show_id=?")
      .get(f.saved.showId).count, 1);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM shows WHERE tour_date_id=?")
      .get(f.record.id).count, 1);
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
  });
}

for (const change of [{ provider_active: 0 }, { music_qualified: 0 }]) {
  test(`actual fresh Here respects source eligibility ${Object.keys(change)[0]}`, (t) => {
    const f = fixture(t);
    const column = Object.keys(change)[0];
    db.prepare(`UPDATE tour_dates SET ${column}=? WHERE id=?`).run(change[column], f.record.id);
    for (const [index, identity] of f.identities.entries()) {
      assert.throws(() => f.post(f.addUser(`hidden_${index}`), { ...identity, state: "here" }),
        (error) => error.status === 404 && error.code === "NOT_FOUND");
    }
    assert.equal(db.prepare("SELECT COUNT(*) count FROM show_attendance WHERE show_id=?")
      .get(f.saved.showId).count, 1);
  });
}

test("fresh Here resolves provider-only Show sources and fails closed when missing or ambiguous", (t) => {
  const f = fixture(t);
  db.prepare("UPDATE shows SET tour_date_id=NULL WHERE id=?").run(f.saved.showId);
  const live = f.post(f.addUser("provider_only"), { key: f.alias, state: "here" });
  assert.equal(live.showId, f.saved.showId, "provider fallback preserves the already allocated identity");
  db.prepare("UPDATE shows SET tour_date_id=NULL WHERE id=?").run(f.saved.showId);
  db.prepare(`INSERT INTO tour_dates (id,artist,venue,date,source,provider_event_id,updated_at)
    VALUES (?,?,'Other Hall',?,'ticketmaster',?,?)`).run(
    `${f.record.id}_duplicate`, f.record.artist, f.record.date, f.record.provider_event_id, AT,
  );
  assert.throws(() => f.post(f.addUser("ambiguous"), { key: f.saved.showId, state: "here" }),
    (error) => error.status === 409 && error.code === "CHECK_IN_UNAVAILABLE");
  db.prepare("DELETE FROM tour_dates WHERE source='ticketmaster' AND provider_event_id=?")
    .run(f.record.provider_event_id);
  assert.throws(() => f.post(f.addUser("missing"), { key: f.alias, state: "here" }),
    (error) => error.status === 409 && error.code === "CHECK_IN_UNAVAILABLE");
});

test("exact Here can claim a proven legacy Going identity without allocating another Show", (t) => {
  const f = fixture(t);
  const event = { ...f.record, id: `${f.record.id}_legacy`,
    provider_event_id: `${f.record.provider_event_id}_legacy`, venue: "Legacy Claim Hall" };
  upsertProviderTourDateRows(db, [event], { seenAt: AT });
  const legacy = f.post(f.owner, {
    key: `${event.artist}|${event.venue}|${event.date}`, artist: event.artist,
    venue: event.venue, date: event.date, state: "going",
  });
  const live = f.post(f.owner, { tourDateId: event.id, state: "here" });
  assert.equal(live.showId, legacy.showId);
  assert.equal(live.attendance.createdAt, legacy.attendance.createdAt);
  assert.equal(live.attendance.state, "here");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM shows WHERE tour_date_id=?").get(event.id).count, 1);
});

for (const reassignment of ["owner", "provider", "provider_event"]) {
  test(`fresh Here rejects ${reassignment} reassignment behind an allocated Show`, (t) => {
    const f = fixture(t);
    const newOwner = f.addUser("new_owner");
    if (reassignment === "owner") {
      db.prepare("UPDATE tour_dates SET owner_id=? WHERE id=?").run(newOwner.id, f.record.id);
    } else if (reassignment === "provider") {
      db.prepare("UPDATE tour_dates SET source='bandsintown' WHERE id=?").run(f.record.id);
    } else {
      db.prepare("UPDATE tour_dates SET provider_event_id='different-event' WHERE id=?").run(f.record.id);
    }
    const stored = db.prepare("SELECT * FROM shows WHERE id=?").get(f.saved.showId);
    for (const identity of f.identities) {
      assert.throws(() => f.post(newOwner, { ...identity, state: "here" }),
        (error) => [404, 409].includes(error.status));
    }
    assert.deepEqual(db.prepare("SELECT * FROM shows WHERE id=?").get(f.saved.showId), stored);
    assert.equal(db.prepare("SELECT COUNT(*) count FROM show_attendance WHERE show_id=?")
      .get(f.saved.showId).count, 1);
  });
}

test("elapsed allocation becomes eligible in time, while saved Here privacy and removal survive source deletion", (t) => {
  const f = fixture(t, { startsAt: AT + HOUR });
  assert.equal(f.read(f.saved.showId).lifecycle, "upcoming");
  f.setNow(AT + 2 * HOUR);
  const live = f.post(f.owner, { key: f.saved.showId, state: "here", visibility: "members" });
  assert.equal(live.showId, f.saved.showId);
  const before = db.prepare("SELECT * FROM show_attendance WHERE user_id=?").get(f.owner.id);
  db.prepare("DELETE FROM tour_dates WHERE id=?").run(f.record.id);
  f.setNow(AT + 30 * HOUR);
  const retry = f.post(f.owner, { key: f.alias, state: "here" });
  assert.equal(retry.attendance.checkedInAt, live.attendance.checkedInAt);
  assert.equal(retry.attendance.updatedAt, live.attendance.updatedAt);
  const privateHere = f.post(f.owner, { key: f.saved.showId, visibility: "private" });
  assert.equal(privateHere.attendance.checkedInAt, live.attendance.checkedInAt);
  const afterPrivacy = db.prepare("SELECT * FROM show_attendance WHERE user_id=?").get(f.owner.id);
  for (const column of ["legacy_artist", "legacy_venue", "legacy_date", "created_at"]) {
    assert.equal(afterPrivacy[column], before[column]);
  }
  assert.throws(() => f.post(f.addUser("deleted_source"), { key: f.saved.showId, state: "here" }),
    (error) => error.status === 404 && error.code === "NOT_FOUND");
  assert.equal(f.post(f.owner, { key: f.alias, state: "went" }).state, "went");
  assert.equal(f.post(f.owner, { key: f.saved.showId, state: null }).attendance, null);
});
