import assert from "node:assert/strict";
import test from "node:test";

import { artistDeathWatchRoutes } from "./artistDeathWatchRoutes.js";

class ApiError extends Error {
  constructor(status, message, code, cause) {
    super(message, { cause });
    this.status = status;
    this.code = code;
  }
}

test("manual scan failures explain that incrementally confirmed alerts remain saved", async () => {
  const routes = artistDeathWatchRoutes({
    database: {},
    ApiError,
    decodeArtistKey: () => "artist",
    now: () => 1,
    rateLimit: () => {},
    recordModerationAction: () => {},
    requireAdmin: () => ({ id: "admin" }),
    requireModerator: () => ({ id: "moderator" }),
    service: {
      scan: async () => { throw new Error("provider failed after one confirmation"); },
    },
  });

  await assert.rejects(
    routes["POST /api/admin/artist-death-watch/scan"]({ setHeader() {} }),
    (error) => error.status === 502
      && error.code === "PROVIDER_UNAVAILABLE"
      && /stopped early/u.test(error.message)
      && /already confirmed were saved/u.test(error.message)
      && !/unchanged/u.test(error.message),
  );
});
