import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createLinkedAccounts } from "../accountOnboarding/linkedAccounts.js";
import { withImmediateWrite } from "../../databaseTransaction.js";
import { ApiError } from "../../errors.js";
import { ensureLocalAlertSchema, LOCAL_ALERT_TABLES } from "./localAlertSchema.js";
import { createLocalAlertService } from "./localAlertService.js";
import { createLocalAlertAudience, creatorCalendarNoticeFor } from "./localAlertAudience.js";
import { createLocalPushDevices } from "./localPushDevices.js";
import { createLocalPushDelivery } from "./localPushDelivery.js";
import { createExpoPushTransport } from "./expoPushTransport.js";
import { localPushConfigured, startLocalAlertDelivery } from "./localPushRuntime.js";
import { localAlertRoutes } from "./localAlertRoutes.js";
import { exportLocalAlerts, eraseLocalAlerts } from "./localAlertPrivacy.js";
import { resolveAlertHomeCity, resolveAlertEventCity, exactSaleTimestamp, ticketmasterPublicSale, DEFAULT_LOCAL_ALERT_PREFERENCES } from "./localAlertPolicy.js";

const START = Date.parse("2026-11-12T12:00:00Z");
const secret = "a".repeat(43), installationId = "fixture_installation_12345";
const input = (patch = {}) => ({ installationId, secret, expectedGeneration: 0, token: "ExpoPushToken[fixturetoken12345]", platform: "ios", permission: "granted", ...patch });
function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,home_city TEXT,favorite_artists TEXT DEFAULT '[]',is_banned INTEGER DEFAULT 0,dormant_at INTEGER,suspended_until INTEGER,profile_audience TEXT DEFAULT 'everyone');
    CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,artist TEXT,artist_key TEXT,date TEXT,venue TEXT,place TEXT,owner_id TEXT,release_at INTEGER DEFAULT 0,source TEXT,provider_event_id TEXT,provider_active INTEGER DEFAULT 1,event_status TEXT DEFAULT 'onsale',venue_city TEXT,venue_region TEXT,venue_country_code TEXT,ticket_url TEXT,creator_revision INTEGER DEFAULT 0,music_evidence TEXT);
    CREATE TABLE notifications(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,actor_id TEXT,type TEXT,artist TEXT,text TEXT,post_id TEXT,created_at INTEGER);
    CREATE TABLE creator_follows(account_id TEXT,entity_type TEXT,entity_key TEXT,notify_updates INTEGER DEFAULT 1);
    CREATE TABLE fan_club_members(user_id TEXT,artist TEXT);
    CREATE TABLE artist_profiles(artist_key TEXT,owner_id TEXT,removed INTEGER DEFAULT 0);
    CREATE TABLE blocks(blocker_id TEXT,blocked_id TEXT);
    CREATE TABLE account_mutes(muter_id TEXT,muted_id TEXT);
    CREATE TABLE creator_calendar_publications(event_id TEXT,revision INTEGER,state TEXT,post_id TEXT);`);
  ensureLocalAlertSchema(db);
  let at = START;
  const now = () => at;
  const identity = value => ["fixture artist", "fixture-artist", "old alias"].includes(String(value).toLowerCase())
    ? { artistKey: "fixture artist", artist: "Fixture Artist", storageArtist: "fixture artist", aliases: ["fixture artist", "fixture-artist", "old alias"] } : null;
  const audience = createLocalAlertAudience({ db, resolveArtistIdentity: identity });
  const hidden = new Set();
  const readPublicEvent = (id, time) => hidden.has(id) ? null : db.prepare("SELECT * FROM tour_dates WHERE id=? AND release_at<=?").get(id, time);
  const restartAlerts = () => createLocalAlertService({ db, readPublicEvent, canNotifyArtist: audience, findRelatedNotice: (accountId, event) => creatorCalendarNoticeFor(db, accountId, event), now });
  const alerts = restartAlerts();
  const devices = createLocalPushDevices({ db, now });
  const account = (id = "fan", city = "Toronto, Ontario, Canada", favourites = ["Fixture Artist"]) => {
    db.prepare("INSERT INTO users(id,home_city,favorite_artists) VALUES (?,?,?)").run(id, city, JSON.stringify(favourites));
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(`session_${id}`, id, START + 60 * 86400000);
    return id;
  };
  const event = (id = "tm_1", patch = {}) => {
    const value = { id, artist: "Fixture Artist", artist_key: "fixture artist", date: "2027-01-15", venue: "Fixture Hall", place: "Toronto, Canada", source: "ticketmaster", provider_event_id: id.slice(3), venue_city: "Toronto", venue_region: "ON", venue_country_code: "CA", ticket_url: "https://tickets.example.test/show", ...patch };
    const keys = Object.keys(value);
    db.prepare(`INSERT INTO tour_dates(${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`).run(...Object.values(value));
    return id;
  };
  const authorize = accountId => ({ assertCurrentSession: () => ({ id: accountId }), sessionHash: `session_${accountId}` });
  const plan = (eventId = "tm_1", options) => { alerts.reconcileEvent(eventId, options); while (alerts.planEventPage(eventId, { limit: 2 }).more) { /* bounded by fixture account count */ } };
  const sale = (startsAt, eventId = "tm_1", extra = {}) => alerts.recordTicketmasterSale(eventId, { id: eventId.slice(3), sales: { public: { startTBD: false, startDateTime: new Date(startsAt).toISOString(), ...extra } } }, now());
  const enable = (accountId = "fan", patch = {}) => {
    alerts.setPreferences(accountId, { ...DEFAULT_LOCAL_ALERT_PREFERENCES, datesPush: true, salesPush: true }, authorize(accountId).assertCurrentSession);
    return devices.register(accountId, input(patch), authorize(accountId));
  };
  return { db, alerts, devices, now, account, event, plan, sale, enable, authorize, hidden, restartAlerts, advance: delta => { at += delta; } };
}

test("waiting sale evidence yields scheduler pages to ready global dates without duplicate delivery", t => {
  const f = fixture(t); f.account();
  for (let i = 0; i < 105; i++) {
    const id = `tm_wait${i}`; f.event(id, { event_status: "offsale" }); f.sale(START + 60000, id); f.plan(id, { baseline: true });
  }
  f.advance(60001);
  f.event("tm_ready", { venue_city: "Vancouver", venue_region: "BC", place: "Vancouver, Canada" }); f.plan("tm_ready");
  const first = f.alerts.deliverDue({ limit: 100 }); assert.equal(first.awaitingEvidence, 100); assert.equal(first.delivered, 0);
  const second = f.alerts.deliverDue({ limit: 100 }); assert.equal(second.delivered, 1); assert.equal(second.awaitingEvidence, 5);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='artist_tour_date'").get().n, 1);
  assert.equal(f.alerts.deliverDue().delivered, 0);
  f.advance(60000);
  f.db.prepare("UPDATE tour_dates SET event_status='onsale' WHERE id='tm_wait0'").run();
  f.sale(START + 60000, "tm_wait0"); f.plan("tm_wait0", { baseline: true });
  for (let i = 0; i < 3; i++) f.alerts.deliverDue();
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='local_ticket_sale'").get().n, 1);
});

test("native delivery scheduler is gated, single flight, outside SQLite and drained on stop", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.plan();
  let sends = 0;
  const env = { LOCAL_EVENT_ALERTS_ENABLED: "1", LOCAL_EVENT_PUSH_ENABLED: "1", EXPO_PUSH_ACCESS_TOKEN: "mock-only" };
  const transport = { send: async () => { assert.equal(f.db.isTransaction, false); sends++; return { status: "accepted", ticketId: "mock-ticket" }; }, receipt: async () => ({ status: "pending" }) };
  const options = { db: f.db, alerts: f.alerts, now: f.now, runtime: { tick: () => f.alerts.deliverDue() }, transport,
    coordinate: task => task(), setTimer: () => 1, clearTimer: () => {}, setRepeatingTimer: () => 2, clearRepeatingTimer: () => {} };
  assert.equal(localPushConfigured({ ...env, EXPO_PUSH_ACCESS_TOKEN: "" }), false);
  const disabled = startLocalAlertDelivery({ ...options, env: {} }); await disabled.trigger(); await disabled.stop(); assert.equal(sends, 0);
  const job = startLocalAlertDelivery({ ...options, env }); assert.equal(sends, 0);
  await Promise.all([job.trigger(), job.trigger()]); assert.equal(sends, 1); await job.stop(); await job.trigger(); assert.equal(sends, 1);
});

test("home-city identity rejects ambiguous and unstructured places", () => {
  assert.equal(resolveAlertHomeCity(" Toronto, Ontario, Canada ").path, "/city/ca/toronto");
  assert.equal(resolveAlertHomeCity("Toronto, Canada").path, "/city/ca/toronto");
  assert.equal(resolveAlertHomeCity("London"), null);
  assert.equal(resolveAlertHomeCity("Portland, United States"), null);
  assert.equal(resolveAlertHomeCity("Somewhere"), null);
  assert.equal(resolveAlertEventCity({ place: "Toronto, Canada" }), null);
  assert.equal(resolveAlertEventCity({ owner_id: "artist", music_evidence: "mshpit:creator-calendar", place: "Toronto, Canada" }).path, "/city/ca/toronto");
  assert.equal(resolveAlertHomeCity("Portland, Oregon, United States").path, resolveAlertEventCity({ venue_city: "Portland", venue_region: "OR", venue_country_code: "US" }).path);
});

test("sale evidence requires real public timestamp and explicit known start", () => {
  assert.equal(exactSaleTimestamp("2026-11-13T09:00:00-05:00"), Date.parse("2026-11-13T14:00:00Z"));
  for (const value of ["2026-11-13", "2026-11-13T09:00:00", "2026-02-30T12:00:00Z", "2026-99-01T12:00:00Z", "bad"]) assert.equal(exactSaleTimestamp(value), null);
  for (const sale of [{}, { startTBD: true, startDateTime: "2026-11-13T12:00:00Z" }]) assert.equal(ticketmasterPublicSale({ id: "1", sales: { public: sale } }), null);
  assert.equal(ticketmasterPublicSale({ id: "1", sales: { public: { startDateTime: "2026-11-13T12:00:00Z" } } }).startsAt, Date.parse("2026-11-13T12:00:00Z"));
  assert.equal(ticketmasterPublicSale({ id: "1", sales: { presales: [{ startDateTime: "2026-11-13T12:00:00Z" }] }, dates: { access: { startDateTime: "2026-11-13T12:00:00Z" } } }), null);
});

test("tour announcements remain global, including missing or ambiguous home cities", t => {
  const f = fixture(t); f.account(); f.account("remote", "London, England, United Kingdom"); f.account("ambiguous", "London"); f.account("missing", ""); f.account("notfollowing", "Toronto", []); f.event();
  f.plan(); assert.equal(f.alerts.deliverDue().delivered, 4);
  f.plan(); assert.equal(f.alerts.deliverDue().delivered, 0);
  assert.deepEqual(f.db.prepare("SELECT user_id FROM notifications ORDER BY user_id").all().map(row => row.user_id), ["ambiguous", "fan", "missing", "remote"]);
  assert.equal(f.db.prepare("SELECT type FROM notifications").get().type, "artist_tour_date");
});

test("historical fan-club alias follows canonical artist, mute overrides it", t => {
  const f = fixture(t); f.account("club", "Toronto", []); f.account("muted", "Toronto", []); f.event();
  f.db.exec("INSERT INTO fan_club_members VALUES ('club','old alias'),('muted','fixture-artist'); INSERT INTO creator_follows VALUES ('muted','artist','fixture artist',0)");
  f.plan(); f.alerts.deliverDue();
  assert.deepEqual(f.db.prepare("SELECT user_id FROM notifications").all().map(r => r.user_id), ["club"]);
});

test("initial catalogue scan is quiet but schedules future public sales", t => {
  const f = fixture(t); f.account(); f.event(); f.sale(START + 60_000); f.plan("tm_1", { baseline: true });
  assert.deepEqual(f.db.prepare("SELECT kind FROM local_event_alerts").all().map(r => r.kind), ["sale"]);
  assert.equal(f.alerts.deliverDue().delivered, 0); f.advance(60_000);
  assert.equal(f.alerts.deliverDue().delivered, 1);
  assert.equal(f.db.prepare("SELECT type FROM notifications").get().type, "local_ticket_sale");
});

test("bounded recipient cursor survives restart without duplicate notices", t => {
  const f = fixture(t); for (let i = 0; i < 7; i++) f.account(`fan${i}`); f.event();
  f.alerts.reconcileEvent("tm_1"); assert.equal(f.alerts.planEventPage("tm_1", { limit: 2 }).planned, 2);
  f.alerts.reconcileEvent("tm_1"); f.plan(); f.alerts.deliverDue();
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 7);
});

for (const mutation of ["unfollow", "banned", "hidden", "cancelled", "date", "deleted", "mute", "block"]) test(`recheck ${mutation} before delivery`, t => {
  const f = fixture(t); f.account(); f.account("owner", "Toronto", []); f.event(); f.enable(); f.plan();
  f.db.exec("INSERT INTO artist_profiles VALUES ('fixture artist','owner',0)");
  if (mutation === "unfollow") f.db.exec("UPDATE users SET favorite_artists='[]' WHERE id='fan'");
  if (mutation === "banned") f.db.exec("UPDATE users SET is_banned=1 WHERE id='fan'");
  if (mutation === "hidden") f.hidden.add("tm_1");
  if (mutation === "cancelled") f.db.exec("UPDATE tour_dates SET event_status='cancelled'");
  if (mutation === "date") f.db.exec("UPDATE tour_dates SET date='2027-01-16'");
  if (mutation === "deleted") f.db.exec("DELETE FROM tour_dates");
  if (mutation === "mute") f.db.exec("INSERT INTO account_mutes VALUES ('fan','owner')");
  if (mutation === "block") f.db.exec("INSERT INTO blocks VALUES ('owner','fan')");
  assert.equal(f.alerts.deliverDue().delivered, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox").get().n, 0);
});

test("private scheduled calendar cannot be observed or announced until publication", t => {
  const f = fixture(t); f.account(); f.event("creator_1", { owner_id: "artist", source: "artist", release_at: START + 10_000 });
  f.plan("creator_1"); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_event_observations").get().n, 0);
  f.advance(10_000); f.plan("creator_1"); assert.equal(f.alerts.deliverDue().delivered, 1);
});

test("calendar announcement reuses its existing creator inbox notice", t => {
  const f = fixture(t); f.account(); f.event();
  f.db.exec("INSERT INTO notifications(id,user_id,type,post_id,created_at) VALUES ('creator_notice','fan','creator_update','post1',1); INSERT INTO creator_calendar_publications VALUES ('tm_1',1,'published','post1')");
  f.plan(); f.alerts.deliverDue();
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 1);
  assert.equal(f.db.prepare("SELECT notification_id,owns_notice FROM local_event_alerts").get().notification_id, "creator_notice");
  f.db.exec("UPDATE tour_dates SET event_status='cancelled'"); f.alerts.reconcileEvent("tm_1");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 1);
});

test("lost response, inbox insertion failure and retry roll back atomically", t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.plan();
  f.db.exec("CREATE TRIGGER fail_push BEFORE INSERT ON local_push_outbox BEGIN SELECT RAISE(ABORT,'fixture rollback'); END");
  assert.throws(() => f.alerts.deliverDue(), /fixture rollback/);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 0);
  assert.equal(f.db.prepare("SELECT state FROM local_event_alerts").get().state, "queued");
  assert.equal(f.db.prepare("SELECT delivery_locked FROM local_event_alerts").get().delivery_locked, 0);
  f.db.exec("DROP TRIGGER fail_push"); f.alerts.deliverDue(); f.alerts.deliverDue();
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox").get().n, 1);
  assert.equal(f.db.prepare("SELECT delivery_locked FROM local_event_alerts").get().delivery_locked, 1);
});

test("sale changes cancel old reminders and out-of-order provider responses cannot restore them", t => {
  const f = fixture(t); f.account(); f.event(); f.sale(START + 100_000); f.plan("tm_1", { baseline: true });
  f.advance(1000); f.sale(START + 200_000); f.plan();
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_event_alerts WHERE state='cancelled'").get().n, 1);
  assert.equal(f.alerts.recordTicketmasterSale("tm_1", { id: "1" }, START).updated, false);
  f.advance(99_000); assert.equal(f.alerts.deliverDue().delivered, 0);
  f.advance(100_000); assert.equal(f.alerts.deliverDue().delivered, 1);
});

test("unknown or removed sale evidence cancels a pending reminder", t => {
  const f = fixture(t); f.account(); f.event(); f.sale(START + 1000); f.plan("tm_1", { baseline: true });
  f.advance(500); f.alerts.recordTicketmasterSale("tm_1", { id: "1", sales: { public: { startTBD: true } } });
  f.advance(1000); assert.equal(f.alerts.deliverDue().delivered, 0);
});

test("old sales are not announced; stale evidence waits for a trusted refresh", t => {
  const f = fixture(t); f.account(); f.event(); f.sale(START + 2 * 86400000); f.plan("tm_1", { baseline: true });
  f.advance(2 * 86400000); assert.equal(f.alerts.deliverDue().awaitingEvidence, 1);
  f.sale(START + 2 * 86400000); assert.equal(f.alerts.deliverDue().delivered, 1);
  f.event("tm_2"); f.sale(START, "tm_2"); f.plan("tm_2", { baseline: true });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_event_alerts WHERE event_id='tm_2'").get().n, 0);
});

test("sale source and event owner cannot be spoofed", t => {
  const f = fixture(t); f.event("tm_1", { owner_id: "artist" });
  assert.throws(() => f.sale(START), e => e.status === 409);
  f.event("tm_2"); assert.throws(() => f.alerts.recordTicketmasterSale("tm_2", { id: "1" }), e => e.status === 409);
});

test("preferences are independent per channel; late opt-out stops queued push", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable();
  f.alerts.setPreferences("fan", { datesInbox: false, salesInbox: true, datesPush: true, salesPush: false }, f.authorize("fan").assertCurrentSession);
  f.plan(); f.alerts.deliverDue(); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox").get().n, 1);
  f.alerts.setPreferences("fan", { ...DEFAULT_LOCAL_ALERT_PREFERENCES }, f.authorize("fan").assertCurrentSession);
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: { send: () => assert.fail("opted out") } });
  await worker.run(); assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "cancelled");
});

test("device proof, exact account/session and compare-and-set protect registration", t => {
  const f = fixture(t); f.account(); f.account("other");
  assert.throws(() => f.devices.register("fan", input({ permission: "denied" }), f.authorize("fan")), e => e.status === 400);
  assert.throws(() => f.devices.register("fan", input(), f.authorize("other")), e => e.status === 401);
  const first = f.enable(); assert.equal(first.generation, 1);
  assert.equal(f.devices.register("fan", input(), f.authorize("fan")).generation, 1);
  assert.throws(() => f.devices.register("other", input({ secret: "b".repeat(43), expectedGeneration: 1 }), f.authorize("other")), e => e.status === 403);
  assert.throws(() => f.devices.register("other", input(), f.authorize("other")), e => e.status === 409);
  assert.equal(f.devices.binding("other", input(), f.authorize("other").assertCurrentSession).generation, 1);
  assert.equal(f.devices.register("other", input({ expectedGeneration: 1 }), f.authorize("other")).generation, 2);
  assert.throws(() => f.devices.register("fan", input({ expectedGeneration: 1 }), f.authorize("fan")), e => e.status === 409);
  assert.throws(() => f.devices.register("fan", input({ installationId: "another_installation_234" }), f.authorize("fan")), e => e.status === 409);
});

test("A to B to guest cancels queued push and deleting session cascades device secrets", async t => {
  const f = fixture(t); f.account(); f.account("other"); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  f.devices.register("other", input({ expectedGeneration: 1 }), f.authorize("other"));
  assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "cancelled");
  f.db.exec("DELETE FROM sessions WHERE user_id='other'");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_installations").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox").get().n, 0);
});

test("push worker is disabled by default and only sends once after explicit enable", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  const messages = [], transport = { send: async message => { messages.push(message); return { status: "accepted", ticketId: "ticket1" }; }, receipt: async () => ({ status: "delivered" }) };
  await createLocalPushDelivery({ db: f.db, alerts: f.alerts, transport, now: f.now }).run(); assert.equal(messages.length, 0);
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, transport, enabled: true, now: f.now });
  await Promise.all([worker.run(), worker.run()]); assert.equal(messages.length, 1);
  assert.equal(messages[0].body.includes("Toronto"), false); assert.equal(messages[0].data.accountId, undefined);
  assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "accepted");
  f.advance(15 * 60_000); await worker.run(); assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "delivered");
  await worker.stop(); assert.deepEqual(await worker.run(), { disabled: true });
});

for (const outcome of ["timeout", "rate", "unregistered", "crash"]) test(`push ${outcome} has explicit bounded delivery semantics`, async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  let calls = 0;
  if (outcome === "crash") f.db.prepare("UPDATE local_push_outbox SET state='sending',lease_until=?").run(START - 1);
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: {
    send: async () => { calls++; if (outcome === "timeout") throw Error("private token must not leak"); return { status: "rejected", code: outcome === "rate" ? "RateLimited" : "DeviceNotRegistered" }; },
  } });
  await worker.run(); const row = f.db.prepare("SELECT * FROM local_push_outbox").get();
  assert.equal(row.state, outcome === "rate" ? "ready" : outcome === "unregistered" ? "failed" : "unknown");
  await worker.run(); assert.equal(calls, outcome === "crash" ? 0 : 1);
  if (outcome === "unregistered") assert.equal(f.db.prepare("SELECT enabled FROM local_push_installations").get().enabled, 0);
});

test("revocation during transport cannot attach an old result to a new account", async t => {
  const f = fixture(t); f.account(); f.account("other"); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: { send: async () => {
    f.devices.register("other", input({ expectedGeneration: 1 }), f.authorize("other"));
    return { status: "accepted", ticketId: "old" };
  } } });
  await worker.run(); assert.equal(f.db.prepare("SELECT state,ticket_id FROM local_push_outbox").get().state, "cancelled");
  assert.equal(f.db.prepare("SELECT ticket_id FROM local_push_outbox").get().ticket_id, null);
});

test("route guards, target ownership, GET read-only and export/delete privacy", t => {
  const f = fixture(t); f.account(); f.account("other"); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  const routes = localAlertRoutes({ requireUser: ctx => { if (!ctx.user) throw Error("AUTH_REQUIRED"); return ctx.user; }, alerts: f.alerts, devices: f.devices, sessionHashForRequest: ctx => `session_${ctx.user.id}` });
  const context = { user: { id: "fan", home_city: "Toronto" }, body: { ...DEFAULT_LOCAL_ALERT_PREFERENCES } };
  assert.throws(() => routes["PUT /api/me/local-alerts/preferences"](context), e => e.status === 401);
  const before = f.db.prepare("SELECT total_changes() n").get().n;
  routes["GET /api/me/local-alerts/preferences"](context);
  assert.equal(f.db.prepare("SELECT total_changes() n").get().n, before);
  const id = f.db.prepare("SELECT id FROM local_event_alerts WHERE account_id='fan'").get().id;
  assert.equal(f.alerts.readAlertTarget("fan", id).eventId, "tm_1"); assert.equal(f.alerts.readAlertTarget("other", id), null);
  const exportData = exportLocalAlerts(f.db, "fan");
  assert.equal(exportData.pushDeliveries.length, 1); assert.equal(exportData.pushDeliveries[0].state, "ready");
  const exported = JSON.stringify(exportData);
  for (const value of [secret, "ExpoPushToken", "session_fan", "secret_hash", "city_path"]) assert.equal(exported.includes(value), false);
  eraseLocalAlerts(f.db, "fan");
  for (const table of ["local_event_alerts", "local_push_installations", "local_alert_preferences"]) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE account_id='fan'`).get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_installation_receipts WHERE account_id='fan'").get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='fan'").get().n, 0);
  ensureLocalAlertSchema(f.db); assert.equal(LOCAL_ALERT_TABLES.length, 8);
});

