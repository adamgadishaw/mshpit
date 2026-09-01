import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

const dataDir = mkdtempSync(join(tmpdir(), "pit-online-review-routes-"));
process.env.PIT_DATA_DIR = dataDir;

const { db, q } = await import("./db.js");
const { ApiError, routes } = await import("./api.js");

after(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function addUser(id) {
  q.insertUser.run(
    id,
    `${id}@example.com`,
    id,
    id.replace(/[^a-z0-9_]/gu, "").slice(0, 20),
    "test-hash",
    "fan",
    "Toronto",
    43.65,
    -79.38,
    id.slice(0, 2).toUpperCase(),
    "#123456",
    Date.now(),
  );
  return q.userById.get(id);
}

const YOUTUBE_ID = "dQw4w9WgXcQ";
const SECOND_YOUTUBE_ID = "M7lc1UVf-VE";

function onlineBody(overrides = {}) {
  return {
    clientMutationId: "online_review_create_001",
    experienceType: "online",
    artist: "Online Artist",
    venue: "Forged Arena",
    city: "Toronto",
    date: "2026-09-20",
    overall: 4.5,
    band: 5,
    room: 4,
    dims: { performance: 5, venue: 4, sound: 4.5 },
    review: "A complete online concert review that remains social.",
    onlineTitle: "  Live from the studio  ",
    youtubeUrl: `https://youtu.be/${YOUTUBE_ID}?t=42`,
    landingShowcase: true,
    setlist: ["Opening song"],
    tour: "Forged physical tour",
    tags: ["great crowd"],
    song: { url: `https://youtu.be/${YOUTUBE_ID}`, title: "Player attachment" },
    photos: [],
    photosPublic: false,
    ...overrides,
  };
}

function assertOnlineProjection(post, { youtubeVideoId = YOUTUBE_ID, onlineTitle = "Live from the studio" } = {}) {
  assert.equal(post.kind, "review");
  assert.equal(post.experienceType, "online");
  assert.equal(post.onlineTitle, onlineTitle);
  assert.equal(post.youtubeVideoId, youtubeVideoId);
  assert.equal(post.youtubeUrl, `https://www.youtube.com/watch?v=${youtubeVideoId}`);
  assert.equal(post.venue, "");
  assert.equal(post.venueKey, null);
  assert.equal(post.city, "");
  assert.equal(post.date, "");
  assert.equal(post.band, null);
  assert.equal(post.room, null);
  assert.deepEqual(post.dims, {});
  assert.deepEqual(post.setlist, []);
  assert.equal(post.tour, null);
  assert.deepEqual(post.tags, []);
  assert.equal(post.song, null);
  assert.equal(post.playlist, null);
  assert.equal(post.campaign, null);
  assert.equal(post.archiveShowKey, null);
  assert.equal(post.seen, null);
  assert.equal(post.landingShowcase, false);
}

test("online reviews persist canonically, remain social, and never count as physical concerts", () => {
  const user = addUser("onlinefan");
  const create = routes["POST /api/posts"];
  const created = create({ user, ip: "online-create", body: onlineBody() });
  assertOnlineProjection(created.post);

  const stored = db.prepare(`SELECT experience_type,online_title,youtube_url,youtube_video_id,
    venue,venue_key,city,date,band,room,dims,setlist,tour,tags,song,playlist,campaign,landing_showcase
    FROM posts WHERE id=?`).get(created.id);
  assert.deepEqual({
    experienceType: stored.experience_type,
    onlineTitle: stored.online_title,
    youtubeUrl: stored.youtube_url,
    youtubeVideoId: stored.youtube_video_id,
  }, {
    experienceType: "online",
    onlineTitle: "Live from the studio",
    youtubeUrl: `https://www.youtube.com/watch?v=${YOUTUBE_ID}`,
    youtubeVideoId: YOUTUBE_ID,
  });
  assert.equal(stored.venue, "");
  assert.equal(stored.venue_key, null);
  assert.equal(stored.city, "");
  assert.equal(stored.date, "");
  assert.equal(stored.band, null);
  assert.equal(stored.room, null);
  assert.equal(stored.dims, "{}");
  assert.equal(stored.setlist, "[]");
  assert.equal(stored.tour, null);
  assert.equal(stored.tags, "[]");
  assert.equal(stored.song, null);
  assert.equal(stored.playlist, null);
  assert.equal(stored.campaign, null);
  assert.equal(stored.landing_showcase, 0);

  const retry = create({
    user,
    ip: "online-create-retry",
    body: onlineBody({
      venue: "A different forged venue",
      city: "Lisbon",
      date: "2027-01-01",
      band: 1,
      room: 1,
      dims: { venue: 1 },
      setlist: ["Different"],
      tour: "Different physical tour",
      tags: ["different"],
      song: null,
      onlineTitle: "Live from the studio",
      youtubeUrl: `https://www.youtube.com/watch?v=${YOUTUBE_ID}&feature=share`,
    }),
  });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.id, created.id);

  const standalone = routes["GET /api/posts/:id"]({ user, params: { id: created.id } }).post;
  assertOnlineProjection(standalone);
  const feed = routes["GET /api/feed"]({ user, query: {} }).posts.find((post) => post.id === created.id);
  assertOnlineProjection(feed);
  const profile = routes["GET /api/users/:id/posts"]({ user, params: { id: user.id }, query: {} }).posts
    .find((post) => post.id === created.id);
  assertOnlineProjection(profile);

  const rewards = routes["GET /api/users/:id/rewards"]({ user, params: { id: user.id } });
  assert.deepEqual(
    { shows: rewards.stats.shows, reviews: rewards.stats.reviews, photos: rewards.stats.photos, cities: rewards.stats.cities, artists: rewards.stats.artists },
    { shows: 0, reviews: 0, photos: 0, cities: 0, artists: 0 },
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM going WHERE user_id=?").get(user.id).count, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM show_attendance WHERE user_id=?").get(user.id).count, 0);

  routes["DELETE /api/posts/:id"]({ user, ip: "online-delete", params: { id: created.id } });
  const erased = db.prepare(`SELECT removed,experience_type,online_title,youtube_url,youtube_video_id,
    artist,venue,review FROM posts WHERE id=?`).get(created.id);
  assert.deepEqual({ ...erased }, {
    removed: 1,
    experience_type: "in_person",
    online_title: null,
    youtube_url: null,
    youtube_video_id: null,
    artist: "",
    venue: "",
    review: "",
  });
});

