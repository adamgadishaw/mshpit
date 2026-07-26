import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

process.env.PIT_DATA_DIR = mkdtempSync(join(tmpdir(), "pit-wikidata-"));
const { buildSparql, parseWikidataChannels, pickChannel } = await import("./wikidataChannels.js");

test("the SPARQL query only embeds sanitized MusicBrainz ids", () => {
  const q = buildSparql(["c2d25856-a09a-4d15-b404-77dd19c19e63", 'evil"} INJECT']);
  assert.match(q, /wdt:P434/);
  assert.match(q, /wdt:P2397/);
  assert.match(q, /"c2d25856-a09a-4d15-b404-77dd19c19e63"/);
  // Anything that is not hex/hyphen is stripped, so a value cannot break out of
  // the VALUES clause.
  assert.doesNotMatch(q, /INJECT/);
  assert.doesNotMatch(q, /"evil/);
});

test("Wikidata results become mbid -> ordered channel ids, junk dropped", () => {
  const json = { results: { bindings: [
    { mbid: { value: "mb1" }, yt: { value: "UCaHNFIob5Ixv74f5on3lvIw" } },
    { mbid: { value: "mb1" }, yt: { value: "UCIjYyZxkFucP_W-tmXg_9Ow" } },
    { mbid: { value: "mb1" }, yt: { value: "UCaHNFIob5Ixv74f5on3lvIw" } }, // dup
    { mbid: { value: "mb2" }, yt: { value: "not-a-channel" } },            // junk
    { mbid: { value: "mb3" }, yt: { value: "UCz8FPpkJMwayyReSDLTX8IQ" } },
  ] } };
  const map = parseWikidataChannels(json);
  assert.deepEqual(map.get("mb1"), ["UCaHNFIob5Ixv74f5on3lvIw", "UCIjYyZxkFucP_W-tmXg_9Ow"]);
  assert.equal(map.has("mb2"), false, "an id that is not a UC… channel is dropped");
  assert.deepEqual(map.get("mb3"), ["UCz8FPpkJMwayyReSDLTX8IQ"]);
});

test("channel selection prefers a Topic channel, else the first", () => {
  const ids = ["UCofficial00000000000", "UCtopic0000000000000000"];
  // No titles known: take the first (Wikidata ranks the primary channel first).
  assert.equal(pickChannel(ids), "UCofficial00000000000");
  // Titles known: the full-catalogue Topic channel wins wherever it sits.
  assert.equal(pickChannel(ids, {
    "UCofficial00000000000": "Calvin Harris",
    "UCtopic0000000000000000": "Calvin Harris - Topic",
  }), "UCtopic0000000000000000");
  assert.equal(pickChannel([]), null);
  assert.equal(pickChannel(null), null);
});