test("a new follower gets future sale reminders without a historical date announcement", t => {
  const f = fixture(t); f.account("fan", "Toronto", []); f.event(); f.sale(START + 60_000); f.plan("tm_1", { baseline: true });
  f.db.exec("UPDATE users SET favorite_artists='[\"Fixture Artist\"]' WHERE id='fan'");
  f.alerts.requestAccountScan("fan"); assert.equal(f.alerts.planAccountSalesPage("fan", { limit: 1 }).planned, 1);
  f.alerts.planAccountSalesPage("fan"); f.advance(60_000); f.alerts.deliverDue();
  assert.deepEqual(f.db.prepare("SELECT type FROM notifications").all().map(row => row.type), ["local_ticket_sale"]);
  f.alerts.requestAccountScan("fan"); f.alerts.planAccountSalesPage("fan"); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_event_alerts").get().n, 1);
});

test("Expo adapter distinguishes tickets, receipts, failures and unknown HTTP outcomes", async () => {
  const responses = [
    { ok: true, data: { data: { status: "ok", id: "ticket" } } },
    { ok: true, data: { data: { ticket: { status: "ok" } } } },
    { ok: false, status: 429 }, { ok: false, status: 503 },
    { ok: true, data: { data: { status: "error", details: { error: "DeviceNotRegistered" } } } },
  ];
  const requests = [];
  const transport = createExpoPushTransport({ fetchImpl: async (url, options) => { requests.push({ url, options }); const row = responses.shift(); return { ...row, json: async () => row.data }; } });
  assert.deepEqual(await transport.send({ to: "fixture" }), { status: "accepted", ticketId: "ticket" });
  assert.deepEqual(await transport.receipt("ticket"), { status: "delivered" });
  assert.equal((await transport.send({})).code, "RateLimited"); assert.equal((await transport.send({})).status, "unknown");
  assert.equal((await transport.send({})).code, "DeviceNotRegistered");
  assert.equal(requests[0].url, "https://exp.host/--/api/v2/push/send"); assert.ok(requests[0].options.signal);
});

