import assert from "node:assert/strict";
import test from "node:test";
import { artistResolveRoutes } from "./artistResolveRoutes.js";

class TestApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const clean = (value, { max } = {}) => String(value ?? "").trim().slice(0, max || Infinity);
const normName = (value) => String(value || "").trim().toLowerCase();

function createRoutes(overrides = {}) {
  return artistResolveRoutes({
    ApiError: TestApiError,
    clean,
    clearMissingArtist: () => {},
    findArtist: () => null,
    normName,
    persistExactMusicBrainzIdentity: async (name) => ({ norm: normName(name), name, mbid: "mbid" }),
    projectArtist: (row) => ({ key: row.norm, name: row.name, mbid: row.mbid }),
    rateLimit: () => {},
    requireVerifiedUser: () => {},
    ...overrides,
  });
}

test("artist resolver route requires its complete API boundary", () => {
  assert.throws(
    () => artistResolveRoutes({}),
    /complete boundary dependencies/,
  );
});

test("verified artist selection preserves rate limits, provider identity, cancellation, and missing-queue cleanup", async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const mbid = "77777777-7777-4777-8777-777777777777";
  const routes = createRoutes({
    requireVerifiedUser: (ctx) => calls.push(["verified", ctx.user.id]),
    rateLimit: (_ctx, bucket, count, windowMs) => calls.push(["rate", bucket, count, windowMs]),
    findArtist: (key) => {
      calls.push(["find", key]);
      return null;
    },
    persistExactMusicBrainzIdentity: async (name, options) => {
      calls.push(["persist", name, options]);
      return { norm: "earl sweatshirt", name: "Earl Sweatshirt", mbid };
    },
    clearMissingArtist: (key) => calls.push(["clear", key]),
  });

  const result = await routes["POST /api/artists/resolve"]({
    user: { id: "verified-user" },
    body: { name: "  Earl Sweatshirt  ", mbid },
    signal,
  });

  assert.deepEqual(result, {
    artist: { key: "earl sweatshirt", name: "Earl Sweatshirt", mbid },
    created: true,
  });
  assert.deepEqual(calls.slice(0, 3), [
    ["verified", "verified-user"],
    ["rate", "artist-resolve-persist", 20, 10 * 60 * 1000],
    ["find", "earl sweatshirt"],
  ]);
  assert.equal(calls[3][0], "persist");
  assert.equal(calls[3][1], "Earl Sweatshirt");
  assert.equal(calls[3][2].signal, signal);
  assert.equal(calls[3][2].expectedMbid, mbid);
  assert.deepEqual(calls[4], ["clear", "earl sweatshirt"]);
});

test("existing catalog identity is reused only when the selected MBID still matches", async () => {
  const existing = {
    norm: "earl sweatshirt",
    name: "Earl Sweatshirt",
    mbid: "11111111-1111-4111-8111-111111111111",
  };
  let persisted = false;
  const routes = createRoutes({
    findArtist: () => existing,
    persistExactMusicBrainzIdentity: async () => {
      persisted = true;
      return existing;
    },
  });
  const write = routes["POST /api/artists/resolve"];

  const result = await write({
    body: { name: existing.name, mbid: existing.mbid.toUpperCase() },
  });
  assert.equal(result.created, false);
  assert.equal(result.artist.key, existing.norm);
  assert.equal(persisted, false);

  await assert.rejects(
    () => write({
      body: {
        name: existing.name,
        mbid: "22222222-2222-4222-8222-222222222222",
      },
    }),
    (error) => error instanceof TestApiError && error.status === 409 && error.code === "CONFLICT",
  );
});

test("artist resolver validates a selected name after verification and admission control", async () => {
  const calls = [];
  const routes = createRoutes({
    requireVerifiedUser: () => calls.push("verified"),
    rateLimit: () => calls.push("rate"),
  });

  await assert.rejects(
    () => routes["POST /api/artists/resolve"]({ body: { name: "   " } }),
    (error) => error instanceof TestApiError && error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  assert.deepEqual(calls, ["verified", "rate"]);
});
