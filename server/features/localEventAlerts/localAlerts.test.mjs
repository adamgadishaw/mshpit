import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ensureLocalAlertSchema, LOCAL_ALERT_TABLES } from "./localAlertSchema.js";
import { createLocalAlertService } from "./localAlertService.js";
import { createLocalAlertAudience, creatorCalendarNoticeFor } from "./localAlertAudience.js";
import { createLocalPushDevices } from "./localPushDevices.js";
import { createLocalPushDelivery } from "./localPushDelivery.js";
import { createExpoPushTransport } from "./expoPushTransport.js";
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
  const alerts = createLocalAlertService({ db, readPublicEvent, canNotifyArtist: audience, findRelatedNotice: (accountId, event) => creatorCalendarNoticeFor(db, accountId, event), now });
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
  return { db, alerts, devices, now, account, event, plan, sale, enable, authorize, hidden, advance: delta => { at += delta; } };
}

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
  f.db.exec("DROP TRIGGER fail_push"); f.alerts.deliverDue(); f.alerts.deliverDue();
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications").get().n, 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM local_push_outbox").get().n, 1);
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
  const exported = JSON.stringify(exportLocalAlerts(f.db, "fan"));
  for (const value of [secret, "ExpoPushToken", "session_fan", "secret_hash", "city_path"]) assert.equal(exported.includes(value), false);
  eraseLocalAlerts(f.db, "fan");
  for (const table of ["local_event_alerts", "local_push_installations", "local_alert_preferences"]) assert.equal(f.db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE account_id='fan'`).get().n, 0);
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='fan'").get().n, 0);
  ensureLocalAlertSchema(f.db); assert.equal(LOCAL_ALERT_TABLES.length, 7);
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