test("two worker instances claim one durable send, then honour receipt errors", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  let sends = 0;
  const transport = { send: async () => { sends++; await new Promise(resolve => setImmediate(resolve)); return { status: "accepted", ticketId: "receipt" }; }, receipt: async () => ({ status: "rejected", code: "DeviceNotRegistered" }) };
  const options = { db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport };
  const first = createLocalPushDelivery(options), second = createLocalPushDelivery(options);
  await Promise.all([first.run(), second.run()]); assert.equal(sends, 1);
  f.advance(15 * 60_000); await first.run();
  assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "failed");
  assert.equal(f.db.prepare("SELECT enabled FROM local_push_installations").get().enabled, 0);
});

test("Expo preserves explicit MessageRateExceeded and leaves missing/error receipt lookups pending", async () => {
  const replies = [
    { ok: true, data: { data: { ticket: { status: "error", details: { error: "MessageRateExceeded" } } } } },
    { ok: false, status: 429 }, { ok: false, status: 503 }, { ok: true, data: { data: {} } },
    { ok: true, data: { data: { status: "error", details: { error: "MessageRateExceeded" } } } },
  ];
  const adapter = createExpoPushTransport({ fetchImpl: async () => { const value = replies.shift(); return { ...value, json: async () => value.data }; } });
  assert.deepEqual(await adapter.receipt("ticket"), { status: "rejected", code: "MessageRateExceeded" });
  for (let i = 0; i < 3; i++) assert.deepEqual(await adapter.receipt("ticket"), { status: "pending" });
  assert.deepEqual(await adapter.send({}), { status: "rejected", code: "MessageRateExceeded" });
});

