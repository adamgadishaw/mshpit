import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";

// This existing long-cooldown fixture owns a process: a real shared provider
// wait must not be reset merely to run the unrelated healthy-provider cases.
const directory = mkdtempSync(join(tmpdir(), "pit-artist-resolver-retry-after-"));
process.env.PIT_DATA_DIR = directory;
const originalFetch = globalThis.fetch;
const blockedFetch = async () => assert.fail("This fixture permits only explicitly mocked provider requests");
globalThis.fetch = blockedFetch;
const { db, artistStmts } = await import("./db.js");
const { routes } = await import("./api.js");
after(() => { globalThis.fetch = originalFetch; db.close(); rmSync(directory, { recursive: true, force: true }); });
const lookup = name => routes["GET /api/artists/resolve"]({ query: { name }, ip: "artist-resolver-retry-after" });
const json = (payload, status = 200, headers = {}) => new Response(JSON.stringify(payload), { status, headers });
const unavailable = error => error.code === "PROVIDER_UNAVAILABLE" && error.status === 502;

test("a MusicBrainz miss plus unavailable Deezer remains unavailable on replay with a declining retry delay", async () => {
  let calls = 0;
  const realNow = Date.now;
  globalThis.fetch = async (url) => {
    calls++;
    if (new URL(url).hostname === "musicbrainz.org") return json({ artists: [] });
    assert.equal(new URL(url).hostname, "api.deezer.com");
    return json({}, 503, { "Retry-After": "7200" });
  };
  try {
    let first;
    await assert.rejects(lookup("Availability Retry Fixture"), (error) => {
      first = error;
      return unavailable(error) && error.cause.provider === "Deezer" && error.retryAfterMs > 7_000_000;
    });
    Date.now = () => realNow() + 60_000;
    await assert.rejects(lookup("Availability Retry Fixture"), (error) => unavailable(error)
      && error.retryAt === first.retryAt && error.retryAfterMs <= first.retryAfterMs - 60_000);
    assert.equal(calls, 2, "replaying the failure does not repeat either provider request");
    assert.equal(artistStmts.byNorm.get("availability retry fixture"), undefined);
  } finally { Date.now = realNow; globalThis.fetch = blockedFetch; }
});
