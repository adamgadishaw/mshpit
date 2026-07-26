// The owner's exact complaint: a manually-pasted video is accepted even when the
// daily search budget is spent, but automatic lookup would not "just look it up."
// The reason was discovery cost — finding the channel needed a search. With the
// channel known (now free via Wikidata), automatic resolution must succeed from
// the channel's uploads WITHOUT any search, even at budget=0. This pins that.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.PIT_DATA_DIR = mkdtempSync(join(tmpdir(), "pit-resolve-budget-"));
const { db, artistStmts, artistRow } = await import("./db.js");
const { resolveYouTubeTrack } = await import("./musicProviders.js");

// The Pacific day key the budget counter uses, replicated so we can exhaust it.
const pacificDay = () => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const p = (t) => parts.find((e) => e.type === t)?.value || "00";
  return `${p("year")}-${p("month")}-${p("day")}`;
};

test("a known-channel song resolves from the catalogue at budget=0, with no search", async () => {
  // A real touring artist with a KNOWN channel (as the Wikidata backfill stores).
  artistStmts.upsert.run(artistRow("r. kelly", { name: "R. Kelly", mbid: "c2d25856-a09a-4d15-b404-77dd19c19e63" }));
  artistStmts.setChannel.run("UCkln_Dk0Ej9N5yudDTHDwxw", Date.now(), "r. kelly");

  // Exhaust the daily search budget, exactly the owner's situation.
  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(`youtube_search_calls:${pacificDay()}`, "100000");

  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    // If automatic lookup ever reaches a search, the whole premise fails.
    if (/\/search\?/.test(url)) throw new Error("resolution used a SEARCH — the budget fix is defeated");
    const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
    if (/\/channels\?/.test(url)) return json({ items: [{ id: "UCkln_Dk0Ej9N5yudDTHDwxw", contentDetails: { relatedPlaylists: { uploads: "UUkln_uploads" } } }] });
    if (/\/playlistItems\?/.test(url)) return json({ items: [{ snippet: { title: "Bump & Grind", resourceId: { videoId: "BUMPGRIND01" } } }] });
    if (/\/videos\?/.test(url)) return json({ items: [{ id: "BUMPGRIND01", snippet: { title: "Bump & Grind", channelTitle: "R. Kelly - Topic" }, contentDetails: { duration: "PT4M10S" }, status: { embeddable: true, privacyStatus: "public" } }] });
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await resolveYouTubeTrack("Bump & Grind", "R. Kelly", { expectedDurationSec: 250, apiKey: "test-key", fetchImpl });

  assert.equal(result.videoId, "BUMPGRIND01", "the real video resolved");
  assert.equal(result.status, "artist_catalogue", "via the cheap catalogue, not a search");
  assert.equal(calls.some((u) => /\/search\?/.test(u)), false, "no search was made");
});