test("accepted ticket with definite device rate rejection retries exponentially up to four sends", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  let sends = 0;
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: {
    send: async () => ({ status: "accepted", ticketId: `attempt-${++sends}` }),
    receipt: async () => ({ status: "rejected", code: "MessageRateExceeded" }),
  } });
  const row = () => f.db.prepare("SELECT * FROM local_push_outbox").get();
  await worker.run();
  for (let attempt = 1; attempt <= 4; attempt++) {
    assert.equal(sends, attempt); f.advance(15 * 60000); await worker.run();
    if (attempt === 4) { assert.equal(row().state, "failed"); break; }
    assert.equal(row().state, "ready"); assert.equal(row().ticket_id, null); assert.equal(row().attempts, attempt);
    assert.equal(row().next_at - f.now(), 60000 * 2 ** attempt);
    f.advance(60000 * 2 ** attempt - 1); await worker.run(); assert.equal(sends, attempt);
    f.advance(1); await worker.run(); assert.equal(row().state, "accepted");
  }
  f.advance(86400000); await worker.run(); assert.equal(sends, 4);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 1);
});

test("receipt retry rechecks opt-out and never rearms unknown sends", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  let sends = 0, mode = "accepted";
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: {
    send: async () => { sends++; return mode === "accepted" ? { status: "accepted", ticketId: "ticket" } : { status: "unknown" }; },
    receipt: async () => ({ status: "rejected", code: "MessageRateExceeded" }),
  } });
  await worker.run(); f.advance(15 * 60000); await worker.run();
  mode = "unknown"; f.advance(120000); await worker.run(); assert.equal(sends, 2);
  f.advance(15 * 60000); await worker.run(); assert.equal(sends, 2); assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "unknown");
  // Independent second installation becomes ineligible while waiting to retry.
  f.enable("fan", { installationId: "second_fixture_installation", token: "ExpoPushToken[fixturesecond12345]" });
  f.event("tm_2"); f.plan("tm_2"); f.alerts.deliverDue(); mode = "accepted"; await worker.run();
  f.advance(15 * 60000); await worker.run(); const before = sends;
  f.alerts.setPreferences("fan", { ...DEFAULT_LOCAL_ALERT_PREFERENCES, datesPush: false, salesPush: false }, f.authorize("fan").assertCurrentSession);
  f.advance(120000); await worker.run(); assert.equal(sends, before);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox WHERE state='ready'").get().n, 0);
});

test("late receipt from an older attempt cannot alter a newer accepted ticket", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  let resolveOld, receiptStarted, sends = 0;
  const old = new Promise(resolve => { resolveOld = resolve; }), started = new Promise(resolve => { receiptStarted = resolve; });
  const common = { db: f.db, alerts: f.alerts, enabled: true, now: f.now };
  const sender = async () => ({ status: "accepted", ticketId: `ticket-${++sends}` });
  const slow = createLocalPushDelivery({ ...common, transport: { send: sender, receipt: () => { receiptStarted(); return old; } } });
  const fast = createLocalPushDelivery({ ...common, transport: { send: sender, receipt: async () => ({ status: "rejected", code: "MessageRateExceeded" }) } });
  await slow.run(); f.advance(15 * 60000); const pending = slow.run(); await started;
  await fast.run(); f.advance(120000); await fast.run(); assert.equal(sends, 2);
  resolveOld({ status: "rejected", code: "MessageRateExceeded" }); await pending;
  const row = f.db.prepare("SELECT state,ticket_id,attempts FROM local_push_outbox").get();
  assert.equal(row.state, "accepted"); assert.equal(row.ticket_id, "ticket-2"); assert.equal(row.attempts, 2);
});

test("read and push targets reject an artist hold after inbox delivery", t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  const id = f.db.prepare("SELECT id FROM local_event_alerts").get().id;
  assert.ok(f.alerts.readAlertTarget("fan", id));
  f.hidden.add("tm_1"); assert.equal(f.alerts.readAlertTarget("fan", id), null);
  assert.equal(f.alerts.readAlertTarget("fan", id, { forPush: true }), null);
});

test("ticket sales use home city; moving after planning cancels only the sale reminder", t => {
  const f = fixture(t); f.account(); f.account("remote", "Vancouver, Canada"); f.account("unknown", "London"); f.event(); f.sale(START + 1000); f.plan();
  assert.deepEqual(f.db.prepare("SELECT account_id FROM local_event_alerts WHERE kind='sale'").all().map(row => row.account_id), ["fan"]);
  f.db.exec("UPDATE users SET home_city='Vancouver, Canada' WHERE id='fan'"); f.advance(1000);
  assert.deepEqual(f.alerts.deliverDue(), { delivered: 3, cancelled: 1, awaitingEvidence: 0 });
  assert.deepEqual(f.db.prepare("SELECT DISTINCT type FROM notifications").all().map(row => row.type), ["artist_tour_date"]);
});

