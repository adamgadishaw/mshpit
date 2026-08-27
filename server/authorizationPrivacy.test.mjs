import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-authorization-privacy-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q, badgeStmts } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

let sequence = 0;
function addUser(prefix, { role = "fan", artistName = null, name = null, createdAt = Date.now() } = {}) {
  sequence += 1;
  const id = `${prefix}_${sequence}`;
  const handle = `${prefix}${sequence}`.replace(/[^a-z0-9_]/gi, "").toLowerCase().slice(0, 24);
  q.insertUser.run(id, `${id}@example.com`, name || id, handle, "test-hash", role, "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", createdAt);
  if (artistName) db.prepare("UPDATE users SET artist_name=? WHERE id=?").run(artistName, id);
  return q.userById.get(id);
}

function readyImage(owner, suffix) {
  const token = `${suffix}${++sequence}`.replace(/[^A-Za-z0-9_-]/g, "").padEnd(12, "x");
  const id = `ma_${token}`;
  const sourceKey = `users/${owner.id}/post/${token}.jpg`;
  const sourceUrl = `pit-private:${sourceKey}`;
  const variantId = `mv_${token}`;
  const renderKey = `users/${owner.id}/post/${token}-render.webp`;
  const url = `https://pit-media.example/${renderKey}`;
  const at = Date.now();
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?, 'private','post',2048,'issued',?,?)`).run(sourceKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_objects
    (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at)
    VALUES (?,?, 'public','post',1024,'issued',?,?)`).run(renderKey, owner.id, at, at);
  db.prepare(`INSERT INTO media_assets
    (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,
      original_name,mime_type,byte_size,width,height,metadata_status,codec_status,status,source_verified_at,
      render_state,render_variant_id,created_at,updated_at)
    VALUES (?,?,?,?, 'post','image',?,?, 'private', 'photo.jpg','image/jpeg',2048,100,100,
      'declared','not_applicable','ready',?,'ready',?,?,?)`)
    .run(id, owner.id, `client-${token}`, "a".repeat(64), sourceKey, sourceUrl, at, variantId, at, at);
  db.prepare(`INSERT INTO media_variants
    (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,
      status,finalize_hash,verified_at,verification_origin,created_at,updated_at)
    VALUES (?,?,?,?,'render',?,?,'image/webp',1024,100,100,'verified',?,?, 'client',?,?)`)
    .run(variantId, id, `variant-${token}`, "b".repeat(64), renderKey, url, "c".repeat(64), at, at, at);
  return { id, url, key: renderKey };
}

function finalizedLegacyImage(owner, suffix, purpose) {
  const image = readyImage(owner, suffix);
  const token = `${suffix}legacy${++sequence}`.replace(/[^A-Za-z0-9_-]/g, "").padEnd(12, "x");
  const at = Date.now();
  db.prepare(`INSERT INTO legacy_media_finalize_descriptors
    (id,owner_id,token_hash,purpose,staging_object_key,staging_mime_type,staging_byte_size,
      output_mime_type,output_object_key,output_url,output_byte_size,width,height,status,expires_at,
      consumed_at,finalized_at,created_at,updated_at)
    VALUES (?,?,?,?,?,'image/jpeg',2048,'image/webp',?,?,1024,100,100,'finalized',?,?,?,?,?)`)
    .run(`lm_${token}`, owner.id, "d".repeat(64), purpose,
      `users/${owner.id}/${purpose}/${token}-staging.jpg`, image.key, image.url,
      at + 60_000, null, at, at, at);
  return image;
}

function throwsStatus(run, status, code = null) {
  assert.throws(run, (error) => error instanceof ApiError
    && error.status === status
    && (!code || error.code === code));
}

