import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-post-location-"));
process.env.PIT_DATA_DIR = dataDir;
const { db, q } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
let count = 0;
function fixture() {
  const id = `location_user_${++count}`;
  q.insertUser.run(id, `${id}@example.com`, id, id, "test-hash", "fan", "Toronto", 43.65, -79.38, "LO", "#123456", Date.now());
  const user = q.userById.get(id);
  const create = (body) => routes["POST /api/posts"]({ user, ip: id, body });
  const edit = (postId, body) => routes["PATCH /api/posts/:id"]({ user, ip: id, params: { id: postId }, body });
  return { user, create, edit };
}
const draft = { artist: "Local Band", artistKey: null, venue: "", city: "Toronto, Ontario, Canada", date: "2026-08-10", overall: 4, review: "A great outdoor show." };
const invalid = (error) => error.status === 400 && error.code === "VALIDATION_FAILED";

test("city-only concert create persists and projects location without manufacturing venue identity", () => {
  const f = fixture();
  const created = f.create({ ...draft, eventAddress: "100 Public Event Lane" });
  assert.equal(created.post.city, draft.city);
  assert.equal(created.post.venue, "");
  assert.equal(created.post.venueKey, null);
  assert.equal(created.post.archiveShowKey, null);
  assert.equal(created.post.eventAddress, "100 Public Event Lane");
  const row = db.prepare("SELECT venue,venue_key,city,event_address FROM posts WHERE id=?").get(created.id);
  assert.deepEqual({ ...row }, { venue: "", venue_key: null, city: draft.city, event_address: "100 Public Event Lane" });
  const publicPost = routes["GET /api/posts/:id"]({ params: { id: created.id }, ip: "location-public" }).post;
  assert.equal(publicPost.eventAddress, created.post.eventAddress);
});

test("city-only create retries compare addresses and keep empty-address legacy canonical hashes", () => {
  const f = fixture(), body = { ...draft, clientMutationId: "city_location_retry_001", eventAddress: "100 Event Lane" };
  const created = f.create(body);
  const retry = f.create({ ...body, eventAddress: " 100 Event Lane " });
  assert.equal(retry.id, created.id);
  assert.equal(retry.duplicate, true);
  assert.throws(() => f.create({ ...body, eventAddress: "200 Different Lane" }), (error) => error.code === "POST_MUTATION_CONFLICT");
  assert.throws(() => f.create({ ...body, eventAddress: null }), (error) => error.code === "POST_MUTATION_CONFLICT");
  const oldBody = { ...draft, clientMutationId: "city_location_retry_002" };
  const legacy = f.create(oldBody);
  assert.equal(f.create({ ...oldBody, eventAddress: "" }).id, legacy.id);
  assert.equal(f.create({ ...oldBody, eventAddress: null }).duplicate, true);
  // Old rows without a stored hash must also compare their authored address.
  db.prepare("UPDATE posts SET client_mutation_hash=NULL WHERE id=?").run(created.id);
  db.prepare("DELETE FROM post_create_receipts WHERE post_id=?").run(created.id);
  assert.equal(f.create(body).duplicate, true);
});

test("address edits preserve unrelated fields, clear explicitly and cannot remove required city context", () => {
  const f = fixture();
  const created = f.create({ ...draft, eventAddress: "100 Event Lane" });
  assert.equal(f.edit(created.id, { review: "Updated review" }).post.eventAddress, "100 Event Lane");
  assert.equal(f.edit(created.id, { eventAddress: "200 Event Lane" }).post.eventAddress, "200 Event Lane");
  assert.throws(() => f.edit(created.id, { city: "", venue: "Known Room" }), invalid);
  assert.equal(f.edit(created.id, { eventAddress: "" }).post.eventAddress, null);
  assert.equal(db.prepare("SELECT event_address FROM posts WHERE id=?").get(created.id).event_address, null);
  assert.equal(f.edit(created.id, { eventAddress: null, venue: "Known Room", city: "" }).post.city, "");
  assert.throws(() => f.edit(created.id, { venue: "" }), invalid);
  const relocated = f.edit(created.id, { venue: "", city: "London, England, United Kingdom", eventAddress: "300 Event Lane" }).post;
  assert.equal(relocated.venueKey, null);
  assert.equal(relocated.city, "London, England, United Kingdom");
});

