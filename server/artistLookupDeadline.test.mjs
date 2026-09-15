import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

test("real route aborts a stalled response stream within the artist deadline", { timeout: 20_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "pit-lookup-deadline-"));
  process.env.PIT_DATA_DIR = directory;
  const { db } = await import("./db.js");
  const { routes } = await import("./api.js");
  const originalFetch = globalThis.fetch;
  let disposed = false, providerSignal;
  const at = Date.now();
  try {
    globalThis.fetch = async (url, options) => {
      if (!String(url).includes("musicbrainz.org")) return new Response(JSON.stringify({ data: [] }));
      providerSignal = options.signal;
      return new Response(new ReadableStream({ cancel() { disposed = true; } }));
    };
    await assert.rejects(routes["GET /api/artists/resolve"]({
      query: { name: "Body Stall Fixture" }, ip: "deadline-fixture",
    }), (error) => error.code === "PROVIDER_UNAVAILABLE");
    assert.ok(Date.now() - at < 8_000);
    assert.ok(providerSignal, "isolated route fixture must actually reach MusicBrainz");
    assert.equal(providerSignal.aborted, true);
    assert.equal(disposed, true);
  } finally {
    globalThis.fetch = originalFetch;
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