test("online review validation is authoritative and edits fail closed on physical and player fields", () => {
  const user = addUser("onlineeditor");
  const create = routes["POST /api/posts"];
  const invalid = [
    onlineBody({ clientMutationId: "online_missing_link", youtubeUrl: null }),
    onlineBody({ clientMutationId: "online_foreign_link", youtubeUrl: `https://youtube.com.evil.test/watch?v=${YOUTUBE_ID}` }),
    onlineBody({ clientMutationId: "online_embed_link", youtubeUrl: `https://www.youtube.com/embed/${YOUTUBE_ID}` }),
  ];
  for (const body of invalid) {
    assert.throws(
      () => create({ user, ip: body.clientMutationId, body }),
      (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
    );
  }
  assert.throws(
    () => create({
      user,
      ip: "in-person-youtube",
      body: { artist: "Artist", venue: "Venue", overall: 4, youtubeUrl: `https://youtu.be/${YOUTUBE_ID}` },
    }),
    (error) => error instanceof ApiError && error.status === 400,
  );

  db.prepare(`INSERT INTO posts
    (id,user_id,artist,venue,overall,review,experience_type,online_title,youtube_url,youtube_video_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    "online-malformed-legacy",
    user.id,
    "Online Artist",
    "",
    4,
    "Legacy row",
    "online",
    "Unsafe stored link",
    `https://evil.test/watch?v=${YOUTUBE_ID}`,
    YOUTUBE_ID,
    100,
  );
  assert.throws(
    () => routes["PATCH /api/posts/:id"]({
      user,
      ip: "online-malformed-title-edit",
      params: { id: "online-malformed-legacy" },
      body: { version: 100, onlineTitle: "Title-only edit" },
    }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
    "a title-only edit must not preserve a malformed legacy source URL",
  );

  const created = create({
    user,
    ip: "online-id-only",
    body: onlineBody({ clientMutationId: "online_id_only", youtubeUrl: null, youtubeVideoId: YOUTUBE_ID }),
  });
  assertOnlineProjection(created.post);

  const edited = routes["PATCH /api/posts/:id"]({
    user,
    ip: "online-edit",
    params: { id: created.id },
    body: {
      version: created.post.version,
      onlineTitle: "Updated stream",
      youtubeUrl: `https://youtube.com/live/${SECOND_YOUTUBE_ID}?si=tracking`,
      venue: "Forged Venue",
      city: "Toronto",
      date: "2026-10-01",
      band: 5,
      room: 5,
      dims: { performance: 5, venue: 5 },
      setlist: ["Forged song"],
      tour: "Forged Tour",
      tags: ["forged"],
      song: { url: `https://youtu.be/${YOUTUBE_ID}`, title: "Paused player path" },
      landingShowcase: true,
    },
  });
  assertOnlineProjection(edited.post, { youtubeVideoId: SECOND_YOUTUBE_ID, onlineTitle: "Updated stream" });

  assert.throws(
    () => routes["PATCH /api/posts/:id"]({
      user,
      ip: "online-clear-required-link",
      params: { id: created.id },
      body: { version: edited.post.version, youtubeUrl: null, youtubeVideoId: null },
    }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
});

test("changing an existing physical review to online clears its show identity", () => {
  const user = addUser("physicaltoonline");
  const create = routes["POST /api/posts"];
  const physical = create({
    user,
    ip: "physical-create",
    body: {
      artist: "Artist",
      venue: "Arena",
      city: "Toronto",
      date: "2026-09-22",
      overall: 4,
      band: 4.5,
      room: 4,
      dims: { performance: 4.5, venue: 4 },
      review: "Physical review",
      setlist: ["Song"],
      tour: "Tour",
      tags: ["crowd"],
    },
  });
  assert.equal(physical.post.experienceType, "in_person");
  assert.equal(physical.post.venue, "Arena");

  const online = routes["PATCH /api/posts/:id"]({
    user,
    ip: "physical-to-online",
    params: { id: physical.id },
    body: {
      version: physical.post.version,
      experienceType: "online",
      onlineTitle: "Archive stream",
      youtubeUrl: `https://youtu.be/${YOUTUBE_ID}`,
    },
  });
  assertOnlineProjection(online.post, { onlineTitle: "Archive stream" });
  const rewards = routes["GET /api/users/:id/rewards"]({ user, params: { id: user.id } });
  assert.equal(rewards.stats.shows, 0);

  assert.throws(
    () => routes["PATCH /api/posts/:id"]({
      user,
      ip: "online-to-physical-missing-venue",
      params: { id: physical.id },
      body: { version: online.post.version, experienceType: "in_person" },
    }),
    (error) => error instanceof ApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  const restored = routes["PATCH /api/posts/:id"]({
    user,
    ip: "online-to-physical",
    params: { id: physical.id },
    body: {
      version: online.post.version,
      experienceType: "in_person",
      venue: "Arena",
      city: "Toronto",
      date: "2026-09-22",
    },
  });
  assert.equal(restored.post.experienceType, "in_person");
  assert.equal(restored.post.venue, "Arena");
  assert.equal(restored.post.city, "Toronto");
  assert.equal(restored.post.date, "2026-09-22");
  assert.equal(restored.post.onlineTitle, null);
  assert.equal(restored.post.youtubeUrl, null);
  assert.equal(restored.post.youtubeVideoId, null);
  assert.equal(routes["GET /api/users/:id/rewards"]({ user, params: { id: user.id } }).stats.shows, 1);
});

test("published artist memorials reject online ratings on create and edit", () => {
  const user = addUser("onlinememorial");
  const at = Date.now();
  const artistKey = "online memorial artist";
  const artistName = "Online Memorial Artist";
  const artistMbid = "22222222-2222-4222-8222-222222222222";
  db.prepare(`INSERT INTO artists (norm,name,mbid,created_at,updated_at)
    VALUES (?,?,?,?,?) ON CONFLICT(norm) DO UPDATE SET name=excluded.name,mbid=excluded.mbid,updated_at=excluded.updated_at`)
    .run(artistKey, artistName, artistMbid, at, at);

  const create = routes["POST /api/posts"];
  const existing = create({
    user,
    ip: "online-before-memorial",
    body: onlineBody({
      clientMutationId: "online_before_memorial",
      artist: artistName,
      artistKey,
    }),
  });
  db.prepare(`INSERT INTO artist_memorials (
      artist_key,artist_name,artist_mbid,status,death_date,summary,thank_you,accomplishments,
      source_url,published_at,spotlight_started_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      artistKey,
      artistName,
      artistMbid,
      "published",
      "2026-08-28",
      "A verified memorial used to close all new rated reviews.",
      "Thank you for the music.",
      JSON.stringify(["A lasting legacy"]),
      "https://example.com/online-memorial",
      at,
      at,
      at,
      at,
    );

  assert.throws(
    () => create({
      user,
      ip: "online-after-memorial",
      body: onlineBody({
        clientMutationId: "online_after_memorial",
        artist: artistName,
        artistKey,
      }),
    }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "ARTIST_MEMORIALIZED",
  );
  assert.throws(
    () => routes["PATCH /api/posts/:id"]({
      user,
      ip: "online-rating-after-memorial",
      params: { id: existing.id },
      body: { version: existing.post.version, overall: 5 },
    }),
    (error) => error instanceof ApiError && error.status === 409 && error.code === "ARTIST_MEMORIALIZED",
  );
});