test("artist management follows owner_id even when two accounts share the same display artist", () => {
  const owner = addUser("artist_owner", { role: "artist", artistName: "Twin Artist" });
  const impostor = addUser("artist_impostor", { role: "artist", artistName: "Twin Artist" });
  const adminSeed = addUser("artist_admin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminSeed.id);
  const admin = q.userById.get(adminSeed.id);
  const key = "twin artist";
  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,bio,feed_enabled,updated_at) VALUES (?,?,?,?,?)")
    .run(key, owner.id, "Owner bio", 0, Date.now());
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("artist_owner_post", key, owner.id, "Private owner update", Date.now());

  throwsStatus(() => routes["PATCH /api/artists/:key/profile"]({
    user: impostor, ip: "artist-owner-patch", params: { key }, body: { bio: "stolen" },
  }), 403, "FORBIDDEN");
  throwsStatus(() => routes["POST /api/artists/:key/posts"]({
    user: impostor, ip: "artist-owner-post", params: { key }, body: { text: "stolen" },
  }), 403, "FORBIDDEN");
  throwsStatus(() => routes["DELETE /api/artists/:key/posts/:id"]({
    user: impostor, params: { key, id: "artist_owner_post" }, body: {},
  }), 403, "FORBIDDEN");
  assert.equal(db.prepare("SELECT bio FROM artist_profiles WHERE artist_key=?").get(key).bio, "Owner bio");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM artist_posts WHERE id='artist_owner_post'").get().count, 1);
  assert.deepEqual(routes["GET /api/artists/:key/profile"]({ user: impostor, params: { key } }).posts, []);
  assert.equal(routes["GET /api/artists/:key/profile"]({ user: owner, params: { key } }).posts.length, 1);
  assert.equal(routes["GET /api/artists/:key/profile"]({ user: admin, params: { key } }).posts.length, 1);
});

test("artist approval binds owner_id and refuses a duplicate normalized identity", () => {
  const adminSeed = addUser("approval_admin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminSeed.id);
  const admin = q.userById.get(adminSeed.id);
  const first = addUser("approval_first");
  const second = addUser("approval_second");
  const insert = db.prepare("INSERT INTO artist_requests (id,user_id,artist_name,note,status,created_at) VALUES (?,?,?,?, 'pending',?)");
  insert.run("request_first_artist", first.id, "Approval Artist", "", Date.now());
  insert.run("request_duplicate_artist", second.id, "  APPROVAL ARTIST  ", "", Date.now() + 1);
  db.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)")
    .run("approval-session", first.id, Date.now(), Date.now() + 60_000);

  assert.deepEqual(routes["POST /api/admin/artist-requests/:id/approve"]({
    user: admin, params: { id: "request_first_artist" }, body: {},
  }), { ok: true });
  assert.equal(db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key='approval artist'").get().owner_id, first.id);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sessions WHERE user_id=?").get(first.id).count, 0,
    "artist approval revokes cookies minted under the old role");
  throwsStatus(() => routes["POST /api/admin/artist-requests/:id/approve"]({
    user: admin, params: { id: "request_duplicate_artist" }, body: {},
  }), 409, "CONFLICT");
  assert.equal(q.userById.get(second.id).role, "fan");
  assert.equal(db.prepare("SELECT status FROM artist_requests WHERE id='request_duplicate_artist'").get().status, "pending");
});

test("staff role promotion remains pending and cannot change or revoke authority before Owner approval", async () => {
  const adminSeed = addUser("session_admin");
  db.prepare("UPDATE users SET role='admin' WHERE id=?").run(adminSeed.id);
  const admin = q.userById.get(adminSeed.id);
  const target = addUser("session_target");
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), target.id);
  const insert = db.prepare("INSERT INTO sessions (token_hash,user_id,created_at,expires_at) VALUES (?,?,?,?)");
  insert.run("target-session-a", target.id, Date.now(), Date.now() + 60_000);
  insert.run("target-session-b", target.id, Date.now(), Date.now() + 60_000);

  const result = await routes["POST /api/admin/users/:id/role"]({
    user: admin,
    params: { id: target.id },
    body: { role: "moderator", handle: "session_target_mod" },
    requestId: "role-session-test",
  });
  assert.equal(result.ok, true);
  assert.equal(result.pending, true);
  assert.equal("token" in result, false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM sessions WHERE user_id=?").get(target.id).count, 2);
  assert.equal(q.userById.get(target.id).role, "fan");
  assert.equal(db.prepare("SELECT COUNT(*) count FROM moderation_actions WHERE target_id=? AND action='change_role'").get(target.id).count, 0);
});

test("legacy artist pages are claimed only by one unambiguous matching account", () => {
  const solo = addUser("legacy_solo", { role: "artist", artistName: "Legacy Solo" });
  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,feed_enabled,updated_at) VALUES ('legacy solo',NULL,1,?)").run(Date.now());
  routes["PATCH /api/artists/:key/profile"]({
    user: solo, ip: "legacy-solo", params: { key: "legacy solo" }, body: { bio: "Claimed safely" },
  });
  const claimed = db.prepare("SELECT owner_id,bio FROM artist_profiles WHERE artist_key='legacy solo'").get();
  assert.equal(claimed.owner_id, solo.id);
  assert.equal(claimed.bio, "Claimed safely");

  const first = addUser("legacy_duo_a", { role: "artist", artistName: "Legacy Duo" });
  addUser("legacy_duo_b", { role: "artist", artistName: "Legacy Duo" });
  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,feed_enabled,updated_at) VALUES ('legacy duo',NULL,1,?)").run(Date.now());
  throwsStatus(() => routes["PATCH /api/artists/:key/profile"]({
    user: first, ip: "legacy-duo", params: { key: "legacy duo" }, body: { bio: "race winner" },
  }), 409, "CONFLICT");
  assert.equal(db.prepare("SELECT owner_id FROM artist_profiles WHERE artist_key='legacy duo'").get().owner_id, null);
});

