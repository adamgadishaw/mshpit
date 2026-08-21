// End-to-end proof for the owner's exact complaint: with interactive search
// exhausted, a canonical MusicBrainz identity is discovered through Wikidata,
// validated through channels.list, and resolved through the uploads catalogue.
// No part of that chain may call search.list.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.PIT_DATA_DIR = mkdtempSync(join(tmpdir(), "pit-resolve-budget-"));
const { db, artistStmts, artistRow } = await import("./db.js");
const { resolveYouTubeTrack } = await import("./musicProviders.js");

const pacificDay = () => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "00";
  return `${part("year")}-${part("month")}-${part("day")}`;
};

test("MBID -> Wikidata -> validated channel resolves at budget=0 without search", async () => {
  const mbid = "c2d25856-a09a-4d15-b404-77dd19c19e63";
  const channelId = "UCkln_Dk0Ej9N5yudDTHDwxw";
  artistStmts.purge.run("r. kelly");
  db.prepare("DELETE FROM wikidata_channel_checks WHERE mbid=?").run(mbid);
  artistStmts.upsert.run(artistRow("r. kelly", { name: "R. Kelly", mbid }));

  db.prepare("INSERT INTO app_meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(`youtube_search_calls:${pacificDay()}`, "100000");

  const calls = [];
  const fetchImpl = async (url) => {
    const value = String(url);
    calls.push(value);
    if (/\/search\?/.test(value)) throw new Error("resolution used search.list");
    const json = (body) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    });

    if (value.startsWith("https://query.wikidata.org/")) {
      const query = new URL(value).searchParams.get("query") || "";
      assert.match(query, new RegExp(mbid));
      return json({ results: { bindings: [
        { mbid: { value: mbid }, yt: { value: channelId } },
      ] } });
    }
    if (/\/channels\?/.test(value)) {
      const part = new URL(value).searchParams.get("part");
      if (part === "snippet") {
        return json({ items: [{ id: channelId, snippet: { title: "R. Kelly - Topic" } }] });
      }
      return json({ items: [{
        id: channelId,
        contentDetails: { relatedPlaylists: { uploads: "UUkln_uploads" } },
      }] });
    }
    if (/\/playlistItems\?/.test(value)) {
      return json({ items: [{
        snippet: { title: "Bump & Grind", resourceId: { videoId: "BUMPGRIND01" } },
      }] });
    }
    if (/\/videos\?/.test(value)) {
      return json({ items: [{
        id: "BUMPGRIND01",
        snippet: { title: "Bump & Grind", channelTitle: "R. Kelly - Topic" },
        contentDetails: { duration: "PT4M10S", licensedContent: true },
        status: { embeddable: true, privacyStatus: "public" },
      }] });
    }
    throw new Error(`unexpected URL ${value}`);
  };

  const result = await resolveYouTubeTrack("Bump & Grind", "R. Kelly", {
    expectedDurationSec: 250,
    apiKey: "test-key",
    fetchImpl,
  });

  assert.equal(result.videoId, "BUMPGRIND01", "the real video resolved");
  assert.equal(result.status, "artist_catalogue", "via the catalogue, not search");
  assert.equal(calls.some((url) => /\/search\?/.test(url)), false, "no search was made");
  assert.equal(calls.filter((url) => url.startsWith("https://query.wikidata.org/")).length, 1);

  const stored = artistStmts.getChannel.get("r. kelly");
  assert.equal(stored.channelId, channelId);
  assert.equal(stored.source, "wikidata_v4");
  const check = db.prepare("SELECT channel_id,validated FROM wikidata_channel_checks WHERE mbid=?").get(mbid);
  assert.equal(check.channel_id, channelId);
  assert.equal(check.validated, 1);
  assert.equal(
    db.prepare("SELECT value FROM app_meta WHERE key=?").get(`youtube_search_calls:${pacificDay()}`).value,
    "100000",
  );
});