test("unstructured event city does not silence an otherwise canonical tour announcement", t => {
  const f = fixture(t); f.account("fan", ""); f.event("tm_1", { venue_city: null, venue_country_code: null });
  f.sale(START + 1000); f.plan(); assert.equal(f.alerts.deliverDue().delivered, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_event_alerts WHERE kind='sale'").get().n, 0);
});

for (const field of ["ticket_url", "venue"]) test(`same-time sale survives a ${field} edit with one stable reminder`, t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.sale(START + 1000); f.plan("tm_1", { baseline: true });
  const original = f.db.prepare("SELECT * FROM local_event_alerts WHERE kind='sale'").get();
  f.db.prepare(`UPDATE tour_dates SET ${field}=? WHERE id='tm_1'`).run(field === "venue" ? "Updated Hall" : "https://tickets.example.test/updated");
  f.plan(); f.plan();
  const updated = f.db.prepare("SELECT * FROM local_event_alerts WHERE kind='sale'").get();
  assert.equal(updated.id, original.id); assert.equal(updated.state, "queued");
  assert.notEqual(updated.fingerprint, original.fingerprint); assert.equal(updated.due_at, original.due_at);
  f.advance(1000); assert.equal(f.alerts.deliverDue().delivered, 1); assert.equal(f.alerts.deliverDue().delivered, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox").get().n, 1);
});

test("account sales scan can repair an undelivered same-time reminder", t => {
  const f = fixture(t); f.account(); f.event(); f.sale(START + 1000); f.plan("tm_1", { baseline: true });
  const original = f.db.prepare("SELECT id FROM local_event_alerts").get().id;
  f.db.exec("UPDATE tour_dates SET venue='Updated Hall'"); f.alerts.reconcileEvent("tm_1");
  f.alerts.requestAccountScan("fan"); f.alerts.planAccountSalesPage("fan");
  const row = f.db.prepare("SELECT * FROM local_event_alerts").get(); assert.equal(row.id, original); assert.equal(row.state, "queued");
  f.advance(1000); assert.equal(f.alerts.deliverDue().delivered, 1);
});

for (const transportState of ["accepted", "unknown"]) test(`committed sale cannot replay after metadata edits (${transportState})`, async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.sale(START + 1000); f.plan("tm_1", { baseline: true });
  f.advance(1000); f.alerts.deliverDue();
  let sends = 0;
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: {
    send: async () => { sends++; return transportState === "unknown" ? { status: "unknown" } : { status: "accepted", ticketId: "fixture-ticket" }; },
  } });
  await worker.run();
  const outbox = f.db.prepare("SELECT * FROM local_push_outbox").get();
  const notice = f.db.prepare("SELECT * FROM notifications").get();
  f.db.exec("UPDATE tour_dates SET ticket_url='https://tickets.example.test/revised'"); f.plan();
  f.alerts.requestAccountScan("fan"); f.alerts.planAccountSalesPage("fan");
  assert.equal(f.alerts.deliverDue().delivered, 0); await worker.run();
  assert.equal(sends, 1);
  assert.deepEqual(f.db.prepare("SELECT * FROM local_push_outbox").get(), outbox);
  assert.deepEqual(f.db.prepare("SELECT * FROM notifications").get(), notice);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_event_alerts").get().n, 1);
  assert.equal(f.db.prepare("SELECT delivery_locked FROM local_event_alerts").get().delivery_locked, 1);
});

for (const kind of ["sale", "date"]) for (const inbox of [false, true]) for (const field of ["ticket_url", "venue"]) {
  test(`${kind} ${inbox ? "inbox and push" : "push only"} survives ${field} edit before its first send`, async t => {
    const f = fixture(t); f.account(); f.event(); f.enable();
    f.alerts.setPreferences("fan", { datesInbox: inbox, salesInbox: inbox, datesPush: true, salesPush: true }, f.authorize("fan").assertCurrentSession);
    if (kind === "sale") f.sale(START);
    f.plan("tm_1", { baseline: kind === "sale" }); f.alerts.deliverDue();
    const alert = f.db.prepare("SELECT * FROM local_event_alerts").get();
    const outbox = f.db.prepare("SELECT * FROM local_push_outbox").get();
    const notices = f.db.prepare("SELECT * FROM notifications").all();
    assert.equal(outbox.state, "ready"); assert.equal(outbox.attempts, 0);
    f.db.prepare(`UPDATE tour_dates SET ${field}=?`).run(field === "venue" ? "Updated Hall" : "https://tickets.example.test/revised");
    // Dispatch can race ahead of the explicit reconciliation hook. The fresh
    // target check must accept only the permitted metadata differences, read-only.
    const changes = f.db.prepare("SELECT total_changes() n").get().n;
    assert.equal(f.alerts.readAlertTarget("fan", alert.id, { forPush: true })?.eventId, "tm_1");
    assert.equal(f.db.prepare("SELECT total_changes() n").get().n, changes);
    f.plan(); f.plan(); f.alerts.requestAccountScan("fan"); f.alerts.planAccountSalesPage("fan");
    assert.equal(f.alerts.deliverDue().delivered, 0);
    assert.deepEqual(f.db.prepare("SELECT * FROM notifications").all(), notices);
    assert.deepEqual(f.db.prepare("SELECT * FROM local_push_outbox").get(), outbox);
    const updated = f.db.prepare("SELECT * FROM local_event_alerts").get();
    assert.equal(updated.id, alert.id); assert.equal(updated.delivery_locked, 1); assert.equal(updated.state, "delivered");
    assert.notEqual(updated.fingerprint, alert.fingerprint);
    let sends = 0;
    const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: {
      send: async message => { sends++; assert.equal(message.data.alertId, alert.id); return { status: "accepted", ticketId: "first-send" }; },
    } });
    await worker.run(); await worker.run();
    assert.equal(sends, 1);
    assert.equal(f.db.prepare("SELECT id FROM local_push_outbox").get().id, outbox.id);
    assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, +inbox);
  });
}

test("a metadata edit during dispatch preserves the same in-flight delivery", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.sale(START + 1000); f.plan("tm_1", { baseline: true });
  f.advance(1000); f.alerts.deliverDue(); let sends = 0;
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: { send: async () => {
    sends++; f.db.exec("UPDATE tour_dates SET venue='Changed during dispatch'"); f.plan();
    assert.equal(f.alerts.deliverDue().delivered, 0); return { status: "accepted", ticketId: "inflight-ticket" };
  } } });
  await worker.run(); await worker.run(); assert.equal(sends, 1);
  assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "accepted");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 1);
});

for (const firstOutcome of ["accepted", "unknown", "interrupted"]) test(`metadata refresh preserves independent device progress (${firstOutcome})`, async t => {
  const f = fixture(t); f.account(); f.event(); f.enable();
  f.devices.register("fan", input({ installationId: "second_installation_12345", token: "ExpoPushToken[secondfixture12345]", platform: "android" }), f.authorize("fan"));
  f.sale(START); f.plan("tm_1", { baseline: true }); f.alerts.deliverDue();
  const rows = f.db.prepare("SELECT * FROM local_push_outbox ORDER BY next_at,id").all();
  let sends = 0;
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: {
    send: async () => { sends++; return firstOutcome === "unknown" && sends === 1 ? { status: "unknown" } : { status: "accepted", ticketId: `mixed-${sends}` }; },
  } });
  if (firstOutcome === "interrupted") {
    f.db.prepare("UPDATE local_push_outbox SET state='sending',attempts=1,sent_at=?,lease_key='crashed',lease_until=? WHERE id=?")
      .run(f.now(), f.now(), rows[0].id);
  } else await worker.run({ limit: 1 });
  const before = f.db.prepare("SELECT * FROM local_push_outbox ORDER BY next_at,id").all();
  f.db.exec("UPDATE tour_dates SET venue='Updated Hall'"); f.plan();
  assert.deepEqual(f.db.prepare("SELECT * FROM local_push_outbox ORDER BY next_at,id").all(), before);
  await worker.run(); await worker.run();
  assert.equal(sends, firstOutcome === "interrupted" ? 1 : 2);
  assert.equal(f.db.prepare("SELECT state FROM local_push_outbox WHERE id=?").get(rows[0].id).state, firstOutcome === "accepted" ? "accepted" : "unknown");
  assert.equal(f.db.prepare("SELECT state FROM local_push_outbox WHERE id=?").get(rows[1].id).state, "accepted");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox").get().n, 2);
});

test("metadata edits preserve rejected-send backoff and bounded attempts", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.sale(START); f.plan("tm_1", { baseline: true }); f.alerts.deliverDue();
  let sends = 0;
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: {
    send: async () => { sends++; return { status: "rejected", code: "RateLimited" }; },
  } });
  await worker.run();
  for (let attempt = 1; attempt <= 4; attempt++) {
    const row = f.db.prepare("SELECT * FROM local_push_outbox").get();
    assert.equal(row.attempts, attempt);
    f.db.prepare("UPDATE tour_dates SET ticket_url=?").run(`https://tickets.example.test/edit-${attempt}`); f.plan();
    assert.deepEqual(f.db.prepare("SELECT * FROM local_push_outbox").get(), row);
    await worker.run(); assert.equal(sends, attempt);
    if (attempt < 4) { f.advance(row.next_at - f.now()); await worker.run(); }
  }
  assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "failed");
});

