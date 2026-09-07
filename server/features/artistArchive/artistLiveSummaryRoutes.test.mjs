import assert from "node:assert/strict";
import test from "node:test";
import { artistLiveSummaryRoutes } from "./artistLiveSummaryRoutes.js";

test("feature-owned artist summary route resolves identity and preserves request privacy scope", () => {
  const artist = { norm: "alpha", name: "Alpha" };
  const query = { limit: "12", publicPreview: "1" };
  const viewer = { id: "staff", role: "admin" };
  let limited = false;
  const headers = {};
  const routes = artistLiveSummaryRoutes({
    service: { read: (options) => options },
    rateLimit: (_ctx, bucket, maximum, interval) => {
      assert.equal(bucket, "artist-live-summary"); assert.equal(maximum, 90); assert.equal(interval, 60_000); limited = true;
    },
    decodedPathParam: () => "ALPHA",
    resolveArtist: (key) => { assert.equal(key, "alpha"); return artist; },
  });
  assert.deepEqual(routes["GET /api/artists/:key/live-summary"]({ user: viewer, query,
    setHeader: (name, value) => { headers[name] = value; },
  }), { artist, viewer, query });
  assert.equal(headers["Cache-Control"], "private, no-store");
  assert.equal(limited, true);
});