test("blocked profiles cannot be probed through the standalone badge route", () => {
  const holder = addUser("badge_holder");
  const viewer = addUser("badge_viewer");
  badgeStmts.insert.run({
    id: "bdg_privacy_test", slug: "privacy-test", label: "Privacy", description: "",
    kind: "tier", color: "gold", glyph: "char", glyph_char: "P", created_by: viewer.id, created_at: Date.now(),
  });
  badgeStmts.grant.run(holder.id, "bdg_privacy_test", viewer.id, Date.now(), "");
  assert.equal(routes["GET /api/users/:id/badges"]({ user: viewer, params: { id: holder.id } }).badges.length, 1);
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(holder.id, viewer.id, Date.now());
  throwsStatus(() => routes["GET /api/users/:id/badges"]({ user: viewer, params: { id: holder.id } }), 404, "NOT_FOUND");
});

test("people discovery is signed-in, alphabetical, block-aware, and has no global count", () => {
  const viewer = addUser("people_viewer", { name: "Middle Viewer", createdAt: 10 });
  const alpha = addUser("people_alpha", { name: "Alpha Member", createdAt: 30 });
  const zulu = addUser("people_zulu", { name: "Zulu Member", createdAt: 20 });
  throwsStatus(() => routes["GET /api/people"]({ ip: "people-anon", query: { q: "member" } }), 401, "AUTH_REQUIRED");

  const browse = routes["GET /api/people"]({ user: viewer, ip: "people-browse", query: { q: "" } });
  assert.equal(browse.total, undefined);
  const alphaIndex = browse.users.findIndex((user) => user.id === alpha.id);
  const zuluIndex = browse.users.findIndex((user) => user.id === zulu.id);
  assert.ok(alphaIndex >= 0 && zuluIndex > alphaIndex, "empty browse is alphabetical, not newest-first");
  const search = routes["GET /api/people"]({ user: viewer, ip: "people-search", query: { q: "zulu" } });
  assert.equal(search.users[0]?.id, zulu.id, "signed-in handle discovery still works");
  assert.equal(search.total, undefined);

  const overview = routes["GET /api/discover/overview"]({ query: {}, setHeader() {} });
  assert.equal(overview.memberTotal, undefined);
});

test("anonymous attendance exposes only an aggregate while signed-in rows are minimal and block-aware", () => {
  const attendee = addUser("attendance_person");
  const viewer = addUser("attendance_viewer");
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), attendee.id);
  const key = "privacy artist|privacy venue|2099-01-01";
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,created_at) VALUES (?,?,?,?,?)")
    .run(attendee.id, key, "Privacy Artist", "Privacy Venue", Date.now());

  const guest = routes["GET /api/going/:key/attendees"]({ params: { key }, query: {} });
  assert.deepEqual({
    attendees: guest.attendees,
    total: guest.total,
    nextCursor: guest.nextCursor,
    viewerGoing: guest.viewerGoing,
  }, { attendees: [], total: 1, nextCursor: null, viewerGoing: false });
  assert.deepEqual(guest.stateCounts, { interested: 0, going: 1, here: 0, went: 0 });
  assert.equal(guest.liveStateRedacted, true);
  assert.equal(guest.verifiedAttendeeCount, 0);
  assert.equal(JSON.stringify(guest).includes(attendee.id), false,
    "additive show identity and aggregate fields cannot expose an attendee identity to guests");
  assert.throws(
    () => routes["GET /api/going/:key/attendees"]({ user: viewer, params: { key }, query: {} }),
    (error) => error.code === "EMAIL_VERIFICATION_REQUIRED",
  );
  const bannedViewer = addUser("attendance_banned");
  db.prepare("UPDATE users SET email_verified_at=?,is_banned=1 WHERE id=?").run(Date.now(), bannedViewer.id);
  assert.throws(
    () => routes["GET /api/going/:key/attendees"]({ user: q.userById.get(bannedViewer.id), params: { key }, query: {} }),
    (error) => error.code === "FORBIDDEN",
  );
  const suspendedViewer = addUser("attendance_suspended");
  db.prepare("UPDATE users SET email_verified_at=?,suspended_until=? WHERE id=?")
    .run(Date.now(), Date.now() + 60_000, suspendedViewer.id);
  assert.throws(
    () => routes["GET /api/going/:key/attendees"]({ user: q.userById.get(suspendedViewer.id), params: { key }, query: {} }),
    (error) => error.code === "FORBIDDEN",
  );
  db.prepare("UPDATE users SET email_verified_at=? WHERE id=?").run(Date.now(), viewer.id);
  const verifiedViewer = q.userById.get(viewer.id);
  const signedIn = routes["GET /api/going/:key/attendees"]({ user: verifiedViewer, params: { key }, query: {} });
  assert.equal(signedIn.attendees[0].id, attendee.id);
  assert.equal(signedIn.attendees[0].home, undefined);
  assert.deepEqual(Object.keys(signedIn.attendees[0]).sort(),
    ["avatarColor", "avatarUri", "handle", "id", "initials", "name", "role", "state", "verified", "verifiedAttendance"].sort());
  db.prepare("INSERT INTO blocks (blocker_id,blocked_id,created_at) VALUES (?,?,?)").run(attendee.id, viewer.id, Date.now());
  const blocked = routes["GET /api/going/:key/attendees"]({ user: verifiedViewer, params: { key }, query: {} });
  assert.deepEqual(blocked.attendees, []);
  assert.equal(blocked.total, 0);
});