for (const change of ["date", "city", "sale-time", "hidden", "unfollow", "push-optout", "revoked", "expired"]) {
  test(`metadata refresh does not bypass ${change} before device send`, async t => {
    const f = fixture(t); f.account(); f.event(); f.enable(); f.sale(START); f.plan("tm_1", { baseline: true }); f.alerts.deliverDue();
    f.db.exec("UPDATE tour_dates SET ticket_url='https://tickets.example.test/revised'");
    if (change === "date") f.db.exec("UPDATE tour_dates SET date='2027-02-15'");
    if (change === "city") f.db.exec("UPDATE tour_dates SET venue_city='Vancouver',venue_region='BC'");
    if (change === "sale-time") { f.advance(1); f.sale(START + 60_000); }
    if (change === "hidden") f.hidden.add("tm_1");
    if (change === "unfollow") f.db.exec("UPDATE users SET favorite_artists='[]'");
    if (change === "push-optout") f.alerts.setPreferences("fan", DEFAULT_LOCAL_ALERT_PREFERENCES, f.authorize("fan").assertCurrentSession);
    if (change === "revoked") f.devices.register("fan", input({ expectedGeneration: 1, token: "ExpoPushToken[rotatedfixture12345]" }), f.authorize("fan"));
    if (change === "expired") f.advance(2 * 60 * 60_000);
    f.alerts.reconcileEvent("tm_1");
    const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: {
      send: () => assert.fail(`must not send after ${change}`),
    } });
    await worker.run();
    assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "cancelled");
    assert.equal(f.db.prepare("SELECT delivery_locked FROM local_event_alerts").get().delivery_locked, 1);
  });
}

test("a material edit during an uncertain send is never rearmed by later metadata edits", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.sale(START); f.plan("tm_1", { baseline: true }); f.alerts.deliverDue();
  let sends = 0;
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: { send: async () => {
    sends++; f.db.exec("UPDATE tour_dates SET date='2027-02-15'"); f.alerts.reconcileEvent("tm_1");
    return { status: "unknown" };
  } } });
  await worker.run();
  f.db.exec("UPDATE tour_dates SET date='2027-01-15',venue='Restored Hall'"); f.plan(); f.alerts.deliverDue(); await worker.run();
  assert.equal(sends, 1); assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "cancelled");
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 0);
});

for (const alreadyEdited of [false, true]) test(`legacy delivery snapshot is adopted only from matching evidence (edited=${alreadyEdited})`, async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.sale(START); f.plan("tm_1", { baseline: true }); f.alerts.deliverDue();
  f.db.exec("ALTER TABLE local_event_alerts DROP COLUMN delivery_fingerprint");
  ensureLocalAlertSchema(f.db); ensureLocalAlertSchema(f.db);
  assert.equal(f.db.prepare("SELECT delivery_fingerprint FROM local_event_alerts").get().delivery_fingerprint, null);
  if (!alreadyEdited) f.alerts.reconcileEvent("tm_1");
  f.db.exec("UPDATE tour_dates SET venue='Edited legacy hall'"); f.plan();
  let sends = 0;
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now, transport: {
    send: async () => { sends++; return { status: "accepted", ticketId: "legacy-ticket" }; },
  } });
  await worker.run(); await worker.run();
  assert.equal(sends, alreadyEdited ? 0 : 1);
  assert.equal(f.db.prepare("SELECT delivery_locked FROM local_event_alerts").get().delivery_locked, 1);
});

for (const restriction of ["unfollow", "city", "mute", "hidden", "cancelled"]) test(`replacement rechecks ${restriction} eligibility`, t => {
  const f = fixture(t); f.account(); f.event(); f.sale(START + 1000); f.plan("tm_1", { baseline: true });
  f.db.exec("UPDATE tour_dates SET venue='Updated Hall'");
  if (restriction === "unfollow") f.db.exec("UPDATE users SET favorite_artists='[]'");
  if (restriction === "city") f.db.exec("UPDATE users SET home_city='Vancouver, Canada'");
  if (restriction === "mute") f.db.exec("INSERT INTO creator_follows VALUES ('fan','artist','fixture artist',0)");
  if (restriction === "hidden") f.hidden.add("tm_1");
  if (restriction === "cancelled") f.db.exec("UPDATE tour_dates SET event_status='cancelled'");
  f.plan(); f.alerts.requestAccountScan("fan"); f.alerts.planAccountSalesPage("fan"); f.advance(1000);
  assert.equal(f.alerts.deliverDue().delivered, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 0);
});

test("offsale permits announcements and future reminders but cannot claim tickets are on sale", t => {
  const f = fixture(t); f.account(); f.event("tm_1", { event_status: "offsale" }); f.sale(START + 1000); f.plan();
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_event_alerts").get().n, 2);
  assert.equal(f.alerts.deliverDue().delivered, 1);
  const saleId = f.db.prepare("SELECT id FROM local_event_alerts WHERE kind='sale'").get().id;
  f.advance(1000); assert.equal(f.alerts.deliverDue().awaitingEvidence, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='local_ticket_sale'").get().n, 0);
  f.db.exec("UPDATE tour_dates SET event_status='onsale'"); f.advance(1); f.sale(START + 1000); f.plan();
  assert.equal(f.db.prepare("SELECT id FROM local_event_alerts WHERE kind='sale'").get().id, saleId);
  assert.equal(f.alerts.deliverDue().delivered, 1); assert.equal(f.alerts.deliverDue().delivered, 0);
});

test("offsale without reliable public timing never schedules a sale; elapsed reminders expire", t => {
  const f = fixture(t); f.account(); f.event("tm_1", { event_status: "offsale" }); f.plan("tm_1", { baseline: true });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_event_alerts").get().n, 0);
  f.sale(START + 1000); f.plan(); f.advance(1000 + 2 * 60 * 60_000);
  assert.equal(f.alerts.deliverDue().cancelled, 1);
  f.db.exec("UPDATE tour_dates SET event_status='onsale'"); f.plan(); assert.equal(f.alerts.deliverDue().delivered, 0);
});

test("legacy ambiguous cancellations stay locked while queued reminders migrate safely", t => {
  const f = fixture(t); f.account(); f.event(); f.sale(START + 1000); f.plan();
  f.db.exec("DROP TRIGGER local_alert_lock_delivery; DROP TRIGGER local_alert_keep_delivery_lock; ALTER TABLE local_event_alerts DROP COLUMN delivery_locked; UPDATE local_event_alerts SET state='cancelled' WHERE kind='date'");
  ensureLocalAlertSchema(f.db); ensureLocalAlertSchema(f.db);
  assert.equal(f.db.prepare("SELECT delivery_locked FROM local_event_alerts WHERE kind='date'").get().delivery_locked, 1);
  assert.equal(f.db.prepare("SELECT delivery_locked FROM local_event_alerts WHERE kind='sale'").get().delivery_locked, 0);
  f.db.exec("UPDATE tour_dates SET venue='Migration update'"); f.plan(); f.advance(1000);
  assert.equal(f.alerts.deliverDue().delivered, 1);
});

test("delivery receipt survives schema restart, legacy state writes and attempted reset", t => {
  const f = fixture(t); f.account(); f.event(); f.sale(START + 1000); f.plan("tm_1", { baseline: true });
  // An older writer does not know the receipt column but still transitions the
  // durable row through delivered before it can cancel a notice.
  f.db.exec("UPDATE local_event_alerts SET state='delivered'; UPDATE local_event_alerts SET state='cancelled'");
  ensureLocalAlertSchema(f.db);
  assert.equal(f.db.prepare("SELECT delivery_locked FROM local_event_alerts").get().delivery_locked, 1);
  assert.throws(() => f.db.exec("UPDATE local_event_alerts SET delivery_locked=0"), /committed alert cannot be replayed/);
  f.db.exec("UPDATE tour_dates SET venue='Later update'"); f.plan(); f.advance(1000);
  assert.equal(f.alerts.deliverDue().delivered, 0);
});

test("sale status is rechecked after inbox commit and before a queued push", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable(); f.sale(START + 1000); f.plan("tm_1", { baseline: true });
  f.advance(1000); f.alerts.deliverDue();
  f.db.exec("UPDATE tour_dates SET event_status='offsale'");
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now,
    transport: { send: () => assert.fail("Offsale must not dispatch a sale push") } });
  await worker.run(); assert.equal(f.db.prepare("SELECT state FROM local_push_outbox").get().state, "cancelled");
});

