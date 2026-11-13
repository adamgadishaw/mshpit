import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { exportLocalAlerts, eraseLocalAlerts } from "./features/localEventAlerts/localAlertPrivacy.js";
import { persistLocalAlertSale } from "./features/localEventAlerts/localAlertIngestion.js";
import { createLocalPushDevices } from "./features/localEventAlerts/localPushDevices.js";
import { withImmediateWrite } from "./databaseTransaction.js";
import { notifyFollowers, ensureArtistUpdatesSchema } from "./features/artistUpdates/artistUpdatesService.js";

const directory = mkdtempSync(join(tmpdir(), "pit-local-alert-app-"));
process.env.PIT_DATA_DIR = directory;
process.env.LOCAL_EVENT_ALERTS_ENABLED = "1";
const { db, q } = await import("./db.js");
const { routes, localAlerts } = await import("./api.js");
const { createSession, destroySession, hashPassword } = await import("./auth.js");
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
beforeEach(() => { db.prepare("DELETE FROM tour_dates").run(); });
let sequence = 0;
const day = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
function account(home = "Toronto, Ontario, Canada") {
  const id = `alert_member_${++sequence}`;
  q.insertUser.run(id, `${id}@example.test`, id, id, "unused", "fan", home, 43, -79, "QA", "#123456", Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,favorite_artists='[\"Radiohead\"]' WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
function event(patch = {}) {
  const id = `tm_alert_fixture_${++sequence}`;
  const value = { id, artist: "Radiohead", artist_key: "radiohead", venue: "Fixture Hall", place: "Toronto, Ontario, Canada", date: day,
    source: "ticketmaster", provider_event_id: id.slice(3), event_status: "onsale", venue_city: "Toronto", venue_region: "ON", venue_country_code: "CA",
    music_qualified: 1, event_kind: "concert", ticket_url: "https://www.ticketmaster.com/fixture", updated_at: Date.now(), release_at: 0, ...patch };
  db.prepare(`INSERT INTO tour_dates(${Object.keys(value).join(",")}) VALUES (${Object.keys(value).map(() => "?").join(",")})`).run(...Object.values(value));
  return value;
}
const context = (user, extra = {}) => ({ user: q.userById.get(user.id), query: {}, assertCurrentSession: () => q.userById.get(user.id), ...extra });
const page = (user, query = {}) => routes["GET /api/me/notifications"](context(user, { query }));
const alertsFor = (user, id) => db.prepare("SELECT * FROM local_event_alerts WHERE account_id=? AND event_id=? ORDER BY kind").all(user.id, id);
const tick = () => localAlerts.runtime.tick({ events: 50, recipients: 100 });

test("mounted runtime announces global dates and home-city public sales into existing Activity exactly once", () => {
  const local = account(), remote = account("Vancouver, British Columbia, Canada"), missing = account("");
  const show = event();
  withImmediateWrite(db, () => persistLocalAlertSale(db, { ...show, public_sale_evidence: { startDateTime: new Date(Date.now() - 1000).toISOString(), startTBD: false } }, Date.now()));
  tick(); tick();
  assert.equal(alertsFor(local, show.id).length, 2);
  assert.deepEqual(alertsFor(remote, show.id).map(row => row.kind), ["date"]);
  assert.deepEqual(alertsFor(missing, show.id).map(row => row.kind), ["date"]);
  const rows = page(local).notifications.filter(row => row.artist === "Radiohead");
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.alertId));
  const target = routes["GET /api/me/local-alerts/:id/target"](context(local, { params: { id: rows[0].alertId } })).target;
  assert.equal(target.event.id, show.id); assert.equal(target.event.performanceEvent, true);
  assert.equal(target.event.date, day);
  assert.equal(page(remote).notifications.filter(row => row.type === "artist_tour_date").length, 1);
  assert.throws(() => routes["GET /api/me/local-alerts/:id/target"](context(remote, { params: { id: rows[0].alertId } })), /no longer available/);
});

test("cancelled and unfollowed event notices disappear before pagination, counts and scoped acknowledgement", () => {
  const user = account(), hidden = event(), visible = event(); tick();
  const hiddenNotice = alertsFor(user, hidden.id)[0].notification_id;
  db.prepare("UPDATE tour_dates SET provider_active=0 WHERE id=?").run(hidden.id);
  const first = page(user, { limit: "1" });
  assert.equal(first.notifications.length, 1); assert.equal(first.unread, 1); assert.equal(first.nextCursor, null);
  assert.notEqual(first.notifications[0].id, hiddenNotice);
  const receipt = routes["POST /api/me/notifications/read/scoped"](context(user, { body: { notificationIds: [hiddenNotice, first.notifications[0].id] } }));
  assert.deepEqual(receipt.notificationIds, [first.notifications[0].id]);
  db.prepare("UPDATE users SET favorite_artists='[]' WHERE id=?").run(user.id);
  assert.equal(page(user).notifications.length, 0);
  assert.equal(alertsFor(user, visible.id)[0].delivery_locked, 1);
});