test("new profile, artist, and venue-review media must be a ready image owned by the actor", () => {
  const owner = addUser("media_boundary_owner", { role: "artist", artistName: "Media Boundary Artist" });
  const other = addUser("media_boundary_other");
  const ownProfile = finalizedLegacyImage(owner, "ownprofile", "banner");
  const ownArtist = finalizedLegacyImage(owner, "ownartist", "banner");
  const ownReviewAlbum = Array.from({ length: 20 }, (_, index) =>
    finalizedLegacyImage(owner, `ownreview${index}`, "venue").url);
  const foreign = finalizedLegacyImage(other, "foreign", "banner");
  const clientAuthoredOnly = readyImage(owner, "rawclientvariant");
  const external = "https://attacker.example/upload.jpg";

  for (const url of [external, foreign.url, clientAuthoredOnly.url]) {
    throwsStatus(() => routes["PATCH /api/me"]({
      user: owner, ip: `profile-media-${url === external ? "external" : "foreign"}`, body: { banner: url },
    }), 400, "VALIDATION_FAILED");
  }
  assert.equal(routes["PATCH /api/me"]({
    user: owner, ip: "profile-media-own", body: { banner: ownProfile.url },
  }).user.banner, ownProfile.url);
  assert.equal(routes["GET /api/users/:id"]({ user: other, params: { id: owner.id } }).user.banner, ownProfile.url,
    "verified owned renditions remain publicly projectable");

  // Existing URL-only records remain editable when the media value is unchanged;
  // this boundary rejects new references rather than corrupting legacy profiles.
  db.prepare("UPDATE users SET banner=? WHERE id=?").run(external, owner.id);
  assert.equal(routes["PATCH /api/me"]({
    user: q.userById.get(owner.id), ip: "profile-media-legacy", body: { banner: external, bio: "Legacy retained" },
  }).user.banner, external);
  throwsStatus(() => routes["PATCH /api/me"]({
    user: q.userById.get(owner.id), ip: "profile-media-legacy-copy", body: { avatarUri: external },
  }), 400, "VALIDATION_FAILED");

  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,banner,feed_enabled,updated_at) VALUES (?,?,?,?,?)")
    .run("media boundary artist", owner.id, external, 1, Date.now());
  throwsStatus(() => routes["PATCH /api/artists/:key/profile"]({
    user: q.userById.get(owner.id), ip: "artist-media-foreign", params: { key: "media boundary artist" }, body: { banner: foreign.url },
  }), 400, "VALIDATION_FAILED");
  assert.deepEqual(routes["PATCH /api/artists/:key/profile"]({
    user: q.userById.get(owner.id), ip: "artist-media-legacy", params: { key: "media boundary artist" }, body: { banner: external, bio: "Still editable" },
  }), { ok: true });
  throwsStatus(() => routes["PATCH /api/artists/:key/profile"]({
    user: q.userById.get(owner.id), ip: "artist-media-legacy-copy", params: { key: "media boundary artist" }, body: { avatarUri: external },
  }), 400, "VALIDATION_FAILED");
  routes["PATCH /api/artists/:key/profile"]({
    user: q.userById.get(owner.id), ip: "artist-media-own", params: { key: "media boundary artist" }, body: { banner: ownArtist.url },
  });
  assert.equal(db.prepare("SELECT banner FROM artist_profiles WHERE artist_key='media boundary artist'").get().banner, ownArtist.url);
  assert.equal(routes["GET /api/artists/:key/profile"]({ user: other, params: { key: "media boundary artist" } }).profile.banner, ownArtist.url);

  for (const url of [external, foreign.url]) {
    throwsStatus(() => routes["POST /api/venues/:key/reviews"]({
      user: q.userById.get(owner.id), ip: `venue-media-${url === external ? "external" : "foreign"}`,
      params: { key: "media venue" }, body: { rating: 4, text: "Review", photos: [url] },
    }), 400, "VALIDATION_FAILED");
  }
  const review = routes["POST /api/venues/:key/reviews"]({
    user: q.userById.get(owner.id), ip: "venue-media-own", params: { key: "media venue" },
    body: { rating: 4, text: "Review", photos: ownReviewAlbum },
  });
  assert.deepEqual(JSON.parse(db.prepare("SELECT photos FROM venue_reviews WHERE id=?").get(review.id).photos), ownReviewAlbum);
  assert.deepEqual(routes["GET /api/venues/:key/reviews"]({
    user: other, params: { key: "media venue" }, query: {},
  }).reviews.find((row) => row.id === review.id).photos, ownReviewAlbum);
});

