import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-legacy-artist-policy-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const ARTIST_KEY = "legacy policy artist 1959";
const ARTIST_NAME = "Legacy Policy Artist 1959";
const ARTIST_MBID = "12345678-1234-4234-8234-123456789abc";
const LIVING_ARTIST_KEY = "living policy artist";
const LIVING_ARTIST_NAME = "Living Policy Artist";
const LEGACY_FREE_FORM_ROOM = "Legacy\u00a0\u00a0Policy Artist 1959";
const UNRESOLVED_FAN_CLUB = "Orphaned Fan Club Room";
const AMBIGUOUS_FAN_CLUB = "Ambiguous\u00a0 Fan Club Artist";

function addUser(id, role = "fan", artistName = null) {
  q.insertUser.run(id, id + "@example.com", id, id, "test-hash", role,
    "Toronto", 43.65, -79.38, id.slice(0, 2).toUpperCase(), "#123456", Date.now());
  if (artistName) db.prepare("UPDATE users SET artist_name=? WHERE id=?").run(artistName, id);
  return q.userById.get(id);
}

function legacyError(error) {
  return error instanceof ApiError
    && error.status === 409
    && error.code === "ARTIST_LEGACY_READ_ONLY";
}

function reconciliationError(error) {
  return error instanceof ApiError
    && error.status === 409
    && error.code === "CONFLICT";
}

function addReadyGalleryImage(ownerId, suffix = "legacy_gallery_image") {
  const assetId = "ma_" + suffix;
  const variantId = "mv_" + suffix;
  const sourceKey = "users/" + ownerId + "/post/" + suffix + "-source.jpg";
  const renderKey = "users/" + ownerId + "/post/" + suffix + "-safe.jpg";
  const renderUrl = "https://media.example.com/cdn/" + renderKey;
  const at = Date.now();
  db.prepare("INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at) VALUES (?,?,?,?,?,'issued',?,?)")
    .run(sourceKey, ownerId, "private", "post", 4096, at, at);
  db.prepare("INSERT INTO media_objects (object_key,owner_id,storage_scope,purpose,byte_size,status,created_at,updated_at) VALUES (?,?,?,?,?,'issued',?,?)")
    .run(renderKey, ownerId, "public", "post", 2048, at, at);
  db.prepare("INSERT INTO media_assets (id,owner_id,client_asset_id,create_hash,purpose,kind,source_key,source_url,source_storage_scope,original_name,mime_type,byte_size,width,height,orientation,metadata_status,codec_status,status,edit_recipe,recipe_version,finalize_hash,source_verified_at,render_state,render_variant_id,created_at,updated_at) VALUES (?,?,?,?,?,'image',?,?,?,'legacy.jpg','image/jpeg',4096,1200,1500,0,'declared','not_applicable','ready','{}',1,?,?,'ready',?,?,?)")
    .run(assetId, ownerId, "client_" + suffix, "a".repeat(64), "post",
      sourceKey, "pit-private:" + sourceKey, "private", "b".repeat(64), at, variantId, at, at);
  db.prepare("INSERT INTO media_variants (id,asset_id,client_variant_id,create_hash,role,object_key,public_url,mime_type,byte_size,width,height,status,finalize_hash,verified_at,verification_origin,created_at,updated_at) VALUES (?,?,?,?,'render',?,?,'image/jpeg',2048,1200,1500,'verified',?,?,'private_derivative_v1',?,?)")
    .run(variantId, assetId, "client_" + variantId, "c".repeat(64),
      renderKey, renderUrl, "d".repeat(64), at, at, at);
  return { assetId, renderUrl, at };
}