test("settings API preserves separate channels, validates writes and queues home/follow changes", () => {
  const user = account();
  const get = routes["GET /api/me/local-alerts/preferences"](context(user));
  assert.equal(get.homeCity.path, "/city/ca/toronto"); assert.equal(get.deliveryEnabled, true);
  assert.deepEqual(get.preferences, { datesInbox: true, salesInbox: true, datesPush: false, salesPush: false });
  const set = body => routes["PUT /api/me/local-alerts/preferences"](context(user, { body }));
  assert.throws(() => set({ datesInbox: "yes" }), /notification/i);
  set({ ...get.preferences, datesInbox: false });
  const show = event(); tick();
  assert.equal(alertsFor(user, show.id).length, 0);
  db.prepare("UPDATE users SET home_city='Vancouver, British Columbia, Canada' WHERE id=?").run(user.id);
  assert.ok(db.prepare("SELECT 1 FROM local_alert_account_scans WHERE account_id=?").get(user.id));
  assert.throws(() => routes["PUT /api/me/local-alerts/preferences"]({ user, body: get.preferences }), /Log in again/);
});

test("scheduled calendar rows remain private until release, and retrying a tick cannot reannounce", () => {
  const user = account(), show = event({ release_at: Date.now() + 3600000 }); tick();
  assert.equal(alertsFor(user, show.id).length, 0);
  assert.equal(db.prepare("SELECT 1 FROM local_event_observations WHERE event_id=?").get(show.id), undefined);
  db.prepare("UPDATE tour_dates SET release_at=0 WHERE id=?").run(show.id); tick(); tick();
  assert.equal(alertsFor(user, show.id).length, 1);
});

test("ordinary credential replacement revokes outgoing device session atomically; logout retains generation fence", async () => {
  const old = account(), next = account();
  db.prepare("UPDATE users SET pass_hash=? WHERE id=?").run(hashPassword("Fixture-password-127!"), next.id);
  const session = createSession(old.id), sessionHash = createHash("sha256").update(session.token).digest("hex");
  const devices = createLocalPushDevices({ db });
  const proof = { installationId: "integration_installation_12345", secret: "a".repeat(43), expectedGeneration: 0, platform: "ios", permission: "granted", token: "ExpoPushToken[integration_fixture_123]" };
  devices.register(old.id, proof, { sessionHash, assertCurrentSession: () => old });
  let replacement;
  await routes["POST /api/login"]({ ...context(old), token: session.token, ip: "127.0.0.1", ua: "fixture", body: { email: next.email, password: "Fixture-password-127!" }, setSession: value => { replacement = value; } });
  assert.ok(replacement?.token);
  assert.equal(db.prepare("SELECT 1 FROM sessions WHERE token_hash=?").get(sessionHash), undefined);
  assert.equal(db.prepare("SELECT 1 FROM local_push_installations WHERE installation_id=?").get(proof.installationId), undefined);
  assert.equal(db.prepare("SELECT generation FROM local_push_installation_receipts WHERE installation_id=?").get(proof.installationId).generation, 1);
  destroySession(replacement.token);
  eraseLocalAlerts(db, old.id);
  const retained = db.prepare("SELECT * FROM local_push_installation_receipts WHERE installation_id=?").get(proof.installationId);
  assert.equal(retained.account_id, null); assert.equal(retained.revoked_at, null); assert.equal(retained.generation, 1);
  assert.deepEqual(exportLocalAlerts(db, old.id).devices, []);
});

test("event-aware tour delivery suppresses generic duplicates while music release notifications remain eligible", () => {
  const user = account(), sent = [];
  ensureArtistUpdatesSchema(db);
  const base = { id: "synthetic-news", artist_key: "radiohead", artist_name: "Radiohead" };
  assert.equal(notifyFollowers(db, { ...base, kind: "shows" }, { notify: id => sent.push(id) }), 0);
  assert.deepEqual(sent, []);
  notifyFollowers(db, { ...base, kind: "release" }, { notify: id => sent.push(id) });
  assert.ok(sent.includes(user.id));
});

test("orphan local notices cannot consume page slots or leak unread counts, and the owning-notice lookup is indexed", () => {
  const user = account(); event(); tick();
  const insert = db.prepare("INSERT INTO notifications(id,user_id,type,created_at) VALUES (?,?,'artist_tour_date',?)");
  for (let i = 0; i < 120; i++) insert.run(`orphan_${i}`, user.id, Date.now() + 1000);
  const result = page(user, { limit: "1" });
  assert.equal(result.notifications.length, 1); assert.equal(result.nextCursor, null); assert.equal(result.unread, 1);
  const queryPlan = db.prepare("EXPLAIN QUERY PLAN SELECT id FROM local_event_alerts WHERE notification_id=? AND account_id=? AND owns_notice=1").all("notice", user.id);
  assert.ok(queryPlan.some(row => row.detail.includes("local_event_alerts_notice")));
});
