import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ApiError } from "../../errors.js";
import { createCatalogEditorService } from "./catalogEditorService.js";
import { listCatalogEditorEntities, readPublicCatalogEditorText } from "./catalogEditorRepository.js";
import { catalogEditorRoutes } from "./catalogEditorRoutes.js";

const AT = 1800000000000;
function fixture(t) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,bio TEXT,genre TEXT,country TEXT,mbid TEXT,source TEXT);
    CREATE TABLE artist_profiles(artist_key TEXT PRIMARY KEY,bio TEXT,owner_id TEXT,removed INTEGER,bio_staff_curated INTEGER,identity_review_status TEXT);
    CREATE TABLE tour_dates(id TEXT PRIMARY KEY,owner_id TEXT,release_at INTEGER,provider_active INTEGER,music_qualified INTEGER,
      artist_identity_status TEXT,source TEXT,provider_event_id TEXT,venue_provider_id TEXT,venue TEXT,venue_city TEXT,venue_country_code TEXT,
      venue_address_line1 TEXT,event_name TEXT,artist TEXT,artist_key TEXT,date TEXT,start_date_time TEXT,ticket_url TEXT,event_status TEXT,
      sold_out INTEGER,billed_artists TEXT,event_kind TEXT);
    CREATE INDEX provider_venue_fixture ON tour_dates(source,venue_provider_id,date) WHERE owner_id IS NULL AND venue_provider_id IS NOT NULL;
    CREATE TABLE moderation_actions(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,target_type TEXT,target_id TEXT,reason TEXT,
      prior_state TEXT,next_state TEXT,request_id TEXT,created_at INTEGER);
    INSERT INTO artists VALUES('sample artist','Sample Artist',NULL,'Rock','Canada','mbid-a','musicbrainz');
    INSERT INTO artists VALUES('existing artist','Existing Artist','Keep this biography.','Jazz','Canada','mbid-b','musicbrainz');
    INSERT INTO tour_dates VALUES('event-1',NULL,0,1,1,'registered','ticketmaster','p-event','p-venue','Example Hall','Toronto','CA',
      '1 Main Street','Sample Artist in concert','Sample Artist','sample artist','2026-10-05',NULL,'https://www.ticketmaster.com/example',
      'onsale',0,'["Sample Artist"]','concert');`);
  return { db, service: createCatalogEditorService({ database: db, now: () => AT }) };
}
function draft(service, type = "artist", key = "sample artist") {
  const current = service.read({ type, key });
  return { type, key, expectedRevision: current.revision, expectedHash: current.expectedHash,
    summary: "Source-backed context for this public catalog page.", sources: [{ label: "Official source", url: "https://www.mshpit.com/about" }], reason: "Fill missing sourced context" };
}
const save = (service, value, key = "operation_0000000001") => service.save({ actorId: "admin", draft: value, idempotencyKey: key, requestId: "request-1" });

test("artist, venue and event saves preserve source records and produce public text plus audit", t => {
  const { db, service } = fixture(t);
  const before = JSON.stringify({ artists: db.prepare("SELECT * FROM artists").all(), dates: db.prepare("SELECT * FROM tour_dates").all() });
  for (const [index, [type, key]] of [["artist", "sample artist"], ["venue", "ticketmaster:p-venue"], ["event", "event-1"]].entries()) {
    const input = draft(service, type, key), result = save(service, input, `operation_00000000${index}`);
    assert.equal(result.revision, 1); assert.equal(result.saved.content.summary, input.summary);
    assert.equal(readPublicCatalogEditorText(db, { type, key, at: AT }).summary, input.summary);
    assert.equal(db.prepare("SELECT reason FROM moderation_actions WHERE id=?").get(result.auditId).reason, input.reason);
  }
  assert.equal(JSON.stringify({ artists: db.prepare("SELECT * FROM artists").all(), dates: db.prepare("SELECT * FROM tour_dates").all() }), before);
});

test("prepare is read-only, bounded, catches duplicate records and returns each outcome", t => {
  const { db, service } = fixture(t), valid = draft(service);
  const result = service.prepare([valid, valid, { ...valid, type: "event", key: "missing" }, { ...valid, date: "2030-01-01" }]);
  assert.deepEqual(result.results.map(row => row.ok), [true, false, false, false]);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog_editor_entries").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n, 0);
  assert.throws(() => service.prepare(Array(11).fill(valid)), { code: "VALIDATION_FAILED" });
});

test("retry receipts are actor-scoped and reject changed payloads without duplicate audit", t => {
  const { db, service } = fixture(t), value = draft(service);
  const first = save(service, value), repeated = save(service, value);
  assert.equal(repeated.replayed, true); assert.equal(repeated.auditId, first.auditId);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n, 1);
  assert.throws(() => save(service, { ...value, summary: "Changed payload" }), { code: "CONFLICT" });
  assert.throws(() => service.save({ actorId: "different-admin", draft: value, idempotencyKey: "operation_0000000001" }), { code: "CONFLICT" });
});

test("stale revisions and changed provider facts conflict before writing", t => {
  const { db, service } = fixture(t), stale = draft(service);
  save(service, stale);
  assert.throws(() => save(service, stale, "operation_0000000002"), { code: "CONFLICT" });
  const event = draft(service, "event", "event-1");
  db.prepare("UPDATE tour_dates SET date=? WHERE id=?").run("2026-10-06", "event-1");
  assert.throws(() => save(service, event, "operation_0000000003"), { code: "CONFLICT" });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM moderation_actions").get().n, 1);
});

test("changed identity, private ownership, hidden state and withdrawn events cannot leak saved text", t => {
  const { db, service } = fixture(t);
  save(service, draft(service));
  db.prepare("UPDATE artists SET mbid='replacement' WHERE norm='sample artist'").run();
  assert.equal(readPublicCatalogEditorText(db, { type: "artist", key: "sample artist", at: AT }), null);
  db.prepare("INSERT INTO artist_profiles VALUES(?,?,?,0,0,'approved')").run("sample artist", "", "member");
  assert.throws(() => service.read({ type: "artist", key: "sample artist" }), { code: "NOT_FOUND" });
  save(service, draft(service, "event", "event-1"), "operation_0000000002");
  db.prepare("UPDATE tour_dates SET provider_active=0 WHERE id='event-1'").run();
  assert.equal(readPublicCatalogEditorText(db, { type: "event", key: "event-1", at: AT }), null);
});

test("hiding and correcting uses a fresh revision and retains prior text in audit", t => {
  const { db, service } = fixture(t);
  const first = save(service, draft(service));
  const correction = { ...draft(service), summary: "Corrected context with the same cited source.", hidden: true };
  const second = save(service, correction, "operation_0000000002");
  assert.equal(second.revision, 2);
  assert.equal(readPublicCatalogEditorText(db, { type: "artist", key: "sample artist", at: AT }), null);
  const prior = JSON.parse(db.prepare("SELECT prior_state FROM moderation_actions WHERE id=?").get(second.auditId).prior_state);
  assert.equal(prior.content.summary, first.saved.content.summary);
});

test("audit failure atomically rolls back text and receipt", t => {
  const { db, service } = fixture(t);
  db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON moderation_actions BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
  assert.throws(() => save(service, draft(service)), /audit unavailable/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog_editor_entries").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM catalog_editor_receipts").get().n, 0);
});

test("same provider venue ID with conflicting places is unavailable", t => {
  const { db, service } = fixture(t);
  db.exec("INSERT INTO tour_dates SELECT 'event-2',owner_id,release_at,provider_active,music_qualified,artist_identity_status,source,provider_event_id,venue_provider_id,venue,'Ottawa',venue_country_code,venue_address_line1,event_name,artist,artist_key,date,start_date_time,ticket_url,event_status,sold_out,billed_artists,event_kind FROM tour_dates WHERE id='event-1'");
  assert.throws(() => service.read({ type: "venue", key: "ticketmaster:p-venue" }), { code: "NOT_FOUND" });
});

test("source URLs, payload fields and identity filters fail closed without fetching", t => {
  const { service } = fixture(t), value = draft(service);
  for (const url of ["http://host.test/x", "https://localhost/x", "https://127.0.0.1/x", "https://[::1]/x", "https://user:pass@www.mshpit.com/x", "https://www.mshpit.com:8443/x", "javascript:alert(1)"]) {
    assert.equal(service.prepare([{ ...value, sources: [{ label: "Source", url }] }]).results[0].ok, false, url);
  }
  assert.equal(service.prepare([{ ...value, ticketUrl: "https://evil.test" }]).results[0].ok, false);
  assert.equal(service.prepare([{ ...value, summary: " " }]).results[0].ok, false);
  assert.equal(service.prepare([{ ...value, sources: [] }]).results[0].ok, false);
});

test("missing queue preserves populated biographies and exact name search treats SQL wildcards literally", t => {
  const { service } = fixture(t);
  assert.deepEqual(service.list({ type: "artist" }).items.map(row => row.key), ["sample artist"]);
  assert.equal(service.list({ type: "artist", query: "%" }).items.length, 0);
  assert.equal(service.list({ type: "artist", query: "Existing", missingOnly: false }).items[0].protectedFacts.biography, "Keep this biography.");
});

test("staff routes reject nonadmins before inspection and reject unverified mutations", t => {
  const { db } = fixture(t); let limited = 0;
  const routes = catalogEditorRoutes({ database: db, now: () => AT, rateLimit() { limited++; },
    decodedPathParam: (ctx, field) => ctx.params[field], requireAdmin(ctx) {
      if (!ctx.user) throw new ApiError(401, "Sign in.", "AUTH_REQUIRED");
      if (ctx.user.role !== "admin" || ctx.user.is_banned || ctx.user.suspended_until > AT) throw new ApiError(403, "Admin required.", "FORBIDDEN");
      return ctx.user;
    } });
  const privateRoutes = Object.entries(routes).filter(([key]) => key.includes("/api/admin/"));
  for (const user of [null, { role: "fan" }, { role: "moderator" }, { role: "editor" }, { role: "admin", is_banned: true }]) {
    for (const [, handler] of privateRoutes) assert.throws(() => handler({ user }), ApiError);
  }
  assert.equal(limited, 0);
  const ctx = { user: { id: "a", role: "admin", email_verified_at: 0 }, setHeader() {} };
  assert.throws(() => routes["POST /api/admin/catalog-editor/save"](ctx), { code: "EMAIL_VERIFICATION_REQUIRED" });
});

test("public reads reveal only curated text, never audit or staff identifiers", t => {
  const { db, service } = fixture(t);
  save(service, draft(service));
  const publicValue = readPublicCatalogEditorText(db, { type: "artist", key: "sample artist", at: AT });
  assert.deepEqual(Object.keys(publicValue).sort(), ["revision", "sources", "summary", "updatedAt"]);
  assert.equal(readPublicCatalogEditorText(db, { type: "artist", key: "absent", at: AT }), null);
});

function queueFixture(t, type, count, populated = () => false) {
  const { db, service } = fixture(t);
  const event = db.prepare("SELECT * FROM tour_dates LIMIT 1").get();
  db.exec(type === "artist" ? "DELETE FROM artists" : "DELETE FROM tour_dates");
  const insertEvent = db.prepare(`INSERT INTO tour_dates(${Object.keys(event).join(",")}) VALUES(${Object.keys(event).map(() => "?").join(",")})`);
  const keys = [];
  for (let index = 0; index < count; index++) {
    const id = String(index).padStart(3, "0");
    let key;
    if (type === "artist") {
      key = `artist-${id}`;
      db.prepare("INSERT INTO artists VALUES(?,?,NULL,NULL,NULL,?,'musicbrainz')").run(key, `Artist ${id}`, `mbid-${id}`);
    } else {
      const row = { ...event, id: `event-${id}`, source: index % 2 ? "ticketmaster" : "bandsintown",
        venue_provider_id: `venue-${id}`, provider_event_id: `provider-${id}` };
      insertEvent.run(...Object.values(row));
      key = type === "event" ? row.id : `${row.source}:${row.venue_provider_id}`;
    }
    if (populated(index)) {
      const current = service.read({ type, key });
      db.prepare("INSERT INTO catalog_editor_entries VALUES(?,?,1,?,?,?,0,'admin',?)")
        .run(type, key, current.identityHash, "Existing sourced text.", "[]", AT);
    } else keys.push(key);
  }
  return { db, service, keys: keys.sort() };
}

test("empty queues seek past populated candidates for artists, venues and events without skipping or repeating gaps", t => {
  for (const type of ["artist", "venue", "event"]) {
    const { service, keys } = queueFixture(t, type, 211, index => index % 3 === 0);
    const found = [], cursors = new Set();
    let after = "";
    do {
      const page = service.list({ type, after });
      assert.ok(page.items.length <= 30);
      assert.equal(page.scanLimitReached, false);
      found.push(...page.items.map(row => row.key));
      after = page.nextCursor;
      assert.ok(!after || !cursors.has(after), "Continuation must advance");
      cursors.add(after);
    } while (after);
    assert.deepEqual(found, keys, `${type}: every gap appears exactly once across page boundaries`);
  }
  const { service } = queueFixture(t, "artist", 41, index => index < 40);
  const page = service.list({ type: "artist" });
  assert.deepEqual(page.items.map(row => row.key), ["artist-040"]);
  assert.equal(page.nextCursor, null);
});

test("queue candidate budget keeps the lookahead for the next request and stops when the result page fills", t => {
  const { db, service } = queueFixture(t, "artist", 151, index => index < 150);
  let inspected = 0;
  const database = { prepare(sql) {
    if (sql === "SELECT * FROM artists WHERE norm=?") inspected++;
    return db.prepare(sql);
  } };
  const first = listCatalogEditorEntities(database, { type: "artist", at: AT });
  assert.equal(inspected, 150);
  assert.deepEqual(first.items, []);
  assert.equal(first.scanLimitReached, true);
  assert.equal(first.nextCursor, "artist-149");
  const last = service.list({ type: "artist", after: first.nextCursor });
  assert.deepEqual(last.items.map(row => row.key), ["artist-150"]);
  assert.equal(last.nextCursor, null);
  assert.equal(last.scanLimitReached, false);
  inspected = 0;
  const all = listCatalogEditorEntities(database, { type: "artist", at: AT, missingOnly: false });
  assert.equal(all.items.length, 30);
  assert.equal(inspected, 30);
  assert.equal(all.nextCursor, "artist-029");
  assert.equal(service.list({ type: "artist", query: "absent" }).nextCursor, null);
});

test("fill queue preserves existing text, intentional clears, hidden research and changed staff identities", t => {
  t.mock.method(globalThis, "fetch", () => assert.fail("Queue reads must never fetch research"));
  const { db, service } = queueFixture(t, "artist", 8);
  db.exec("CREATE TABLE catalog_research(entity_type TEXT,entity_key TEXT,status TEXT,findings TEXT,PRIMARY KEY(entity_type,entity_key))");
  db.prepare("UPDATE artists SET bio='Provider biography' WHERE norm='artist-000'").run();
  db.prepare("INSERT INTO artist_profiles VALUES(?,?,NULL,0,0,'approved')").run("artist-001", "Profile biography");
  db.prepare("INSERT INTO artist_profiles VALUES(?,?,NULL,0,1,'approved')").run("artist-002", "");
  const putResearch = db.prepare("INSERT INTO catalog_research VALUES('artist',?,?,?)");
  putResearch.run("artist-003", "found", JSON.stringify({ version: 1, summary: "Existing public research" }));
  putResearch.run("artist-004", "hidden", JSON.stringify({ version: 1, summary: "Intentionally hidden research" }));
  for (const [key, hidden] of [["artist-005", true], ["artist-006", false]]) {
    const value = { ...draft(service, "artist", key), hidden };
    save(service, value, `operation_preserve_${key}`);
  }
  db.prepare("UPDATE artists SET mbid='changed-identity' WHERE norm='artist-006'").run();
  const snapshot = () => JSON.stringify(["artists", "artist_profiles", "catalog_research", "catalog_editor_entries", "catalog_editor_receipts", "moderation_actions"]
    .map(table => db.prepare(`SELECT * FROM ${table}`).all()));
  const before = snapshot();
  assert.deepEqual(service.list({ type: "artist" }).items.map(row => row.key), ["artist-007"]);
  assert.equal(service.list({ type: "artist", missingOnly: false }).items.length, 8, "Existing records remain explicitly reviewable");
  assert.equal(service.read({ type: "artist", key: "artist-002" }).protectedReason.includes("intentionally cleared"), true);
  assert.equal(service.read({ type: "artist", key: "artist-006" }).identityCurrent, false);
  assert.equal(snapshot(), before, "Listing must not write provider, research, staff text, audit or receipts");
});

test("venue research exclusions use canonical name and city without hiding another city's empty venue", t => {
  const { db, service } = fixture(t);
  db.exec("CREATE TABLE catalog_research(entity_type TEXT,entity_key TEXT,status TEXT,PRIMARY KEY(entity_type,entity_key))");
  db.exec("INSERT INTO catalog_research VALUES('venue','example hall|toronto|ca','found'),('venue','history|toronto|ca','hidden')");
  const template = db.prepare("SELECT * FROM tour_dates LIMIT 1").get();
  const insert = db.prepare(`INSERT INTO tour_dates(${Object.keys(template).join(",")}) VALUES(${Object.keys(template).map(() => "?").join(",")})`);
  insert.run(...Object.values({ ...template, id: "event-2", venue_provider_id: "other-city", venue_city: "Ottawa" }));
  insert.run(...Object.values({ ...template, id: "event-3", venue_provider_id: "alias", venue: "History Toronto" }));
  assert.deepEqual(service.list({ type: "venue" }).items.map(row => row.key), ["ticketmaster:other-city"]);
  assert.equal(service.list({ type: "venue", missingOnly: false }).items.length, 3);
  assert.deepEqual(service.list({ type: "venue", query: "Example", missingOnly: true }).items.map(row => row.key), ["ticketmaster:other-city"]);
  assert.equal(service.list({ type: "venue", query: "absent" }).nextCursor, null);
  assert.equal(service.list({ type: "event" }).items.length, 3, "Venue research does not silently classify event text");
});