test("legacy attacker media is retained for self-service but omitted from every public API projection", () => {
  const owner = addUser("legacy_media_owner", { role: "artist", artistName: "Legacy Media Artist" });
  const viewer = addUser("legacy_media_viewer");
  const attackerAvatar = "https://attacker.example/avatar.jpg";
  const attackerBanner = "https://attacker.example/banner.jpg";
  const attackerPost = "https://attacker.example/post.jpg";
  const attackerVenue = "https://attacker.example/venue.jpg";
  db.prepare("UPDATE users SET avatar_uri=?,banner=? WHERE id=?").run(attackerAvatar, attackerBanner, owner.id);
  db.prepare("INSERT INTO posts (id,user_id,artist,venue,overall,photos,photos_public,created_at) VALUES (?,?,?,?,?,?,1,?)")
    .run("legacy_attacker_post", owner.id, "Legacy Media Artist", "Legacy Venue", 4, JSON.stringify([attackerPost]), Date.now());
  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,banner,avatar_uri,feed_enabled,updated_at) VALUES (?,?,?,?,1,?)")
    .run("legacy media artist", owner.id, attackerBanner, attackerAvatar, Date.now());
  db.prepare("INSERT INTO venue_reviews (id,venue_key,user_id,rating,text,photos,created_at) VALUES (?,?,?,?,?,?,?)")
    .run("legacy_attacker_review", "legacy venue", owner.id, 4, "Legacy review", JSON.stringify([attackerVenue]), Date.now());

  const self = routes["GET /api/me"]({ user: q.userById.get(owner.id) }).user;
  assert.equal(self.avatarUri, attackerAvatar, "the owner can still identify and replace a legacy value");
  const profile = routes["GET /api/users/:id"]({ user: viewer, params: { id: owner.id } }).user;
  assert.equal(profile.avatarUri, null);
  assert.equal(profile.banner, null);
  db.prepare("UPDATE users SET role='moderator' WHERE id=?").run(viewer.id);
  const member = routes["GET /api/admin/members"]({
    user: q.userById.get(viewer.id), query: { q: owner.handle }, setHeader() {},
  }).users.find((candidate) => candidate.id === owner.id);
  assert.equal(member.avatarUri, null, "staff projectors also avoid fetching a member's legacy external avatar");

  const post = routes["GET /api/posts/:id"]({ user: viewer, params: { id: "legacy_attacker_post" } }).post;
  assert.equal(post.user.avatarUri, null);
  assert.deepEqual(post.photos, []);
  assert.deepEqual(post.media, []);
  const gallery = routes["GET /api/artists/photos"]({
    user: viewer, ip: "legacy-attacker-gallery", query: { name: "Legacy Media Artist" },
  });
  assert.equal(gallery.photos.some((photo) => photo.uri === attackerPost), false);

  const artist = routes["GET /api/artists/:key/profile"]({ user: viewer, params: { key: "legacy media artist" } });
  assert.equal(artist.profile.banner, null);
  assert.equal(artist.profile.avatarUri, null);
  const venue = routes["GET /api/venues/:key/reviews"]({
    user: viewer, params: { key: "legacy venue" }, query: {},
  });
  assert.deepEqual(venue.reviews.find((review) => review.id === "legacy_attacker_review").photos, []);
});