test("fresh source evidence resumes a repair that previously waited on stale timing", t => {
  const f = fixture(t); f.account(); f.event(); f.sale(START + 3 * 86400000); f.plan("tm_1", { baseline: true });
  const original = f.db.prepare("SELECT id FROM local_event_alerts").get().id;
  f.advance(2 * 86400000); f.db.exec("UPDATE tour_dates SET venue='Fresh source hall'"); f.plan();
  assert.equal(f.db.prepare("SELECT state FROM local_event_alerts").get().state, "cancelled");
  f.advance(1); f.sale(START + 3 * 86400000);
  assert.equal(f.alerts.planEventPage("tm_1").planned, 1);
  assert.equal(f.db.prepare("SELECT id FROM local_event_alerts").get().id, original);
  f.advance(86400000); assert.equal(f.alerts.deliverDue().delivered, 1);
});

test("revocation before first registration fences a late request and survives account transfer", t => {
  const f = fixture(t); f.account(); f.account("other");
  assert.deepEqual(f.devices.revoke("fan", input(), f.authorize("fan").assertCurrentSession), { enabled: false, generation: 1 });
  assert.throws(() => f.devices.register("fan", input(), f.authorize("fan")), e => e.status === 409);
  assert.equal(f.devices.binding("other", input(), f.authorize("other").assertCurrentSession).generation, 1);
  // A subsequent account can acknowledge an already-disabled installation.
  assert.equal(f.devices.revoke("other", input({ expectedGeneration: 1 }), f.authorize("other").assertCurrentSession).generation, 2);
  assert.equal(f.devices.register("other", input({ expectedGeneration: 2 }), f.authorize("other")).generation, 3);
  assert.throws(() => f.devices.revoke("fan", input(), f.authorize("fan").assertCurrentSession), e => e.status === 403);
  f.db.exec("DELETE FROM sessions WHERE user_id='other'");
  assert.throws(() => f.devices.register("fan", input(), f.authorize("fan")), e => e.status === 409);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_installations").get().n, 0);
});

test("revocation retries are idempotent and cannot disable a newer registration", t => {
  const f = fixture(t); f.account(); f.enable();
  const proof = input({ expectedGeneration: 1 });
  assert.deepEqual(f.devices.revoke("fan", proof, f.authorize("fan").assertCurrentSession), { enabled: false, generation: 2 });
  assert.equal(f.devices.revoke("fan", proof, f.authorize("fan").assertCurrentSession).generation, 2);
  assert.throws(() => f.devices.register("fan", proof, f.authorize("fan")), e => e.status === 409);
  assert.equal(f.devices.register("fan", input({ expectedGeneration: 2 }), f.authorize("fan")).generation, 3);
  assert.throws(() => f.devices.revoke("fan", proof, f.authorize("fan").assertCurrentSession), e => e.status === 409);
  assert.throws(() => f.devices.revoke("fan", input({ expectedGeneration: 3, secret: "b".repeat(43) }), f.authorize("fan").assertCurrentSession), e => e.status === 403);
  assert.equal(f.db.prepare("SELECT generation FROM local_push_installations").get().generation, 3);
});

test("revocation fence and device removal roll back together", t => {
  const f = fixture(t); f.account(); f.enable();
  f.db.exec("CREATE TRIGGER reject_revoke BEFORE DELETE ON local_push_installations BEGIN SELECT RAISE(ABORT,'fixture revoke failure'); END");
  assert.throws(() => f.devices.revoke("fan", input({ expectedGeneration: 1 }), f.authorize("fan").assertCurrentSession), /fixture revoke failure/);
  assert.equal(f.db.prepare("SELECT generation FROM local_push_installation_receipts").get().generation, 1);
  assert.equal(f.db.prepare("SELECT generation FROM local_push_installations").get().generation, 1);
});

test("revocation receipts have privacy erasure and never export installation proof", t => {
  const f = fixture(t); f.account(); f.devices.revoke("fan", input(), f.authorize("fan").assertCurrentSession);
  const exported = JSON.stringify(exportLocalAlerts(f.db, "fan"));
  assert.equal(exportLocalAlerts(f.db, "fan").deviceRevocations.length, 1);
  for (const privateValue of [secret, installationId, "secret_hash"]) assert.equal(exported.includes(privateValue), false);
  eraseLocalAlerts(f.db, "fan"); assert.equal(f.db.prepare("SELECT account_id FROM local_push_installation_receipts").get().account_id, null);
  assert.equal(f.db.prepare("SELECT revoked_at FROM local_push_installation_receipts").get().revoked_at, null);
  assert.throws(() => f.devices.register("fan", input(), f.authorize("fan")), e => e.status === 409);
  f.devices.revoke("fan", input({ expectedGeneration: 1 }), f.authorize("fan").assertCurrentSession);
  f.db.exec("DELETE FROM users WHERE id='fan'"); assert.equal(f.db.prepare("SELECT account_id FROM local_push_installation_receipts").get().account_id, null);
  assert.equal(f.db.prepare("SELECT revoked_at FROM local_push_installation_receipts").get().revoked_at, null);
});

test("each new revoke fences a pending enable even when the installation was already disabled", t => {
  const f = fixture(t); f.account();
  f.devices.revoke("fan", input(), f.authorize("fan").assertCurrentSession);
  const delayed = input({ expectedGeneration: f.devices.binding("fan", input(), f.authorize("fan").assertCurrentSession).generation });
  assert.equal(f.devices.revoke("fan", delayed, f.authorize("fan").assertCurrentSession).generation, 2);
  assert.throws(() => f.devices.register("fan", delayed, f.authorize("fan")), e => e.status === 409);
  assert.equal(f.devices.revoke("fan", delayed, f.authorize("fan").assertCurrentSession).generation, 2);
});

test("consumed generations survive session and later account deletion without an account link", t => {
  const f = fixture(t); f.account(); f.account("other"); f.enable();
  f.devices.register("other", input({ expectedGeneration: 1 }), f.authorize("other"));
  f.db.exec("DELETE FROM sessions WHERE user_id='other'; DELETE FROM users WHERE id='other'");
  const receipt = f.db.prepare("SELECT * FROM local_push_installation_receipts").get();
  assert.equal(receipt.account_id, null); assert.equal(receipt.generation, 2);
  assert.throws(() => f.devices.register("fan", input({ expectedGeneration: 1 }), f.authorize("fan")), e => e.status === 409);
});

test("deleted auth session prevents a delayed registration after switching or logout", t => {
  const f = fixture(t); f.account(); f.account("other"); f.event(); f.enable(); f.plan(); f.alerts.deliverDue();
  f.devices.register("other", input({ installationId: "other_installation_12345", token: "ExpoPushToken[otherfixture12345]" }), f.authorize("other"));
  f.db.exec("DELETE FROM sessions WHERE user_id='fan'");
  assert.throws(() => f.devices.register("fan", input(), f.authorize("fan")), e => e.status === 401);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox").get().n, 0);
  assert.equal(f.db.prepare("SELECT account_id FROM local_push_installations").get().account_id, "other");
});

test("schema refuses to promise revocation without foreign keys", () => {
  const db = new DatabaseSync(":memory:");
  try { db.exec("PRAGMA foreign_keys=OFF"); assert.throws(() => ensureLocalAlertSchema(db), /foreign-key enforcement/); }
  finally { db.close(); }
});

test("schema upgrade records already-consumed installation generations before session deletion", t => {
  const f = fixture(t); f.account(); f.enable();
  f.db.exec("DROP TABLE local_push_installation_receipts");
  ensureLocalAlertSchema(f.db); ensureLocalAlertSchema(f.db);
  assert.equal(f.db.prepare("SELECT generation FROM local_push_installation_receipts").get().generation, 1);
  f.db.exec("DELETE FROM sessions WHERE user_id='fan'");
  f.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ('new_session','fan',?)").run(START + 86400000);
  assert.throws(() => f.devices.register("fan", input(), { sessionHash: "new_session", assertCurrentSession: f.authorize("fan").assertCurrentSession }), e => e.status === 409);
});