test("legacy artist APIs freeze ownership and media services but keep written community interaction", async () => {
  const timestamp = Date.now();
  db.prepare("INSERT INTO artists (norm,name,public_slug,mbid,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(ARTIST_KEY, ARTIST_NAME, "legacy-policy-artist-1959", ARTIST_MBID, timestamp, timestamp);
  db.prepare("INSERT INTO artists (norm,name,public_slug,mbid,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(LIVING_ARTIST_KEY, LIVING_ARTIST_NAME, "living-policy-artist",
      "22345678-1234-4234-8234-123456789abc", timestamp, timestamp);
  db.prepare("INSERT INTO artists (norm,name,public_slug,mbid,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("ambiguous fan club artist a", "Ambiguous Fan Club Artist", "ambiguous-fan-club-artist-a",
      "32345678-1234-4234-8234-123456789abc", timestamp, timestamp);
  db.prepare("INSERT INTO artists (norm,name,public_slug,mbid,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("ambiguous fan club artist b", "Ambiguous Fan Club Artist", "ambiguous-fan-club-artist-b",
      "42345678-1234-4234-8234-123456789abc", timestamp, timestamp);
  db.prepare("INSERT INTO artist_memorials (artist_key,artist_name,artist_mbid,status,death_date,summary,thank_you,accomplishments,source_url,published_at,spotlight_started_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(ARTIST_KEY, ARTIST_NAME, ARTIST_MBID, "published", "1959-02-03",
      "A verified legacy memorial used to protect historical artist pages.",
      "Thank you for the music.", JSON.stringify(["A lasting musical legacy"]),
      "https://example.com/legacy-artist", timestamp, timestamp, timestamp, timestamp);

  const artist = addUser("legacyartistowner", "artist", ARTIST_NAME);
  const admin = addUser("legacyartistadmin", "admin");
  const fan = addUser("legacyartistfan");
  const commenter = addUser("legacycommenter");
  db.prepare("INSERT INTO artist_profiles (artist_key,owner_id,bio,feed_enabled,updated_at) VALUES (?,?,?,?,?)")
    .run(ARTIST_KEY, artist.id, "Old artist-authored biography.", 1, timestamp);
  db.prepare("INSERT INTO artist_posts (id,artist_key,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("legacy_owner_update", ARTIST_KEY, artist.id, "Old owner update.", timestamp);

  await assert.rejects(routes["GET /api/artists/discography"]({
    ip: "legacy-discography-key",
    query: { name: "legacy-policy-artist-1959" },
  }), legacyError, "the canonical public artist key cannot fetch a legacy discography");
  await assert.rejects(routes["POST /api/artists/discography/selection"]({
    user: fan,
    ip: "legacy-discography-name",
    body: { name: ARTIST_NAME, deezerId: "123" },
  }), legacyError, "a display-name request cannot select a legacy music provider identity");
  await assert.rejects(routes["GET /api/artists/discography"]({
    ip: "legacy-discography-forged-name",
    query: { name: "Legacy  Policy Artist 1959" },
  }), legacyError, "spacing variants cannot bypass the canonical legacy identity policy");
  await assert.rejects(routes["GET /api/artists/candidates"]({
    ip: "legacy-discography-candidates",
    query: { name: ARTIST_NAME },
  }), legacyError, "legacy profiles cannot invoke provider-backed music identity search");
  await assert.rejects(routes["GET /api/deezer/track"]({
    ip: "legacy-deezer-playback",
    query: { title: "Archive recording", artist: ARTIST_NAME },
  }), legacyError, "a direct Deezer preview request cannot bypass the closed legacy music service");
  await assert.rejects(routes["GET /api/youtube/track"]({
    ip: "legacy-youtube-read",
    query: { title: "Archive recording", artist: "Legacy  Policy Artist 1959" },
  }), legacyError, "a direct YouTube cache/playback read cannot bypass the Unicode-safe legacy identity policy");
  await assert.rejects(routes["POST /api/youtube/track/resolve"]({
    user: admin,
    ip: "legacy-youtube-resolve",
    body: { title: "Archive recording", artist: ARTIST_NAME },
  }), legacyError, "an authenticated direct YouTube resolution cannot reopen legacy playback");

  const exactRatingRef = `${ARTIST_KEY}|archive album`;
  assert.throws(() => routes["GET /api/ratings"]({
    user: fan, query: { kind: "album", ref: exactRatingRef },
  }), legacyError);
  assert.throws(() => routes["POST /api/ratings"]({
    user: fan,
    ip: "legacy-rating-forged-name",
    body: { kind: "song", ref: "legacy  policy artist 1959|archive song", rating: 5 },
  }), legacyError, "a forged display-name segment cannot create a legacy track rating");
  const livingRating = routes["POST /api/ratings"]({
    user: fan,
    ip: "living-rating",
    body: { kind: "album", ref: "living policy artist|current album", rating: 4 },
  });
  assert.deepEqual(livingRating, { avg: 4, count: 1, mine: 4 },
    "living artist rating behavior remains unchanged");

  assert.throws(() => routes["PATCH /api/artists/:key/profile"]({
    user: artist, ip: "legacy-profile-edit", params: { key: ARTIST_KEY },
    body: { bio: "This should not publish." },
  }), legacyError);
  assert.throws(() => routes["POST /api/artists/:key/posts"]({
    user: artist, ip: "legacy-owner-post", params: { key: ARTIST_KEY },
    body: { text: "This should not publish." },
  }), legacyError);
  assert.throws(() => routes["POST /api/artist-requests"]({
    user: fan, ip: "legacy-claim", body: { artistName: ARTIST_NAME },
  }), legacyError);
  assert.throws(() => routes["POST /api/posts"]({
    user: artist,
    ip: "legacy-artist-drop",
    body: {
      kind: "status",
      review: "A stale artist session must not revive official promotion.",
      campaign: { version: 1, treatment: "spotlight" },
    },
  }), legacyError);

  const staffEdit = routes["PATCH /api/artists/:key/profile"]({
    user: admin, ip: "legacy-staff-profile", params: { key: ARTIST_KEY },
    body: { bio: "A staff-maintained historical note." },
  });
  assert.equal(staffEdit.ok, true);
  assert.equal(staffEdit.profile.bio, "A staff-maintained historical note.");
  const storedStaffBio = db.prepare("SELECT bio,bio_staff_curated FROM artist_profiles WHERE artist_key=?").get(ARTIST_KEY);
  assert.equal(storedStaffBio.bio, "A staff-maintained historical note.");
  assert.equal(storedStaffBio.bio_staff_curated, 1);

  assert.deepEqual(routes["DELETE /api/artists/:key/posts/:id"]({
    user: artist, params: { key: ARTIST_KEY, id: "legacy_owner_update" },
  }), { ok: true });
  const curated = routes["POST /api/artists/:key/posts"]({
    user: admin, ip: "legacy-admin-post", params: { key: ARTIST_KEY },
    body: { text: "A staff-curated educational note." },
  });
  assert.ok(curated.id);
  assert.deepEqual(routes["DELETE /api/artists/:key/posts/:id"]({
    user: artist, params: { key: ARTIST_KEY, id: curated.id },
  }), { ok: true });
  assert.ok(db.prepare("SELECT 1 FROM artist_posts WHERE id=?").get(curated.id),
    "a former owner cannot delete a staff-curated legacy note");
  const publicProfile = routes["GET /api/artists/:key/profile"]({ params: { key: ARTIST_KEY } });
  assert.equal(publicProfile.legacyProfile, true);
  assert.equal(publicProfile.profile.ownerId, null);
  assert.equal(publicProfile.profile.bio, "A staff-maintained historical note.");
  assert.deepEqual(publicProfile.posts.map((post) => post.text), ["A staff-curated educational note."]);
  const catalogResult = routes["GET /api/artists"]({
    ip: "legacy-fan-club-catalog-policy",
    query: { q: ARTIST_NAME, limit: 5 },
  });
  assert.equal(catalogResult.artists.find((entry) => entry.key === ARTIST_KEY)?.fanClubAvailable, false,
    "artist search explicitly marks protected legacy fan clubs unavailable");

  const legacyLoungeKey = `${ARTIST_NAME}|Historical Hall|1959-02-02`.toLowerCase();
  db.prepare("INSERT INTO going (user_id,concert_key,artist,venue,date,created_at) VALUES (?,?,?,?,?,?)")
    .run(fan.id, legacyLoungeKey, ARTIST_NAME, "Historical Hall", "1959-02-02", timestamp);
  db.prepare("INSERT INTO lounge_messages (id,lounge_id,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("legacy_lounge_message", legacyLoungeKey, fan.id, "A message from before the legacy transition.", timestamp);
  const legacyLoungeParam = encodeURIComponent(legacyLoungeKey);
  assert.throws(() => routes["GET /api/lounges/:key/meta"]({
    params: { key: legacyLoungeParam },
  }), legacyError, "a public lounge gate closes after the artist becomes legacy");
  assert.throws(() => routes["GET /api/lounges/:key/messages"]({
    user: fan, params: { key: legacyLoungeParam }, query: {},
  }), legacyError, "a pre-transition attendee cannot read the old live lounge");
  assert.throws(() => routes["POST /api/lounges/:key/messages"]({
    user: fan,
    ip: "legacy-lounge-write",
    params: { key: legacyLoungeParam },
    body: { text: "This old live room must remain closed." },
  }), legacyError, "a pre-transition attendee cannot add another lounge message");
  const sidebar = routes["GET /api/discovery/sidebar"]({
    user: fan,
    ip: "legacy-lounge-directory",
    query: {},
  });
  assert.equal(sidebar.popularLounges.some((room) => room.key === legacyLoungeKey), false,
    "protected legacy lounges are removed from live discovery");
  routes["GET /api/artists/:key/profile"]({ user: fan, params: { key: ARTIST_KEY } });
  assert.equal(db.prepare("SELECT 1 FROM artist_tourdate_refresh_queue WHERE artist_key=?").get(ARTIST_KEY), undefined,
    "legacy profile reads never enqueue live tour refresh work");
  assert.throws(() => routes["GET /api/artists/archive"]({
    user: fan,
    ip: "legacy-direct-archive",
    query: { artistKey: ARTIST_KEY, name: ARTIST_NAME },
  }), legacyError);
  assert.throws(() => routes["GET /api/artists/archive/reviews"]({
    user: fan,
    ip: "legacy-direct-archive-reviews",
    query: { artistKey: ARTIST_KEY, name: ARTIST_NAME },
  }), legacyError);
  assert.throws(() => routes["GET /api/artists/archive"]({
    user: fan,
    ip: "legacy-name-only-archive",
    query: { name: ARTIST_NAME },
  }), (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED");
  assert.throws(() => routes["POST /api/tourdates"]({
    user: artist,
    ip: "legacy-tour-date-write",
    body: {
      artist: ARTIST_NAME,
      releaseAt: 0,
      dates: [{ venue: "Historic Hall", place: "Toronto, Ontario", date: "1968-06-15" }],
    },
  }), legacyError);

  const historicalImage = addReadyGalleryImage(fan.id);
  db.prepare("INSERT INTO posts (id,user_id,kind,artist,artist_key,artist_mbid,venue,overall,review,photos,photos_public,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)")
    .run("legacy_historical_photo", fan.id, "status", ARTIST_NAME, ARTIST_KEY, ARTIST_MBID,
      "", 0, "An existing approved community photo.", JSON.stringify([historicalImage.renderUrl]), historicalImage.at);
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)")
    .run("legacy_historical_photo", historicalImage.assetId, historicalImage.at);
  const historicalGallery = routes["GET /api/artists/photos"]({
    user: fan,
    ip: "legacy-gallery-read",
    query: { name: ARTIST_NAME, artistKey: ARTIST_KEY },
  });
  assert.equal(historicalGallery.photos.some((photo) => photo.postId === "legacy_historical_photo"), true,
    "existing verified community photos remain readable on legacy profiles");

  const existingReviewImage = addReadyGalleryImage(fan.id, "legacy_review_existing");
  db.prepare("INSERT INTO posts (id,user_id,kind,artist,artist_key,artist_mbid,venue,overall,review,photos,photos_public,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?)")
    .run("legacy_historical_review", fan.id, "review", ARTIST_NAME, ARTIST_KEY, ARTIST_MBID,
      "Historical Hall", 4, "An older review with an approved image.", JSON.stringify([existingReviewImage.renderUrl]), existingReviewImage.at);
  db.prepare("INSERT INTO post_media (post_id,asset_id,position,created_at) VALUES (?,?,0,?)")
    .run("legacy_historical_review", existingReviewImage.assetId, existingReviewImage.at);
  const reviewCleanup = routes["PATCH /api/posts/:id"]({
    user: fan, ip: "legacy-review-cleanup", params: { id: "legacy_historical_review" },
    body: { mediaAssetIds: [], photosPublic: false, version: existingReviewImage.at },
  });
  assert.deepEqual(reviewCleanup.post.photos, [], "old review media can still be removed");
  const replacementImage = addReadyGalleryImage(fan.id, "legacy_review_replacement");
  assert.throws(() => routes["PATCH /api/posts/:id"]({
    user: fan, ip: "legacy-review-date-edit", params: { id: "legacy_historical_review" },
    body: {
      date: "1960-01-01",
      venue: "Changed Historical Hall",
      tour: "Changed Legacy Tour",
      version: reviewCleanup.post.version,
    },
  }), legacyError);
  assert.throws(() => routes["PATCH /api/posts/:id"]({
    user: fan, ip: "legacy-review-media-add", params: { id: "legacy_historical_review" },
    body: {
      mediaAssetIds: [replacementImage.assetId],
      photosPublic: true,
      version: reviewCleanup.post.version,
    },
  }), legacyError);

  const onlineCreatedAt = timestamp + 10;
  db.prepare("INSERT INTO posts (id,user_id,kind,artist,artist_key,artist_mbid,venue,city,date,overall,review,experience_type,online_title,youtube_url,youtube_video_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run("legacy_historical_online_review", fan.id, "review", ARTIST_NAME, ARTIST_KEY, ARTIST_MBID,
      "", "", "", 4, "An older online review.", "online", "Archive stream",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ", onlineCreatedAt);
  assert.throws(() => routes["PATCH /api/posts/:id"]({
    user: fan, ip: "legacy-review-video-replace", params: { id: "legacy_historical_online_review" },
    body: {
      youtubeUrl: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      youtubeVideoId: "9bZkp7q19f0",
      version: onlineCreatedAt,
    },
  }), legacyError);

  const create = routes["POST /api/posts"];
  const memory = create({
    user: fan,
    ip: "legacy-memory-create",
    body: {
      kind: "memory",
      artist: ARTIST_NAME,
      artistKey: ARTIST_KEY,
      review: "Their recordings still matter to listeners today.",
    },
  });
  assert.equal(memory.post.artistKey, ARTIST_KEY);
  assert.throws(() => create({
    user: fan,
    ip: "legacy-memory-photo",
    body: {
      kind: "memory", artist: ARTIST_NAME, artistKey: ARTIST_KEY,
      review: "Trying to attach an image.",
      photos: ["https://cdn.example.com/unverified.jpg"],
    },
  }), legacyError);
  assert.throws(() => create({
    user: fan,
    ip: "legacy-memory-playlist",
    body: {
      kind: "memory", artist: ARTIST_NAME, artistKey: ARTIST_KEY,
      review: "Trying to attach a playlist.",
      playlistId: "legacy-playlist",
    },
  }), legacyError);
  assert.throws(() => create({
    user: fan,
    ip: "legacy-memory-song",
    body: {
      kind: "memory", artist: ARTIST_NAME, artistKey: ARTIST_KEY,
      review: "Trying to attach a song.",
      song: { url: "https://youtu.be/dQw4w9WgXcQ", title: "A song" },
    },
  }), legacyError);

  // A response may be lost just before the profile crosses the legacy cutoff.
  // Replaying that exact committed mutation must return the same row, while a
  // changed mutation remains prohibited.
  db.prepare("UPDATE artist_memorials SET death_date='1975-02-03' WHERE artist_key=?").run(ARTIST_KEY);
  const retryImage = addReadyGalleryImage(fan.id, "legacy_exact_retry");
  const retryBody = {
    kind: "memory",
    clientMutationId: "legacy_media_retry_001",
    artist: ARTIST_NAME,
    artistKey: ARTIST_KEY,
    review: "A committed memory whose response will be retried exactly.",
    mediaAssetIds: [retryImage.assetId],
    photosPublic: true,
  };
  const firstRetryWrite = create({ user: fan, ip: "legacy-retry-first", body: retryBody });
  db.prepare("UPDATE artist_memorials SET death_date='1959-02-03' WHERE artist_key=?").run(ARTIST_KEY);
  const exactRetry = create({ user: fan, ip: "legacy-retry-exact", body: retryBody });
  assert.equal(exactRetry.duplicate, true);
  assert.equal(exactRetry.id, firstRetryWrite.id);
  assert.throws(() => create({
    user: fan,
    ip: "legacy-retry-changed",
    body: { ...retryBody, review: "A changed retry must never republish legacy media." },
  }), (error) => error instanceof ApiError
    && error.status === 409
    && ["ARTIST_LEGACY_READ_ONLY", "POST_MUTATION_CONFLICT"].includes(error.code));

  const edited = routes["PATCH /api/posts/:id"]({
    user: fan, ip: "legacy-memory-edit", params: { id: memory.id },
    body: {
      review: "Their recordings and influence still matter to listeners today.",
      version: memory.post.version,
    },
  });
  assert.match(edited.post.review, /influence/u);
  db.prepare("UPDATE posts SET playlist=? WHERE id=?")
    .run(JSON.stringify({ id: "historical-playlist", name: "Historical playlist" }), memory.id);
  const cleaned = routes["PATCH /api/posts/:id"]({
    user: fan, ip: "legacy-memory-playlist-cleanup", params: { id: memory.id },
    body: { playlistId: null, version: edited.post.version },
  });
  assert.equal(cleaned.post.playlist, null, "an old playlist can be removed after the profile becomes protected");
  assert.throws(() => routes["PATCH /api/posts/:id"]({
    user: fan, ip: "legacy-memory-song-edit", params: { id: memory.id },
    body: {
      song: { url: "https://youtu.be/dQw4w9WgXcQ", title: "A song" },
      version: cleaned.post.version,
    },
  }), legacyError);
  assert.throws(() => routes["PATCH /api/posts/:id"]({
    user: fan, ip: "legacy-memory-playlist-edit", params: { id: memory.id },
    body: { playlistId: "legacy-playlist", version: cleaned.post.version },
  }), legacyError);
  assert.ok(routes["POST /api/posts/:id/comments"]({
    user: commenter, ip: "legacy-comment", params: { id: memory.id },
    body: { text: "This is why their work is still remembered." },
  }).id);

  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)")
    .run(ARTIST_NAME.toLowerCase(), fan.id);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)")
    .run("legacy-policy-artist-1959", fan.id);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)")
    .run(LEGACY_FREE_FORM_ROOM, fan.id);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)")
    .run(LIVING_ARTIST_NAME.toLowerCase(), fan.id);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)")
    .run(UNRESOLVED_FAN_CLUB.toLowerCase(), fan.id);
  db.prepare("INSERT INTO fan_club_members (artist,user_id) VALUES (?,?)")
    .run(AMBIGUOUS_FAN_CLUB, fan.id);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("legacy_unbound_fan_message", LEGACY_FREE_FORM_ROOM, fan.id,
      "A message in the historical unbound room.", timestamp);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("unresolved_fan_message", UNRESOLVED_FAN_CLUB.toLowerCase(), fan.id,
      "A message waiting for staff identity reconciliation.", timestamp);
  db.prepare("INSERT INTO fan_club_messages (id,artist,user_id,text,created_at) VALUES (?,?,?,?,?)")
    .run("ambiguous_fan_message", AMBIGUOUS_FAN_CLUB, fan.id,
      "A message whose same-name artist is ambiguous.", timestamp);
  assert.deepEqual(routes["GET /api/me/fanclubs"]({ user: fan }).artists, [LIVING_ARTIST_NAME.toLowerCase()]);
  assert.deepEqual(routes["GET /api/fanclubs"]({ ip: "legacy-directory" })
    .clubs.map((club) => club.artist), [LIVING_ARTIST_NAME.toLowerCase()]);
  assert.throws(() => routes["GET /api/fanclubs/:artist/meta"]({
    params: { artist: ARTIST_NAME.toLowerCase() },
  }), legacyError);
  assert.throws(() => routes["GET /api/fanclubs/:artist/meta"]({
    params: { artist: "legacy-policy-artist-1959" },
  }), legacyError);
  assert.throws(() => routes["GET /api/fanclubs/:artist/messages"]({
    user: fan, params: { artist: ARTIST_NAME.toLowerCase() }, query: {},
  }), legacyError);
  assert.throws(() => routes["POST /api/fanclubs/:artist/messages"]({
    user: fan, ip: "legacy-club-message", params: { artist: ARTIST_NAME.toLowerCase() },
    body: { text: "This room is closed." },
  }), legacyError);
  assert.throws(() => routes["GET /api/fanclubs/:artist/messages"]({
    user: fan, params: { artist: LEGACY_FREE_FORM_ROOM }, query: {},
  }), legacyError, "a Unicode-spacing legacy room cannot expose its seeded conversation");
  assert.throws(() => routes["POST /api/fanclubs/:artist/messages"]({
    user: fan, ip: "legacy-unbound-message", params: { artist: LEGACY_FREE_FORM_ROOM },
    body: { text: "This old room must remain frozen." },
  }), legacyError, "a Unicode-spacing legacy room cannot accept new messages");
  assert.throws(() => routes["POST /api/fanclubs/:artist/join"]({
    user: fan, ip: "legacy-slug-join", params: { artist: "legacy-policy-artist-1959" },
    body: { joined: true },
  }), legacyError);
  assert.throws(() => routes["POST /api/fanclubs/:artist/join"]({
    user: fan, ip: "legacy-unknown-club", params: { artist: "legacy policy artist 1959 typo" },
    body: { joined: true },
  }), reconciliationError);
  for (const [artistName, label] of [
    [UNRESOLVED_FAN_CLUB, "unresolved"],
    [AMBIGUOUS_FAN_CLUB, "ambiguous"],
  ]) {
    assert.throws(() => routes["GET /api/fanclubs/:artist/meta"]({
      params: { artist: artistName },
    }), reconciliationError, `${label} rooms are not publicly listed before staff reconciliation`);
    assert.throws(() => routes["GET /api/fanclubs/:artist/messages"]({
      user: fan, params: { artist: artistName }, query: {},
    }), reconciliationError, `${label} seeded conversations remain closed`);
    assert.throws(() => routes["POST /api/fanclubs/:artist/messages"]({
      user: fan, ip: `${label}-fan-message`, params: { artist: artistName },
      body: { text: "This should not be published." },
    }), reconciliationError, `${label} rooms cannot accept new messages`);
    assert.deepEqual(routes["POST /api/fanclubs/:artist/join"]({
      user: fan, ip: `${label}-leave`, params: { artist: artistName },
      body: { joined: false },
    }), { member: false, joined: false }, `${label} historical memberships can still be removed safely`);
  }
  assert.equal(db.prepare("SELECT COUNT(*) c FROM fan_club_members WHERE user_id=? AND artist IN (?,?)")
    .get(fan.id, UNRESOLVED_FAN_CLUB.toLowerCase(), AMBIGUOUS_FAN_CLUB).c, 0);
  assert.deepEqual(routes["POST /api/fanclubs/:artist/join"]({
    user: fan, ip: "legacy-unbound-leave", params: { artist: LEGACY_FREE_FORM_ROOM },
    body: { joined: false },
  }), { member: false, joined: false },
  "a legacy membership stored under a Unicode-normalized free-form name can still be removed");
  assert.deepEqual(routes["POST /api/fanclubs/:artist/join"]({
    user: fan, ip: "legacy-leave", params: { artist: "legacy-policy-artist-1959" },
    body: { joined: false },
  }), { member: false, joined: false });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM fan_club_members WHERE user_id=? AND artist IN (?,?)")
    .get(fan.id, ARTIST_NAME.toLowerCase(), "legacy-policy-artist-1959").c, 0);

  assert.deepEqual(routes["DELETE /api/posts/:id"]({
    user: fan, ip: "legacy-memory-delete", params: { id: memory.id },
  }), { ok: true, id: memory.id });
});