test("event addresses require city context and reject oversized or nontext input", () => {
  const f = fixture();
  assert.throws(() => f.create({ ...draft, city: "", eventAddress: "100 Event Lane" }), invalid);
  assert.throws(() => f.create({ ...draft, venue: "Known Room", city: "", eventAddress: "100 Event Lane" }), invalid);
  assert.throws(() => f.create({ ...draft, city: "" }), invalid);
  for (const eventAddress of [false, 12, {}, [], "x".repeat(241)]) assert.throws(() => f.create({ ...draft, eventAddress }), invalid);
  const max = f.create({ ...draft, eventAddress: "abcdefghij".repeat(24) });
  assert.equal(max.post.eventAddress.length, 240);
  const unicode = f.create({ ...draft, eventAddress: "\u{1F3DB}\u{1F333}".repeat(50) + " Event Entrance" });
  assert.ok(unicode.post.eventAddress.length <= 240);
  assert.throws(() => f.edit(max.id, { eventAddress: "x".repeat(241) }), invalid);
  const longCity = `A place with a long city name, A descriptive region, A country name`;
  assert.equal(f.create({ ...draft, city: longCity }).post.city, longCity);
});

test("status, memorial memories and online reviews cannot gain physical event addresses", () => {
  const f = fixture();
  for (const kind of ["status", "memory"]) assert.throws(() => f.create({ ...draft, kind, eventAddress: "100 Event Lane" }), invalid);
  const online = { ...draft, experienceType: "online", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" };
  assert.throws(() => f.create({ ...online, eventAddress: "100 Event Lane" }), invalid);
  const status = f.create({ kind: "status", review: "Hello" });
  assert.throws(() => f.edit(status.id, { eventAddress: "100 Event Lane" }), invalid);
  const created = f.create({ ...draft, eventAddress: "100 Event Lane" });
  const converted = f.edit(created.id, { experienceType: "online", youtubeUrl: online.youtubeUrl }).post;
  assert.equal(converted.eventAddress, null);
  assert.equal(db.prepare("SELECT event_address FROM posts WHERE id=?").get(created.id).event_address, null);
  assert.throws(() => f.edit(created.id, { eventAddress: "100 Event Lane" }), invalid);
});

test("author deletion scrubs the public event address", () => {
  const f = fixture(), created = f.create({ ...draft, eventAddress: "100 Event Lane" });
  routes["DELETE /api/posts/:id"]({ user: f.user, ip: "location-delete", params: { id: created.id } });
  assert.equal(db.prepare("SELECT event_address FROM posts WHERE id=?").get(created.id).event_address, null);
});

test("a rolled-back author deletion scrubs newer address fields while moderator hides preserve them", () => {
  const f = fixture(), created = f.create({ ...draft, eventAddress: "100 Event Lane", clientMutationId: "location_rollback_delete_001" });
  // This is the previous binary's complete author tombstone; it intentionally
  // knows nothing about event_address and retains its opaque retry token.
  db.prepare(`UPDATE posts SET removed=1,artist='',venue='',city='',date='',overall=0,
    band=NULL,room=NULL,dims='{}',review='',photos='[]',photos_public=0,landing_showcase=0,campaign=NULL,
    setlist='[]',tour=NULL,tags='[]',tagged_user_ids='[]',song=NULL,playlist=NULL,artist_key=NULL,artist_mbid=NULL,
    venue_key=NULL,experience_type='in_person',online_title=NULL,youtube_url=NULL,youtube_video_id=NULL,
    client_mutation_hash=NULL,updated_at=? WHERE id=?`).run(Date.now(), created.id);
  assert.equal(db.prepare("SELECT event_address FROM posts WHERE id=?").get(created.id).event_address, null);
  const hidden = f.create({ ...draft, eventAddress: "200 Public Event Lane" });
  db.prepare("UPDATE posts SET removed=1 WHERE id=?").run(hidden.id);
  assert.equal(db.prepare("SELECT event_address FROM posts WHERE id=?").get(hidden.id).event_address, "200 Public Event Lane");
});

test("legacy artist protection includes edits to the event address", () => {
  const f = fixture(), at = Date.now(), key = "location legacy artist", name = "Location Legacy Artist";
  const mbid = "12345678-1234-4234-8234-123456789abc";
  db.prepare("INSERT INTO artists(norm,name,mbid,created_at,updated_at) VALUES (?,?,?,?,?)").run(key, name, mbid, at, at);
  const created = f.create({ ...draft, artist: name, artistKey: key, eventAddress: "100 Event Lane" });
  db.prepare(`INSERT INTO artist_memorials (artist_key,artist_name,artist_mbid,status,death_date,summary,thank_you,accomplishments,source_url,published_at,spotlight_started_at,created_at,updated_at)
    VALUES (?,?,?,'published','1959-02-03','A protected historical artist archive.','Thank you','["A lasting legacy"]','https://example.com/legacy',?,?,?,?)`).run(key, name, mbid, at, at, at, at);
  assert.throws(() => f.edit(created.id, { eventAddress: "200 Event Lane" }), (error) => error.code === "ARTIST_LEGACY_READ_ONLY");
  assert.equal(db.prepare("SELECT event_address FROM posts WHERE id=?").get(created.id).event_address, "100 Event Lane");
});
