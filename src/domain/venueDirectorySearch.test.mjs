import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { venueDirectoryCities, matchingVenueCities } from './venueDirectorySearch.mjs';
import { createUnifiedVenueSearchIndex, searchUnifiedVenueIndex } from './unifiedLocationSearch.mjs';
import { discoverRowMatchesRegion } from './discoverScene.mjs';

const venue = (id, place, name = 'Same Room') => ({ source: 'ticketmaster', providerVenueId: id, name, place });
const index = createUnifiedVenueSearchIndex({ curatedVenues: [
  venue('london-ca', 'London, Ontario, Canada'), venue('london-uk', 'London, England, United Kingdom'),
  venue('london-other', 'London, Ontario, Canada'), venue('sao', 'São Paulo, Brazil', 'Fixture'),
  venue('missing', 'Unknown', 'Missing location'),
] });

test('city browsing keeps complete place and provider identity for same-named rooms', () => {
  const cities = venueDirectoryCities(index), before = structuredClone(index);
  const londons = matchingVenueCities(cities, 'London');
  assert.equal(londons.length, 2); assert.notEqual(londons[0].id, londons[1].id);
  const canada = matchingVenueCities(cities, 'London Canada');
  assert.equal(canada.length, 1); assert.equal(canada[0].count, 2);
  assert.deepEqual(canada[0].venues.map(row => row.providerVenueId).sort(), ['london-ca', 'london-other']);
  assert.ok(canada[0].venues.every(row => row.source === 'ticketmaster'));
  assert.deepEqual(index, before);
  assert.equal(cities.some(row => row.city === 'Unknown'), false);
});

test('city search handles accents, qualified locations, clear and zero results without invented cities', () => {
  const cities = venueDirectoryCities(index);
  assert.equal(matchingVenueCities(cities, '  SAO PAULO  ')[0].city, 'São Paulo');
  assert.equal(matchingVenueCities(cities, 'London, England')[0].region, 'England, United Kingdom');
  for (const query of ['', '   ', 'Never Heard Of City', 'Same Room']) assert.deepEqual(matchingVenueCities(cities, query), []);
  const many = Array.from({ length: 30 }, (_, n) => ({ city: 'London', region: `Region ${n}`, id: n }));
  assert.equal(matchingVenueCities(many, 'London').length, 8);
});

test('country filtering occurs before the venue result cap and excludes other cities from browsing', () => {
  const rows = [...Array.from({ length: 55 }, (_, n) => venue(`uk-${n}`, 'London, England, United Kingdom', `A Room ${n}`)), venue('ca', 'London, Ontario, Canada', 'Z Room')];
  const source = createUnifiedVenueSearchIndex({ curatedVenues: rows });
  const filter = row => discoverRowMatchesRegion(row, 'Canada');
  assert.deepEqual(searchUnifiedVenueIndex(source, 'London', { limit: 50, filter }).map(row => row.providerVenueId), ['ca']);
  assert.deepEqual(venueDirectoryCities(source, { filter }).map(row => row.id), ['london|ontario|canada']);
});

// Execute the existing Store loader, rather than duplicate its race policy.
// This proves the current candidate already rejects out-of-order refreshes.
const source = readFileSync(new URL('../store.js', import.meta.url), 'utf8');
let loader;
function visit(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'VariableDeclarator' && node.id?.name === 'refreshTourDates') loader = source.slice(node.init.start, node.init.end);
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value?.type) visit(value);
}
visit(parse(source, { sourceType: 'module', plugins: ['jsx'] }));
function refreshHarness() {
  const pending = [], accepted = [], sessionRef = { current: { id: 'viewer' } }, tourDateReadRef = { current: { sequence: 0, accountId: 'viewer' } };
  const bindings = { authReady: true, session: sessionRef.current, sessionRef, tourDateReadRef, ENABLE_DEMO_DATA: false,
    countryForCity: () => null, sanitizeTourDates: value => value, tourDatesRef: { current: [] },
    setTourDates: value => accepted.push(value), fetchStartupTourDates: options => new Promise(resolve => pending.push({ resolve, options })) };
  const refresh = new Function(...Object.keys(bindings), `return (${loader});`)(...Object.values(bindings));
  return { pending, accepted, refresh, sessionRef };
}

test('existing hydration rejects older responses after a newer venue snapshot', async () => {
  const h = refreshHarness(), older = h.refresh(), newer = h.refresh();
  h.pending[1].resolve({ tourDates: [{ id: 'new' }] }); await newer;
  h.pending[0].resolve({ tourDates: [{ id: 'old' }] }); await older;
  assert.deepEqual(h.accepted, [[{ id: 'new' }]]);
});

test('aborted or previous-account venue snapshots cannot be adopted', async () => {
  for (const change of ['abort', 'account']) {
    const h = refreshHarness(), controller = new AbortController(), result = h.refresh({ signal: controller.signal });
    if (change === 'abort') controller.abort(); else h.sessionRef.current = { id: 'different' };
    h.pending[0].resolve({ tourDates: [{ id: 'private-old' }] }); await result;
    assert.deepEqual(h.accepted, []);
  }
});
