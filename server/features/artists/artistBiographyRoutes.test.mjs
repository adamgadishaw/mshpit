import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { artistBiographyRoutes } from "./artistBiographyRoutes.js";
import { projectArtistBiography, musicBrainzBiographyFacts } from "../../../src/domain/artistBiography.mjs";

const facts = { artistType: "person", birthDate: "1985", careerStartYear: "2007", sourceUrl: "https://artist.example.org/about" };
function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE artists(norm TEXT PRIMARY KEY,name TEXT,public_slug TEXT,formed TEXT,data TEXT,updated_at INTEGER,mbid TEXT);
    CREATE TABLE moderation_actions(id TEXT PRIMARY KEY,actor_id TEXT,action TEXT,target_type TEXT,target_id TEXT,reason TEXT,prior_state TEXT,next_state TEXT,request_id TEXT,created_at INTEGER);
    INSERT INTO artists VALUES ('artist','The Artist','the-artist','1985','{"photo":"preserved-photo","biographyProvider":null}',1,NULL);`);
  class ApiError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
  const routes = artistBiographyRoutes({ database: db, ApiError, requireAdmin(ctx) {
    if (ctx.user?.role !== "admin") throw new ApiError(403, "Staff only", "FORBIDDEN"); return ctx.user;
  }, rateLimit() {}, now: () => Date.parse("2026-09-07T12:00:00Z"), publicArtist: (row) => ({ name: row.name, biographyFacts: projectArtistBiography(JSON.parse(row.data), { artistMbid: row.mbid }) }) });
  const context = (body, role = "admin") => ({ user: { id: "moderator", role }, params: { key: "the-artist" }, body, requestId: "audit-request", setHeader() {} });
  return { db, read: (ctx = context()) => routes["GET /api/admin/artists/:key/biography"](ctx),
    save: (body, role) => routes["PUT /api/admin/artists/:key/biography"](context({ artistMbid: null, ...body }, role)), context };
}

test("artist biography corrections are staff-only, revision checked, persisted, and audited", () => {
  const f = fixture();
  try {
    assert.throws(() => f.read(f.context({}, "fan")), /Staff only/);
    assert.throws(() => f.save({ revision: 0, facts }, "artist"), /Staff only/);
    assert.equal(f.read().facts, null); assert.equal(f.read().legacyYear, "1985");
    const saved = f.save({ revision: 0, facts, reason: "Official biography reviewed" });
    assert.equal(saved.revision, 1); assert.equal(saved.artist.biographyFacts.careerStartYear, "2007");
    assert.equal(f.read().facts.birthDate, "1985");
    assert.throws(() => f.save({ revision: 0, facts }), /changed/);
    const stored = JSON.parse(f.db.prepare("SELECT data FROM artists").get().data);
    assert.equal(stored.photo, "preserved-photo");
    assert.equal(f.db.prepare("SELECT formed FROM artists").get().formed, "1985", "ambiguous legacy evidence is retained, not silently rewritten");
    const audit = f.db.prepare("SELECT * FROM moderation_actions").get();
    assert.equal(audit.actor_id, "moderator"); assert.equal(audit.request_id, "audit-request");
    assert.equal(JSON.parse(audit.next_state).facts.source, "staff");
  } finally { f.db.close(); }
});

test("staff must review retained facts against a replacement artist and stale identity saves conflict", () => {
  const f = fixture(), id = "875203e1-8e58-4b86-8dcb-7190faf411c5";
  try {
    f.save({ revision: 0, facts });
    f.db.prepare("UPDATE artists SET mbid=?").run(id);
    const snapshot = f.read();
    assert.equal(snapshot.artistMbid, id); assert.equal(snapshot.facts, null);
    assert.equal(snapshot.requiresReview, true); assert.equal(snapshot.pendingFacts.birthDate, "1985");
    assert.throws(() => f.save({ revision: 1, facts }), /identity changed/);
    assert.equal(f.read().revision, 1);
    const corrected = f.save({ revision: 1, artistMbid: id, facts });
    assert.equal(corrected.requiresReview, false); assert.equal(corrected.pendingFacts, null);
    assert.equal(corrected.artist.biographyFacts.birthDate, "1985");
    assert.equal(JSON.parse(f.db.prepare("SELECT data FROM artists").get().data).biographyStaff.artistMbid, id);
    const audit = f.db.prepare("SELECT prior_state FROM moderation_actions WHERE json_extract(next_state,'$.revision')=2").get();
    assert.equal(JSON.parse(audit.prior_state).correction.facts.birthDate, "1985", "the complete previous correction survives in the staff audit even while hidden publicly");
  } finally { f.db.close(); }
});

test("legacy unbound staff corrections are preserved for review instead of guessed into the current identity", () => {
  const f = fixture();
  try {
    const saved = f.save({ revision: 0, facts });
    const data = JSON.parse(f.db.prepare("SELECT data FROM artists").get().data);
    delete data.biographyStaff.artistMbid;
    f.db.prepare("UPDATE artists SET data=?").run(JSON.stringify(data));
    const snapshot = f.read();
    assert.equal(snapshot.requiresReview, true); assert.equal(snapshot.facts, null);
    assert.equal(snapshot.pendingFacts.birthDate, "1985"); assert.equal(snapshot.revision, saved.revision);
    assert.equal(f.save({ revision: saved.revision, facts }).requiresReview, false);
  } finally { f.db.close(); }
});

test("invalid facts fail closed and a failed audit rolls back the facts", () => {
  const f = fixture();
  try {
    assert.throws(() => f.save({ revision: 0, facts: { ...facts, sourceUrl: "" } }), /source/);
    assert.throws(() => f.save({ facts }), /Reload/);
    f.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON moderation_actions BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
    assert.throws(() => f.save({ revision: 0, facts }), /audit unavailable/);
    assert.equal(f.read().revision, 0); assert.equal(f.read().facts, null);
  } finally { f.db.close(); }
});

test("clearing facts remains an explicit staff correction instead of exposing provider data again", () => {
  const f = fixture();
  try {
    const provider = musicBrainzBiographyFacts({ id: "875203e1-8e58-4b86-8dcb-7190faf411c5", type: "Person", "life-span": { begin: "1985" } });
    f.db.prepare("UPDATE artists SET data=?").run(JSON.stringify({ biographyProvider: provider }));
    assert.equal(f.read().facts.birthDate, "1985");
    const cleared = f.save({ revision: 0, facts: { artistType: "unknown" } });
    assert.equal(cleared.facts.birthDate, null);
    assert.equal(cleared.facts.source, "staff");
    assert.equal(cleared.requiresReview, false);
    assert.equal(cleared.pendingFacts, null);
    assert.equal(JSON.parse(f.db.prepare("SELECT data FROM artists").get().data).biographyProvider.birthDate, "1985");
  } finally { f.db.close(); }
});

test("a current-identity null clear is not misreported as an artist identity change", () => {
  const f = fixture(), id = "875203e1-8e58-4b86-8dcb-7190faf411c5";
  try {
    const biographyProvider = musicBrainzBiographyFacts({ id, type: "Person", "life-span": { begin: "1985" } });
    f.db.prepare("UPDATE artists SET mbid=?,data=?").run(id, JSON.stringify({ biographyProvider,
      biographyStaff: { revision: 2, artistMbid: id, facts: null } }));
    const cleared = f.read();
    assert.equal(cleared.facts, null, "the clear continues to suppress provider facts");
    assert.equal(cleared.requiresReview, false); assert.equal(cleared.pendingFacts, null);
    assert.equal(cleared.revision, 2);
    f.db.prepare("UPDATE artists SET mbid=?").run("b10bbbfc-cf9e-42e0-be17-e2c3e1d2600d");
    assert.equal(f.read().requiresReview, true, "a later real identity replacement still requires review");
  } finally { f.db.close(); }
});
