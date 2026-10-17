import test from 'node:test';
import assert from 'node:assert/strict';
import { createUnifiedVenueSearchIndex, searchUnifiedVenueIndex } from './unifiedLocationSearch.mjs';
import { venueListingProviderIdentity } from './venueListingIdentity.mjs';

const names = ['İSTANBUL Room', 'IĞDIR Hall', 'Straße', 'Årena', 'Élysée', 'Łódź', 'ΑΘΉΝΑ', 'МАЯК', '東京', 'Ζυρίχη'];

test('venue provider keys preserve the previous explicit English casing across non-ASCII inputs', () => {
  for (const value of [...names, 'Iİıi', 'ΟΣ ΣΙΓΜΑ', 'KELVIN', 'ẞ-Straße']) {
    const source = `SOURCE-${value}`, providerVenueId = `ID-${value}`;
    assert.equal(venueListingProviderIdentity({ source, providerVenueId }),
      `provider:${source.trim().toLocaleLowerCase('en')}:${providerVenueId.trim().toLocaleLowerCase('en')}`);
  }
});

test('venue index ordering matches the previous default-locale string comparison', () => {
  const index = createUnifiedVenueSearchIndex({ curatedVenues: names.map(name => ({ name, city: 'Toronto', country: 'Canada' })) });
  assert.equal(index.length, names.length);
  assert.deepEqual(index.map(entry => entry.row.name), names.slice().sort((a, b) => a.localeCompare(b)));
});

test('case and accent search retain their multilingual results after the native casing optimization', () => {
  const index = createUnifiedVenueSearchIndex({ curatedVenues: names.map(name => ({ name, city: 'Toronto', country: 'Canada' })) });
  for (const query of ['istanbul', 'STRASSE', 'éLYSÉE', 'ΑΘΉΝΑ', 'маяк', '東京']) {
    // English Unicode lowercasing does not transliterate German sharp-s.
    const expected = query === 'STRASSE' ? [] : [names.find(name => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en')
      .includes(query.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en')))];
    assert.deepEqual(searchUnifiedVenueIndex(index, query).map(row => row.name), expected);
  }
});

test('the reused comparator does not merge distinct provider rooms with the same display name', () => {
  const rows = ['ROOM-Iİ-1', 'ROOM-Iİ-2'].map(providerVenueId => ({ name: 'İSTANBUL Room', source: 'TICKETMASTER', providerVenueId, venueCity: 'Toronto', venueCountryCode: 'CA' }));
  const index = createUnifiedVenueSearchIndex({ curatedVenues: rows });
  assert.equal(index.length, 2);
  assert.deepEqual(index.map(entry => entry.row.identity), rows.map(row => venueListingProviderIdentity(row)).sort((a, b) => a.localeCompare(b)));
});

test('venue country codes retain explicit English uppercase identity', () => {
  for (const code of ['ca', 'ie', 'pt', 'tr', 'iE', 'US', 'GB']) {
    const index = createUnifiedVenueSearchIndex({ curatedVenues: [{ name: 'Local code fixture', venueCity: 'Fixture city', venueCountryCode: code }] });
    assert.equal(index[0].row.venueCountryCode, code.toLocaleUpperCase('en'));
  }
});
