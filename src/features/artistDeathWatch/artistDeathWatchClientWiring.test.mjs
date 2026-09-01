import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const apiSource = read("./artistDeathWatchApi.mjs");
const hookSource = read("./useArtistDeathWatchAdmin.js");
const panelSource = read("../../components/moderation/ArtistDeathWatchPanel.jsx");

test("the artist-alert API separates status reads from the immediate manual trigger", () => {
  assert.match(apiSource, /artist-death-watch\?status=\$\{encodeURIComponent\(status\)\}&limit=100/);
  assert.match(apiSource, /running: response\?\.running === true/);
  assert.match(apiSource, /startedAt:/);
  assert.match(apiSource, /api\("\/api\/admin\/artist-death-watch\/scan", \{/);
  assert.match(apiSource, /method: "POST"/);
  assert.match(apiSource, /signal,/);
  assert.match(apiSource, /expectedAccountId: accountId/);
});

test("the admin hook scopes each filter and polls only a running settled snapshot", () => {
  assert.match(hookSource, /artist-death-watch:\$\{accountId\}:\$\{status\}/);
  assert.match(hookSource, /readArtistDeathWatch\(\{ accountId, signal: controller\.signal, status \}\)/);
  assert.match(hookSource, /shouldPollArtistDeathWatch\(\{/);
  assert.match(hookSource, /running: projected\.data\?\.running/);
  assert.match(hookSource, /setTimeout\(\(\) => setRevision/);
  assert.match(hookSource, /setStatusState\(normalizeArtistDeathWatchFilter\(value\)\)/);
});

test("the moderation panel names and counts each review state without presenting pending alerts as every deceased artist", () => {
  assert.match(panelSource, /ARTIST_DEATH_WATCH_FILTERS\.map/);
  assert.match(panelSource, /counts = \{ pending, dismissed, memorialized \}/);
  assert.match(panelSource, /title=\{running \? "Checking" : "Check now"\}/);
  assert.match(panelSource, /Checking artist sources in the background/);
  assert.match(panelSource, /LAST SOURCE WARNING/);
  assert.match(panelSource, /ARTISTS ELIGIBLE TO CHECK/);
  assert.match(panelSource, /CURRENT CATALOG PASS/);
  assert.match(panelSource, /It is not a count of every deceased artist in the catalog/);
  assert.match(panelSource, /Return to review/);
  assert.match(panelSource, /Memorial published/);
  assert.doesNotMatch(panelSource, /EXACT IDENTITIES COVERED/);
  assert.doesNotMatch(panelSource, /all dead artists/iu);
});
