import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { ARTIST_MEMORIAL_SPOTLIGHT_MS } from "../../../src/domain/artistMemorial.mjs";
import { createArtistMemorialRepository } from "./artistMemorialRepository.js";
import { artistMemorialRoutes } from "./artistMemorialRoutes.js";
import { createArtistMemorialService } from "./artistMemorialService.js";

const NOW = Date.parse("2026-08-25T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const ARTIST_MBID = "12345678-1234-4234-8234-123456789abc";
const REASSIGNED_MBID = "22345678-1234-4234-8234-123456789abc";

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
      artist_key           TEXT PRIMARY KEY,
      artist_mbid          TEXT,
      artist_name          TEXT NOT NULL,
      status               TEXT NOT NULL CHECK (status IN ('draft','published')),
      death_date           TEXT NOT NULL,
      summary              TEXT NOT NULL CHECK (length(summary) BETWEEN 20 AND 600),
      thank_you            TEXT NOT NULL CHECK (length(thank_you) BETWEEN 3 AND 320),
      accomplishments      TEXT NOT NULL CHECK (json_valid(accomplishments)),
      source_url           TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
      source_title         TEXT,
      published_at         INTEGER,
      spotlight_started_at INTEGER,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      CHECK (
        (status='draft' AND published_at IS NULL AND spotlight_started_at IS NULL)
        OR
        (status='published' AND published_at IS NOT NULL AND spotlight_started_at IS NOT NULL)
      )
    );
    CREATE INDEX idx_artist_memorials_status_updated
      ON artist_memorials(status,updated_at DESC,artist_key);
  `);
  return database;
}

function createPreReleaseDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE artist_memorials (
      artist_key           TEXT PRIMARY KEY,
      artist_name          TEXT NOT NULL,
      artist_mbid          TEXT,
      status               TEXT NOT NULL CHECK (status IN ('draft','published')),
      death_date           TEXT NOT NULL,
      summary              TEXT NOT NULL,
      thank_you            TEXT NOT NULL,
      accomplishments      TEXT NOT NULL,
      source_url           TEXT NOT NULL,
      source_title         TEXT,
      source_hostname      TEXT NOT NULL,
      source_verified_at   INTEGER NOT NULL,
      first_published_at   INTEGER,
      published_at         INTEGER,
      spotlight_started_at INTEGER,
      spotlight_ends_at    INTEGER,
      created_at           INTEGER NOT NULL,
      updated_at           INTEGER NOT NULL,
      CHECK (
        (status='draft' AND published_at IS NULL AND spotlight_started_at IS NULL AND spotlight_ends_at IS NULL)
        OR
        (status='published' AND published_at IS NOT NULL AND first_published_at IS NOT NULL
          AND spotlight_started_at IS NOT NULL AND spotlight_ends_at > spotlight_started_at)
      )
    );
  `);
  return database;
}

const command = (overrides = {}) => ({
  status: "published",
  deathDate: "2024-05-17",
  summary: "A singular performer whose songs and live shows changed generations.",
  thankYou: "Thank you for leaving the music with us.",
  accomplishments: ["Three landmark albums", "Unforgettable live performances"],
  sourceUrl: "https://news.example.org/artist/confirmed#announcement",
  sourceTitle: "Official announcement",
  confirmedIndividual: true,
  restartSpotlight: false,
  ...overrides,
});

