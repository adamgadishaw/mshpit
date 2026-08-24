import assert from "node:assert/strict";
import test from "node:test";

import { artistDiscographyRoutes } from "./artistDiscographyRoutes.js";

class ApiError extends Error {
  constructor(status, message, code, cause) {
    super(message, { cause });
    this.status = status;
    this.code = code;
  }
}

class ProviderError extends Error {}

const clean = (value, { max }) => {
  const result = String(value || "").trim();
  return result && result.length <= max ? result : null;
};

function fixture({ loadDiscography = async (...args) => ({ args }) } = {}) {
  const calls = { auth: 0, limits: [] };
  const routes = artistDiscographyRoutes({
    ApiError,
    ProviderError,
    clean,
    loadDiscography,
    rateLimit(_ctx, key, max, windowMs) { calls.limits.push({ key, max, windowMs }); },
    requireUser(ctx) {
      calls.auth += 1;
      if (!ctx.user) throw new ApiError(401, "Sign in.", "AUTH_REQUIRED");
      return ctx.user;
    },
  });
  return { routes, calls };
}

test("public discography reads cannot supply or persist a caller-selected provider identity", async () => {
  const { routes, calls } = fixture();
  const result = await routes["GET /api/artists/discography"]({
    query: { name: "  Same Name  ", deezerId: "999" },
  });
  assert.deepEqual(result.args, ["Same Name"]);
  assert.equal(calls.auth, 0);
  assert.equal(calls.limits[0].key, "discography");
});

test("same-name provider selection requires an account and is explicitly ephemeral", async () => {
  const { routes, calls } = fixture();
  await assert.rejects(
    routes["POST /api/artists/discography/selection"]({ body: { name: "Artist", deezerId: "123" } }),
    (error) => error.status === 401 && error.code === "AUTH_REQUIRED",
  );

  const result = await routes["POST /api/artists/discography/selection"]({
    user: { id: "u_test" },
    body: { name: "Artist", deezerId: "123" },
  });
  assert.deepEqual(result.args, ["Artist", { deezerId: 123, ephemeralSelection: true }]);
  assert.equal(calls.auth, 2);
  assert.equal(calls.limits.at(-1).key, "discography-selection");
});

test("discography boundaries validate identities and hide provider internals", async () => {
  const { routes } = fixture({ loadDiscography: async () => { throw new ProviderError("upstream URL and token"); } });
  await assert.rejects(
    routes["POST /api/artists/discography/selection"]({
      user: { id: "u_test" },
      body: { name: "Artist", deezerId: "not-a-number" },
    }),
    (error) => error.status === 400 && error.code === "VALIDATION_FAILED",
  );
  await assert.rejects(
    routes["GET /api/artists/discography"]({ query: { name: "Artist" } }),
    (error) => error.status === 502
      && error.code === "PROVIDER_UNAVAILABLE"
      && !error.message.includes("token"),
  );
});
