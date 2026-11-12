import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spotifyArtistPhotoModel } from './spotifyArtistPhoto.mjs';
const sample = { spotifyPhoto: 'https://i.scdn.co/image/fixture123', spotifyArtistUrl: 'https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4',
  photoSource: 'spotify', photoCredit: 'Spotify', photoDisplayPolicy: 'original' };
const spotifyArtistImageUrl = value => spotifyArtistPhotoModel({ ...sample, spotifyPhoto: value })?.uri || '';
const spotifyArtistPageUrl = value => spotifyArtistPhotoModel({ ...sample, spotifyArtistUrl: value })?.sourceUrl || '';

test('original artwork validates complete canonical HTTPS image and artist URLs', () => {
  const image = 'https://i.scdn.co/image/fixture123';
  const page = 'https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4';
  for (const [validate, valid] of [[spotifyArtistImageUrl, image], [spotifyArtistPageUrl, page]]) {
    assert.equal(validate(valid), valid);
    assert.equal(validate(valid.replace('https://', 'HTTPS://')), valid);
    assert.equal(validate(valid.replace('.co/', '.co:443/').replace('.com/', '.com:443/')), valid);
    for (const invalid of [null, {}, '', valid.replace('https:', 'http:'), valid.replace('://', '://name:secret@'),
      valid.replace('.co/', '.co.evil/').replace('.com/', '.com.evil/'), valid + '?token=private', valid + '#fragment', valid + '?', valid + '#',
      valid.replace('.co/', '.co:123/').replace('.com/', '.com:123/'), valid.replace('/image/', '/IMAGE/').replace('/artist/', '/ARTIST/')]) {
      assert.equal(validate(invalid), '', String(invalid));
    }
  }
  assert.equal(spotifyArtistImageUrl(image + '/'), '');
  assert.equal(spotifyArtistPageUrl(page + '/'), page + '/');
  assert.equal(spotifyArtistPageUrl(page.slice(0, -1)), '');
});

test('the lightweight credit asset preserves the existing supplied logo paths and viewBox exactly', () => {
  const source = readFileSync(new URL('../components/SpotifyFullLogo.jsx', import.meta.url), 'utf8');
  const asset = readFileSync(new URL('../../assets/spotify-full-logo.svg', import.meta.url), 'utf8');
  const paths = text => [...text.matchAll(/<(?:Path|path) fill="([^"]+)" d="([^"]+)"/gu)].map(match => match.slice(1));
  assert.equal(paths(asset).length, 4);
  assert.deepEqual(paths(asset), paths(source));
  assert.ok(asset.includes('viewBox="0 0 823.46 225.25"'));
});