for (const rollback of [false, true]) test(`real linked-account switch atomically revokes the prior push session (rollback=${rollback})`, t => {
  const f = fixture(t); f.account(); f.account("other"); f.event();
  f.db.exec(`ALTER TABLE users ADD COLUMN email TEXT DEFAULT 'linked@example.test';
    ALTER TABLE users ADD COLUMN pass_hash TEXT DEFAULT 'synthetic-proof';
    ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'fan';
    ALTER TABLE users ADD COLUMN email_verified_at INTEGER DEFAULT 1;
    ALTER TABLE users ADD COLUMN created_at INTEGER DEFAULT 0;
    ALTER TABLE sessions ADD COLUMN created_at INTEGER DEFAULT 0;`);
  const tokenHash = token => createHash("sha256").update(token).digest("hex"); let sequence = 0;
  const createSession = accountId => {
    const token = `synthetic-session-${++sequence}`, expiresAt = START + 86400000;
    f.db.prepare("INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").run(tokenHash(token), accountId, expiresAt, START);
    return { token, expiresAt };
  };
  const original = createSession("fan"), sessionHash = tokenHash(original.token);
  const linked = createLinkedAccounts({ database: f.db, ApiError, requireSessionUser: ctx => ctx.user, limit: () => {},
    verifyPasswordForUser: async () => true, atomicWrite: work => withImmediateWrite(f.db, work), createSession,
    sessionTtlForRole: () => 86400000, publicUser: account => ({ id: account.id }), now: f.now,
    onAuthenticated: () => { if (rollback) throw Error("synthetic switch rollback"); } });
  linked.grantVerifiedAccounts({ userId: "fan", users: f.db.prepare("SELECT * FROM users").all(), token: original.token });
  f.alerts.setPreferences("fan", { ...DEFAULT_LOCAL_ALERT_PREFERENCES, datesPush: true }, f.authorize("fan").assertCurrentSession);
  f.devices.register("fan", input(), { sessionHash, assertCurrentSession: f.authorize("fan").assertCurrentSession });
  f.enable("other", { installationId: "other_installation_12345", token: "ExpoPushToken[otherfixture12345]" });
  f.plan(); f.alerts.deliverDue(); let replacement = null;
  const switchAccount = () => linked.routes["POST /api/me/accounts/switch"]({ user: { id: "fan" }, token: original.token,
    body: { accountId: "other" }, setSession: value => { replacement = value; } });
  if (rollback) assert.throws(switchAccount, /synthetic switch rollback/);
  else assert.equal(switchAccount().user.id, "other");
  assert.equal(!!f.db.prepare("SELECT 1 FROM sessions WHERE token_hash=?").get(sessionHash), rollback);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_installations WHERE account_id='fan'").get().n, +rollback);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox").get().n, rollback ? 2 : 1);
  assert.equal(!!replacement, !rollback);
  if (!rollback) assert.throws(() => f.devices.register("fan", input(), { sessionHash, assertCurrentSession: f.authorize("fan").assertCurrentSession }), e => e.status === 401);
});

test("event reconciliation is paged, restartable and preserves unsent metadata refresh", t => {
  const f = fixture(t); for (let i = 0; i < 7; i++) f.account(`fan${i}`); f.event(); f.plan(); f.alerts.deliverDue();
  const notices = f.db.prepare("SELECT * FROM notifications ORDER BY id").all();
  f.db.exec("UPDATE tour_dates SET venue='Edited Hall'");
  const first = f.alerts.reconcileEvent("tm_1", { limit: 2 }); assert.equal(first.processed, 2); assert.equal(first.more, true);
  assert.equal(f.alerts.planEventPage("tm_1").awaitingReconciliation, true);
  const resumed = f.restartAlerts(); let total = first.processed, result;
  do { result = resumed.reconcileEvent("tm_1", { limit: 2 }); assert.ok(result.processed <= 2); total += result.processed; } while (result.more);
  assert.equal(total, 7); assert.deepEqual(f.db.prepare("SELECT * FROM notifications ORDER BY id").all(), notices);
  assert.equal(resumed.deliverDue().delivered, 0);
  f.hidden.add("tm_1"); assert.equal(resumed.reconcileEvent("tm_1", { limit: 2 }).processed, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 5);
  for (const alert of f.db.prepare("SELECT * FROM local_event_alerts").all()) assert.equal(resumed.readAlertTarget(alert.account_id, alert.id), null);
  do { result = resumed.reconcileEvent("tm_1", { limit: 2 }); } while (result.more);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 0);
});

test("a newer event change resets a partially completed reconciliation cursor", t => {
  const f = fixture(t); for (let i = 0; i < 5; i++) f.account(`fan${i}`); f.event(); f.plan(); f.alerts.deliverDue();
  f.db.exec("UPDATE tour_dates SET venue='Edited Hall'"); f.alerts.reconcileEvent("tm_1", { limit: 2 });
  const firstCursor = f.db.prepare("SELECT reconcile_cursor FROM local_event_observations").get().reconcile_cursor;
  f.db.exec("UPDATE tour_dates SET date='2027-02-15'"); f.alerts.reconcileEvent("tm_1", { limit: 2 });
  assert.equal(f.db.prepare("SELECT reconcile_cursor FROM local_event_observations").get().reconcile_cursor, firstCursor);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_event_alerts WHERE state='cancelled'").get().n, 2);
  while (f.alerts.reconcileEvent("tm_1", { limit: 2 }).more) { /* bounded synthetic pages */ }
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 0);
});

test("logical cancellation immediately blocks all devices while physical cleanup is bounded", async t => {
  const f = fixture(t); f.account(); f.event(); f.enable();
  for (let i = 0; i < 24; i++) f.devices.register("fan", input({ installationId: `extra_installation_12345_${i}`, token: `ExpoPushToken[extrafixture12345_${i}]` }), f.authorize("fan"));
  f.plan(); f.alerts.deliverDue(); f.hidden.add("tm_1"); f.alerts.reconcileEvent("tm_1", { limit: 1 });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox WHERE state='cancelled'").get().n, 20);
  assert.equal(f.alerts.cancelPendingPushPage({ limit: 2 }).cancelled, 2);
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now,
    transport: { send: () => assert.fail("logical cancellation must reject sends before cleanup") } });
  await worker.run(); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox WHERE state='ready'").get().n, 0);
});

test("reconciliation upgrade and each cancellation page preserve transaction rollback", t => {
  const f = fixture(t); for (let i = 0; i < 5; i++) f.account(`fan${i}`); f.event(); f.plan(); f.alerts.deliverDue();
  f.db.exec("DROP INDEX local_event_observations_reconcile; ALTER TABLE local_event_observations DROP COLUMN reconcile_cursor; ALTER TABLE local_event_observations DROP COLUMN reconcile_complete");
  ensureLocalAlertSchema(f.db); ensureLocalAlertSchema(f.db);
  assert.equal(f.db.prepare("SELECT reconcile_complete FROM local_event_observations").get().reconcile_complete, 0);
  const before = f.db.prepare("SELECT * FROM local_event_observations").get();
  f.hidden.add("tm_1");
  f.db.exec("CREATE TRIGGER reject_notice_removal BEFORE DELETE ON notifications BEGIN SELECT RAISE(ABORT,'fixture cancellation failure'); END");
  assert.throws(() => f.alerts.reconcileEvent("tm_1", { limit: 2 }), /fixture cancellation failure/);
  assert.deepEqual(f.db.prepare("SELECT * FROM local_event_observations").get(), before);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 5);
  f.db.exec("DROP TRIGGER reject_notice_removal");
  assert.equal(f.alerts.reconcileEvent("tm_1", { limit: 2 }).processed, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 3);
});

for (const change of ["preference", "generation"]) test(`${change} cancellation has bounded cleanup and no stale dispatch`, async t => {
  const f = fixture(t); f.account(); f.enable();
  for (let i = 0; i < 105; i++) { const id = f.event(`tm_${i + 10}`); f.plan(id); }
  f.alerts.deliverDue({ limit: 500 });
  if (change === "preference") f.alerts.setPreferences("fan", DEFAULT_LOCAL_ALERT_PREFERENCES, f.authorize("fan").assertCurrentSession);
  else f.devices.register("fan", input({ expectedGeneration: 1, token: "ExpoPushToken[rotatedfixture12345]" }), f.authorize("fan"));
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox WHERE state='cancelled'").get().n, 100);
  assert.equal(f.alerts.cancelPendingPushPage({ limit: 2 }).cancelled, 2);
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now,
    transport: { send: () => assert.fail("ineligible remainder must never send") } });
  await worker.run(); assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox WHERE state='ready'").get().n, 0);
});

test("interrupted send recovery is bounded and never retries the remainder", async t => {
  const f = fixture(t); f.account(); f.enable();
  for (let i = 0; i < 5; i++) { const id = f.event(`tm_${i + 10}`); f.plan(id); }
  f.alerts.deliverDue();
  f.db.prepare("UPDATE local_push_outbox SET state='sending',attempts=1,lease_until=?").run(START);
  const worker = createLocalPushDelivery({ db: f.db, alerts: f.alerts, enabled: true, now: f.now,
    transport: { send: () => assert.fail("interrupted sends are uncertain") } });
  await worker.run({ limit: 2 });
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox WHERE state='unknown'").get().n, 2);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox WHERE state='sending'").get().n, 3);
});
