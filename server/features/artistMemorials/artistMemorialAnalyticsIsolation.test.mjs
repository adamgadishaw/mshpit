import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { artistMemorialRoutes } from "./artistMemorialRoutes.js";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function createDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE artist_memorials (
      artist_key TEXT PRIMARY KEY,
      artist_mbid TEXT NOT NULL,
      artist_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('draft','published')),
      death_date TEXT NOT NULL,
      summary TEXT NOT NULL CHECK (length(summary) BETWEEN 20 AND 600),
      thank_you TEXT NOT NULL CHECK (length(thank_you) BETWEEN 3 AND 320),
      accomplishments TEXT NOT NULL CHECK (json_valid(accomplishments)),
      source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
      source_title TEXT,
      published_at INTEGER,
      spotlight_started_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK (
        (status='draft' AND published_at IS NULL AND spotlight_started_at IS NULL)
        OR
        (status='published' AND published_at IS NOT NULL AND spotlight_started_at IS NOT NULL)
      )
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      name TEXT NOT NULL,
      props TEXT NOT NULL,
      ip TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE guest_search_daily (
      day TEXT NOT NULL,
      kind TEXT NOT NULL,
      result_bucket TEXT NOT NULL,
      outcome TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (day,kind,result_bucket,outcome)
    ) WITHOUT ROWID;
    INSERT INTO events(id,user_id,name,props,ip,created_at)
      VALUES('evt_existing','u_member','screen_view','{"screen":"tab_feed"}',NULL,1787659100000);
    INSERT INTO guest_search_daily(day,kind,result_bucket,outcome,count)
      VALUES('2026-08-25','all','one_to_five','success',7);
  `);
  return database;
}

const command = (overrides = {}) => ({
  status: "published",
  deathDate: "2024-05-17",
  summary: "A singular performer whose songs and live shows changed generations.",
  thankYou: "Thank you for leaving the music with us.",
  accomplishments: ["Three landmark albums", "Unforgettable live performances"],
  sourceUrl: "https://news.example.org/artist/confirmed",
  sourceTitle: "Official announcement",
  confirmedIndividual: true,
  restartSpotlight: false,
  ...overrides,
});

function context(overrides = {}) {
  return {
    body: {},
    query: {},
    params: {},
    setHeader() {},
    ...overrides,
  };
}

function analyticsSnapshot(database) {
  return {
    events: database.prepare("SELECT * FROM events ORDER BY id").all().map((row) => ({ ...row })),
    guestSearches: database.prepare(`SELECT * FROM guest_search_daily
      ORDER BY day,kind,result_bucket,outcome`).all().map((row) => ({ ...row })),
  };
}

test("memorial writes and reads never create or change product analytics", () => {
  const database = createDatabase();
  const audits = [];
  let clock = NOW;
  try {
    const routes = artistMemorialRoutes({
      database,
      ApiError,
      assertSafeAuthoredText: () => {},
      decodeArtistKey: (ctx) => decodeURIComponent(String(ctx.params?.key || "")),
      normName: (value) => String(value || "").trim().toLowerCase(),
      now: () => clock,
      rateLimit: () => {},
      recordModerationAction: (...args) => audits.push(args),
      requireAdmin(ctx) {
        if (ctx.user?.role !== "admin") throw new ApiError(403, "Admins only.", "FORBIDDEN");
        return ctx.user;
      },
      resolveArtist: (key) => ({
        norm: key,
        name: "The Artist",
        mbid: "12345678-1234-4234-8234-123456789abc",
      }),
    });
    const admin = { id: "u_admin", role: "admin" };
    const before = analyticsSnapshot(database);

    routes["PUT /api/admin/artist-memorials/:key"](context({
      user: admin,
      params: { key: "the%20artist" },
      body: command(),
    }));
    routes["GET /api/artists/:key/memorial"](context({ params: { key: "the%20artist" } }));
    routes["GET /api/admin/artist-memorials"](context({ user: admin }));

    clock += 1;
    routes["PUT /api/admin/artist-memorials/:key"](context({
      user: admin,
      params: { key: "the%20artist" },
      body: command({ summary: `${command().summary} Updated once.` }),
    }));
    clock += 1;
    routes["PUT /api/admin/artist-memorials/:key"](context({
      user: admin,
      params: { key: "the%20artist" },
      body: command({ summary: `${command().summary} Updated twice.` }),
    }));

    assert.deepEqual(analyticsSnapshot(database), before);
    assert.equal(database.prepare("SELECT COUNT(*) count FROM artist_memorials").get().count, 1);
    assert.equal(audits.length, 3, "moderation audit remains separate from product analytics");
  } finally {
    database.close();
  }
});