const storedRecord = (overrides = {}) => ({
  artistKey: "the artist",
  artistMbid: ARTIST_MBID,
  artistName: "The Artist",
  status: "draft",
  deathDate: "2024-05-17",
  summary: "A singular performer whose songs and live shows changed generations.",
  thankYou: "Thank you for leaving the music with us.",
  accomplishments: ["Three landmark albums"],
  sourceUrl: "https://news.example.org/artist/confirmed",
  sourceTitle: "Official announcement",
  publishedAt: null,
  spotlightStartedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

function context(overrides = {}) {
  const headers = {};
  return {
    body: {},
    query: {},
    params: {},
    setHeader(name, value) { headers[name] = value; },
    headers,
    ...overrides,
  };
}

function routeFixture({
  at = NOW,
  recordModerationAction,
  resolveArtist,
} = {}) {
  const database = createDatabase();
  const calls = { admins: 0, safeText: [], limits: [], audits: [] };
  let clock = at;
  const routes = artistMemorialRoutes({
    database,
    ApiError,
    assertSafeAuthoredText: (...args) => calls.safeText.push(args),
    decodeArtistKey: (ctx) => decodeURIComponent(String(ctx.params?.key || "")),
    normName: (value) => String(value || "").trim().toLowerCase(),
    now: () => clock,
    rateLimit: (...args) => calls.limits.push(args),
    recordModerationAction: recordModerationAction || ((...args) => calls.audits.push(args)),
    requireAdmin(ctx) {
      calls.admins += 1;
      if (ctx.user?.role !== "admin") throw new ApiError(403, "Admins only.", "FORBIDDEN");
      return ctx.user;
    },
    resolveArtist: resolveArtist || ((key) => ({
      norm: key,
      name: key === "the artist" ? "The Artist" : "Another Artist",
      mbid: ARTIST_MBID,
      status: "dissolved",
      endYear: 2024,
    })),
  });
  return {
    database,
    routes,
    calls,
    setNow(value) { clock = value; },
  };
}

test("repository persists only the canonical record and rolls failed work back", () => {
  const database = createDatabase();
  try {
    const repository = createArtistMemorialRepository(database);
    repository.upsert(storedRecord());
    assert.deepEqual({ ...repository.findByArtistKey("the artist") }, {
      artist_key: "the artist",
      artist_mbid: ARTIST_MBID,
      artist_name: "The Artist",
      status: "draft",
      death_date: "2024-05-17",
      summary: storedRecord().summary,
      thank_you: storedRecord().thankYou,
      accomplishments: JSON.stringify(storedRecord().accomplishments),
      source_url: storedRecord().sourceUrl,
      source_title: storedRecord().sourceTitle,
      published_at: null,
      spotlight_started_at: null,
      created_at: NOW,
      updated_at: NOW,
    });
    const columns = database.prepare("PRAGMA table_info(artist_memorials)").all().map(({ name }) => name);
    assert.equal(columns.includes("confirmed_individual"), false);
    assert.equal(columns.includes("restart_spotlight"), false);

    assert.throws(() => repository.transaction(() => {
      repository.upsert(storedRecord({ artistKey: "rollback artist" }));
      throw new Error("audit failed");
    }), /audit failed/u);
    assert.equal(repository.findByArtistKey("rollback artist"), null);
  } finally {
    database.close();
  }
});

test("repository remains write-compatible with the additive pre-release memorial columns", () => {
  const database = createPreReleaseDatabase();
  try {
    const repository = createArtistMemorialRepository(database);
    repository.upsert(storedRecord());
    assert.deepEqual({ ...database.prepare(`SELECT source_hostname,source_verified_at,
      first_published_at,spotlight_ends_at FROM artist_memorials WHERE artist_key=?`).get("the artist") }, {
      source_hostname: "news.example.org",
      source_verified_at: NOW,
      first_published_at: null,
      spotlight_ends_at: null,
    });

    repository.upsert(storedRecord({
      status: "published",
      publishedAt: NOW,
      spotlightStartedAt: NOW,
      updatedAt: NOW + 1,
    }));
    assert.deepEqual({ ...database.prepare(`SELECT source_hostname,source_verified_at,
      first_published_at,spotlight_ends_at FROM artist_memorials WHERE artist_key=?`).get("the artist") }, {
      source_hostname: "news.example.org",
      source_verified_at: NOW + 1,
      first_published_at: NOW,
      spotlight_ends_at: NOW + ARTIST_MEMORIAL_SPOTLIGHT_MS,
    });
  } finally {
    database.close();
  }
});

test("service owns draft, publish, edit, restart, and permanent-marker semantics", () => {
  const database = createDatabase();
  try {
    const repository = createArtistMemorialRepository(database);
    const service = createArtistMemorialService({ repository });
    const audit = [];

    const draft = service.upsert(command({ status: "draft" }), {
      artistKey: "the artist",
      artistName: "The Artist",
      artistMbid: ARTIST_MBID,
      at: NOW,
      audit: (entry) => audit.push(entry),
    });
    assert.equal(draft.ok, true);
    assert.equal(draft.memorial.publishedAt, null);
    assert.equal(draft.memorial.spotlightStartedAt, null);
    assert.equal(service.readPublic({ artistKey: "the artist", artistMbid: ARTIST_MBID, at: NOW }), null);
    assert.deepEqual(service.readPublicSearch({
      query: "artist", artistMbids: new Map([["the artist", ARTIST_MBID]]), at: NOW,
    }), []);

    const publishedAt = NOW + DAY_MS;
    const published = service.upsert(command(), {
      artistKey: "the artist",
      artistName: "The Artist",
      artistMbid: ARTIST_MBID,
      at: publishedAt,
      audit: (entry) => audit.push(entry),
    });
    assert.equal(published.memorial.publishedAt, publishedAt);
    assert.equal(published.memorial.spotlightStartedAt, publishedAt);
    assert.equal(published.memorial.spotlightEndsAt, publishedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS);

    const publicMemorial = service.readPublic({
      artistKey: "the artist", artistMbid: ARTIST_MBID, at: publishedAt + DAY_MS,
    });
    assert.deepEqual(publicMemorial, {
      deceased: true,
      deathDate: command().deathDate,
      summary: command().summary,
      thankYou: command().thankYou,
      accomplishments: command().accomplishments,
      citation: {
        url: "https://news.example.org/artist/confirmed",
        title: command().sourceTitle,
      },
      spotlight: {
        active: true,
        startedAt: publishedAt,
        endsAt: publishedAt + ARTIST_MEMORIAL_SPOTLIGHT_MS,
      },
    });
    for (const internal of ["artistKey", "artistName", "status", "sourceUrl", "sourceHostname", "sourceVerifiedAt"]) {
      assert.equal(Object.hasOwn(publicMemorial, internal), false, `${internal} must not be public`);
    }
    const batch = service.readPublicForArtistKeys({
      artistKeys: ["the artist", "missing artist", "the artist"],
      artistMbids: new Map([["the artist", ARTIST_MBID]]),
      at: publishedAt + DAY_MS,
    });
    assert.equal(batch.size, 1);
    assert.deepEqual(batch.get("the artist"), publicMemorial);
    assert.equal(service.readPublic({
      artistKey: "the artist", artistMbid: REASSIGNED_MBID, at: publishedAt + DAY_MS,
    }), null, "a reassigned catalog key cannot inherit the deceased marker");
    assert.equal(service.readPublicForArtistKeys({
      artistKeys: ["the artist"],
      artistMbids: new Map([["the artist", REASSIGNED_MBID]]),
      at: publishedAt + DAY_MS,
    }).size, 0);
    assert.deepEqual(service.readPublicSearch({
      query: "artist",
      artistMbids: new Map([["the artist", REASSIGNED_MBID]]),
      at: publishedAt + DAY_MS,
    }), []);
    const identityConflict = service.upsert(command(), {
      artistKey: "the artist",
      artistName: "The Artist",
      artistMbid: REASSIGNED_MBID,
      at: publishedAt + 2 * DAY_MS,
    });
    assert.equal(identityConflict.conflict, true);
    assert.equal(repository.findByArtistKey("the artist").artist_mbid, ARTIST_MBID);
    database.prepare("UPDATE artist_memorials SET artist_mbid=NULL WHERE artist_key=?").run("the artist");
    assert.equal(service.readPublic({
      artistKey: "the artist", artistMbid: ARTIST_MBID, at: publishedAt + 2 * DAY_MS,
    }), null, "an unbound legacy row remains fail-closed");
    const rebound = service.upsert(command(), {
      artistKey: "the artist",
      artistName: "The Artist",
      artistMbid: ARTIST_MBID,
      at: publishedAt + 2 * DAY_MS,
    });
    assert.equal(rebound.ok, true);
    assert.equal(rebound.changed, true);
    assert.equal(repository.findByArtistKey("the artist").artist_mbid, ARTIST_MBID);
    assert.throws(
      () => service.readPublicForArtistKeys({
        artistKeys: Array(41).fill("the artist"), artistMbids: new Map(), at: publishedAt,
      }),
      /no more than 40/u,
    );

    const editedAt = publishedAt + 4 * DAY_MS;
    const edited = service.upsert(command({ summary: `${command().summary} Still heard today.` }), {
      artistKey: "the artist",
      artistName: "The Artist",
      artistMbid: ARTIST_MBID,
      at: editedAt,
    });
    assert.equal(edited.memorial.publishedAt, publishedAt);
    assert.equal(edited.memorial.spotlightStartedAt, publishedAt, "ordinary edits cannot renew the spotlight");

    const restartAt = publishedAt + 10 * DAY_MS;
    const restarted = service.upsert(command({
      summary: `${command().summary} Still heard today.`,
      restartSpotlight: true,
    }), {
      artistKey: "the artist",
      artistName: "The Artist",
      artistMbid: ARTIST_MBID,
      at: restartAt,
    });
    assert.equal(restarted.memorial.publishedAt, publishedAt);
    assert.equal(restarted.memorial.spotlightStartedAt, restartAt);
    assert.equal(service.readPublic({
      artistKey: "the artist",
      artistMbid: ARTIST_MBID,
      at: restartAt + ARTIST_MEMORIAL_SPOTLIGHT_MS,
    }).spotlight.active, false, "the deceased marker remains after the spotlight expires");

    const search = service.readPublicSearch({
      query: "artist", artistMbids: new Map([["the artist", ARTIST_MBID]]), at: restartAt,
    });
    assert.deepEqual(Object.keys(search[0]).sort(), ["artistKey", "deathDate", "deceased", "spotlight"]);
    assert.equal(audit.length, 2, "only calls supplied an audit callback");
  } finally {
    database.close();
  }
});

test("shared validation rejects ambiguous identity attestations, weak evidence, and unknown fields", () => {
  const database = createDatabase();
  try {
    const service = createArtistMemorialService({ repository: createArtistMemorialRepository(database) });
    const options = { artistKey: "the artist", artistName: "The Artist", artistMbid: ARTIST_MBID, at: NOW };
    for (const [field, input] of [
      ["confirmedIndividual", command({ confirmedIndividual: false })],
      ["accomplishments", command({ accomplishments: [] })],
      ["thankYou", command({ thankYou: "" })],
      ["sourceUrl", command({ sourceUrl: "http://news.example.org/report" })],
      ["privateNote", { ...command(), privateNote: "do not accept" }],
    ]) {
      const result = service.upsert(input, options);
      assert.equal(result.ok, false);
      assert.equal(result.field, field);
    }
    assert.equal(database.prepare("SELECT COUNT(*) count FROM artist_memorials").get().count, 0);
  } finally {
    database.close();
  }
});

test("routes require admin plus an exact MBID catalog row and audit no prose, URL, or account analytics", () => {
  const { database, routes, calls } = routeFixture();
  try {
    assert.throws(
      () => routes["GET /api/admin/artist-memorials"](context({ user: { role: "fan" } })),
      (error) => error.status === 403 && error.code === "FORBIDDEN",
    );

    const saveCtx = context({
      user: { id: "u_admin", role: "admin" },
      params: { key: "The Artist" },
      body: command(),
      ip: "203.0.113.10",
      ua: "private browser fingerprint",
    });
    const saved = routes["PUT /api/admin/artist-memorials/:key"](saveCtx);
    assert.equal(saved.changed, true);
    assert.equal(saveCtx.headers["Cache-Control"], "no-store");
    assert.deepEqual(calls.safeText.map(([value]) => value), [
      command().summary,
      command().thankYou,
      command().sourceTitle,
      ...command().accomplishments,
    ]);
    assert.equal(calls.audits.length, 1);
    assert.deepEqual(calls.audits[0].slice(1), [
      "artist_memorial_upsert",
      "artist_memorial",
      "the artist",
      "",
      null,
      {
        status: "published",
        deathDate: command().deathDate,
        accomplishmentCount: 2,
        publishedAt: NOW,
        spotlightStartedAt: NOW,
        spotlightEndsAt: NOW + ARTIST_MEMORIAL_SPOTLIGHT_MS,
      },
    ]);
    const durableAudit = JSON.stringify(calls.audits[0].slice(1));
    for (const forbidden of [command().summary, command().thankYou, command().sourceUrl, "u_admin", "fingerprint", "203.0.113.10"]) {
      assert.equal(durableAudit.includes(forbidden), false, `${forbidden} must not enter durable memorial audit metadata`);
    }

    const row = database.prepare("SELECT * FROM artist_memorials").get();
    assert.equal(Object.hasOwn(row, "confirmedIndividual"), false);
    assert.equal(Object.hasOwn(row, "restartSpotlight"), false);
    const publicResult = routes["GET /api/artists/:key/memorial"](context({ params: { key: "the%20artist" } }));
    assert.equal(publicResult.memorial.deceased, true);
    assert.deepEqual(Object.keys(publicResult.memorial).sort(), [
      "accomplishments", "citation", "deathDate", "deceased", "spotlight", "summary", "thankYou",
    ]);
    assert.deepEqual(calls.limits[0].slice(1), ["artist-memorial-public", 120, 10 * 60 * 1000]);

    const listCtx = context({ user: { id: "u_admin", role: "admin" }, query: { status: "published" } });
    const list = routes["GET /api/admin/artist-memorials"](listCtx);
    assert.equal(list.memorials.length, 1);
    assert.equal(listCtx.headers["Cache-Control"], "no-store");

    database.prepare("UPDATE artist_memorials SET artist_mbid=? WHERE artist_key=?")
      .run(REASSIGNED_MBID, "the artist");
    assert.deepEqual(
      routes["GET /api/artists/:key/memorial"](context({ params: { key: "the%20artist" } })),
      { memorial: null },
      "the public marker disappears when the catalog identity no longer matches its binding",
    );
    assert.throws(
      () => routes["PUT /api/admin/artist-memorials/:key"](context({
        user: { id: "u_admin", role: "admin" },
        params: { key: "the%20artist" },
        body: command({ summary: `${command().summary} Updated.` }),
      })),
      (error) => error.status === 409 && error.code === "CONFLICT" && /different MusicBrainz identity/u.test(error.message),
    );
  } finally {
    database.close();
  }
});

test("route does not infer death from provider metadata and blocks missing or mismatched canonical identity", () => {
  const noMbid = routeFixture({
    resolveArtist: (key) => ({ norm: key, name: "The Artist", mbid: null, status: "dissolved", endYear: 2024 }),
  });
  try {
    const publicBeforeAdmin = noMbid.routes["GET /api/artists/:key/memorial"](context({ params: { key: "the artist" } }));
    assert.deepEqual(publicBeforeAdmin, { memorial: null });
    assert.throws(
      () => noMbid.routes["PUT /api/admin/artist-memorials/:key"](context({
        user: { role: "admin" }, params: { key: "the artist" }, body: command(),
      })),
      (error) => error.status === 409 && error.code === "CONFLICT" && /MusicBrainz/u.test(error.message),
    );
  } finally {
    noMbid.database.close();
  }

  const mismatch = routeFixture({
    resolveArtist: () => ({ norm: "different artist", name: "Different Artist", mbid: "an-mbid" }),
  });
  try {
    assert.throws(
      () => mismatch.routes["PUT /api/admin/artist-memorials/:key"](context({
        user: { role: "admin" }, params: { key: "the artist" }, body: command(),
      })),
      (error) => error.status === 409 && error.code === "CONFLICT",
    );
  } finally {
    mismatch.database.close();
  }
});

test("an audit failure rolls the memorial write back", () => {
  const fixture = routeFixture({ recordModerationAction: () => { throw new Error("audit unavailable"); } });
  try {
    assert.throws(
      () => fixture.routes["PUT /api/admin/artist-memorials/:key"](context({
        user: { id: "u_admin", role: "admin" }, params: { key: "the artist" }, body: command(),
      })),
      /audit unavailable/u,
    );
    assert.equal(fixture.database.prepare("SELECT COUNT(*) count FROM artist_memorials").get().count, 0);
  } finally {
    fixture.database.close();
  }
});

test("the application schema accepts the exact canonical repository record", async () => {
  const { db } = await import("../../db.js");
  const repository = createArtistMemorialRepository(db);
  db.exec("SAVEPOINT artist_memorial_schema_contract");
  try {
    const row = repository.upsert(storedRecord({ artistKey: "__memorial_schema_contract__" }));
    assert.equal(row.artist_key, "__memorial_schema_contract__");
    assert.deepEqual(
      db.prepare("PRAGMA table_info(artist_memorials)").all().map(({ name }) => name).sort(),
      [
        "artist_key", "artist_mbid", "artist_name", "status", "death_date", "summary", "thank_you",
        "accomplishments", "source_url", "source_title", "published_at",
        "spotlight_started_at", "created_at", "updated_at",
      ].sort(),
    );
  } finally {
    db.exec("ROLLBACK TO artist_memorial_schema_contract");
    db.exec("RELEASE artist_memorial_schema_contract");
  }
});
