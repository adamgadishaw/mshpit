import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

const store = read("../../store.js");
const adminScreen = read("../../screens/AdminScreen.jsx");
const consoleSource = read("../../components/moderation/ArtistMemorialConsole.jsx");
const memorialService = read("./services/artistMemorialApi.mjs");
const memorialHook = read("./useArtistMemorial.js");

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing source start: ${start}`);
  assert.notEqual(endIndex, -1, `missing source end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("the store strictly prepares one exact memorial artist in the initiating admin scope", () => {
  const method = between(store, "const prepareMemorialArtist =", "// Catalog queue (admin)");

  assert.match(method, /sessionAtStart\?\.role !== "admin"/);
  assert.match(method, /prepareArtistMemorialCandidate\(name, \{/);
  assert.doesNotMatch(method, /api\("/);
  assert.match(method, /signal,/);
  assert.match(method, /context,/);
  assert.match(method, /expectedAccountId: accountId/);
  assert.match(method, /staffScopeFor\(sessionRef\.current\) !== scope/);
  assert.match(method, /const artist = await prepareArtistMemorialCandidate/);
  assert.match(method, /cacheArtists\(\[artist\]\)/);
  assert.match(method, /return artist;/);
  assert.doesNotMatch(method, /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:null|undefined|\[\])/);
});

test("the memorial service owns the exact-identity API contract and validates its response", () => {
  const method = between(memorialService, "export async function prepareArtistMemorialCandidate", "export async function readArtistMemorial");

  assert.match(method, /api\("\/api\/admin\/artists\/enrich"/);
  assert.match(method, /method: "POST"/);
  assert.match(method, /body: \{ names: \[name\], requireExactIdentity: true \}/);
  assert.match(method, /signal: options\.signal/);
  assert.match(method, /context,/);
  assert.match(method, /expectedAccountId: options\.expectedAccountId/);
  assert.match(method, /preparedMemorialArtistFromResponse\(response\)/);
  assert.doesNotMatch(method, /catch\s*(?:\([^)]*\))?\s*\{\s*return\s+(?:null|undefined|\[\])/);
});

test("the admin screen supplies the exact resolver to the memorial console", () => {
  assert.match(adminScreen, /searchArtistsApi, prepareMemorialArtist,/);
  assert.match(adminScreen, /onResolveArtist=\{prepareMemorialArtist\}/);
});

test("saving a memorial refreshes the canonical tour-date snapshot in the same session", () => {
  assert.match(memorialHook, /typeof onSaved === "function"\) onSaved\(saved\)/);
  assert.match(adminScreen, /prepareMemorialArtist, refreshTourDates/);
  assert.match(adminScreen, /onSaved: \(\) => \{[\s\S]*?refreshTourDates\(\)/);
  assert.match(store, /const refreshTourDates = async/);
  assert.match(store, /refreshTourDates, visibleTourDates/);
});

test("the memorial console recovers empty catalog searches without manual artist keys or auto-publishing", () => {
  assert.match(consoleSource, /value\?\.message \|\| value\?\.userMessage/);
  assert.match(consoleSource, /title="Find exact artist & autofill"/);
  assert.match(consoleSource, /artistResolveRef\.current\(query, \{ signal: controller\.signal \}\)/);
  assert.match(consoleSource, /resolveSequence\.current !== sequence/);
  assert.match(consoleSource, /scopeRef\.current !== operationScope/);
  assert.match(consoleSource, /!isMemorialDraftCandidate\(artist\)/);
  assert.match(consoleSource, /Choose an exact MusicBrainz-backed artist before saving this memorial/);
  assert.match(consoleSource, /You must still enter the death date, source, and confirmation yourself/);
  assert.doesNotMatch(consoleSource, /enrich the artist in the Catalog tab first/);

  const artistKeyField = between(consoleSource, 'label="Artist key"', '<View style={styles.field} accessibilityRole="radiogroup"');
  assert.match(artistKeyField, /editable=\{false\}/);
  assert.match(artistKeyField, /accessibilityState=\{\{ disabled: true \}\}/);
  assert.doesNotMatch(artistKeyField, /onChangeText=/);
  assert.match(consoleSource, /status: "draft"/);
  assert.match(consoleSource, /never publishes automatically/);
});
