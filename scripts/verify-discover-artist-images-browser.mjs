// Exported app with local synthetic image responses; never fetch provider art.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { localServer } from './verify-discover-venues-browser.mjs';
import { fixtureApiResponse, navigationUser } from './verify-navigation-browser.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || 'playwright');
const sharp = require('sharp');
const png = await sharp({ create: { width: 300, height: 160, channels: 3, background: '#7854aa' } }).png().toBuffer();
const original = { name: 'Drake', key: 'drake', publicSlug: 'drake', genre: 'Hip-Hop', country: 'Canada', photo: null,
  spotifyPhoto: 'https://i.scdn.co/image/fixtureDrake', spotifyArtistUrl: 'https://open.spotify.com/artist/3TVXtAsR1Inumwj472S9r4',
  photoSource: 'spotify', photoCredit: 'Spotify', photoDisplayPolicy: 'original' };
const out = resolve('.tmp/discover-artist-images-browser'); mkdirSync(out, { recursive: true });
const { server, origin } = await localServer();
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
try {
  for (const width of [375, 1280]) for (const member of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    let row = original;
    const errors = [], imageRequests = [], apiRequests = [];
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const json = body => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      try {
        if (url.hostname === 'i.scdn.co') {
          imageRequests.push(url.href);
          const broken = url.pathname.endsWith('/brokenFixture');
          return route.fulfill({ status: broken ? 404 : 200, contentType: 'image/png', body: broken ? Buffer.from('not an image') : png });
        }
        if (url.hostname === 'wsrv.nl') { imageRequests.push(url.href); return route.fulfill({ contentType: 'image/png', body: png }); }
        if (url.origin !== origin) return route.abort();
        if (!url.pathname.startsWith('/api/')) return route.continue();
        apiRequests.push(url.pathname);
        if (url.pathname === '/api/client-errors') { errors.push('Client error report'); return json({ ok: true }); }
        assert.equal(request.method(), 'GET');
        if (url.pathname === '/api/me') return json({ user: member ? navigationUser : null });
        if (url.pathname === '/api/me/artist-recommendations') return json({ personalized: true, signalCount: 1,
          recommendations: [{ artist: row, reason: { code: 'genre', label: 'Based on your saved Hip-Hop taste.' }, socialProof: { count: 0, people: [] } }] });
        if (url.pathname === '/api/discover/overview') return json({ chart: { rows: [row], source: 'popularity' },
          genres: [{ genre: 'Hip-Hop', count: 1 }], countries: [{ country: 'Canada', count: 1 }], catalogTotal: 1 });
        if (url.pathname === '/api/discover/chart') return json({ rows: [row], source: 'popularity' });
        if (url.pathname === '/api/resolve') return json({ entity: { kind: 'artist', name: 'Drake', key: 'drake', path: '/artist/drake' } });
        if (url.pathname === '/api/artists/resolve') throw new Error('Discover navigation must retain canonical artist identity');
        if (url.pathname === '/api/artists/drake/profile') return json({ artist: row, profile: null, posts: [], legacyProfile: false });
        if (url.pathname === '/api/artists/drake/memorial') return json({ memorial: null });
        if (url.pathname === '/api/artists/drake/live-summary') return json({ artist: { key: 'drake', name: 'Drake' },
          reputation: { avgRating: null, ratingCount: 0, reviewCount: 0, showCount: 0 },
          schedule: { items: [], total: 0, hasMore: false, nextCursor: null, legacy: false, coverage: { status: 'fresh' } } });
        return json(fixtureApiResponse(url.pathname, { member, method: request.method(), resolvedPath: url.searchParams.get('path') }));
      } catch (error) { errors.push(error.message); return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Missing fixture' }) }); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    const name = `${member ? 'member' : 'guest'}-${width}`;
    const cards = () => page.getByRole('link', { name: 'Open Drake, Hip-Hop', exact: true });
    const credit = () => page.getByRole('link', { name: 'Image from Spotify. Open Drake on Spotify', exact: true });
    try {
      await page.goto(origin + '/artists', { waitUntil: 'domcontentloaded' });
      await cards().first().waitFor(); await credit().first().waitFor();
      await page.waitForFunction(uri => [...document.images].some(img => img.src === uri && img.complete && img.naturalWidth === 300), original.spotifyPhoto);
      assert.ok(await cards().count() >= 2, 'popular and genre surfaces both render');
      for (const card of await cards().all()) {
        assert.equal(await card.getByRole('link').count(), 0, 'credit is never a nested link');
        assert.equal(await card.locator('img').getAttribute('src'), original.spotifyPhoto);
        const fit = await card.locator('img').evaluate(img => getComputedStyle(img).objectFit);
        assert.equal(fit, 'contain');
      }
      if (member) {
        const recommended = page.getByRole('button', { name: 'Open Drake. Based on your saved Hip-Hop taste.', exact: true });
        await recommended.waitFor();
        assert.equal(await recommended.locator('img').getAttribute('src'), original.spotifyPhoto);
        assert.equal(await recommended.locator('img').evaluate(img => getComputedStyle(img).objectFit), 'contain');
      }
      await cards().first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(out, `${name}-discover.png`) });
      await cards().first().click(); await page.waitForURL('**/artist/drake');
      await page.getByRole('img', { name: 'Drake image from Spotify', exact: true }).waitFor();
      assert.ok(imageRequests.includes(original.spotifyPhoto));
      assert.equal(imageRequests.some(url => url.includes('wsrv.nl') && url.includes('scdn')), false);
      await page.getByRole('img', { name: 'Drake image from Spotify', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(out, `${name}-profile.png`) });
      // A fresh catalogue snapshot with missing or invalid attribution must not
      // retain the old image. A bad URI falls back without inventing a photo.
      for (const mode of ['missing', 'invalid', 'broken', 'replacement', 'generic', 'curated']) {
        row = mode === 'missing' ? { name: 'Drake', key: 'drake', publicSlug: 'drake', genre: 'Hip-Hop', photo: null }
          : mode === 'invalid' ? { ...original, photoCredit: 'Unverified' }
          : mode === 'curated' ? { name: 'Drake', key: 'drake', publicSlug: 'drake', genre: 'Hip-Hop', photo: 'https://profile-art.fixture.invalid/verified-avatar.jpg' }
          : mode === 'generic' ? { ...original, photo: 'https://cdn-images.dzcdn.net/images/artist/fixture.jpg' }
          : { ...original, spotifyPhoto: `https://i.scdn.co/image/${mode === 'broken' ? 'brokenFixture' : 'replacementFixture'}` };
        await page.goto(origin + '/artists', { waitUntil: 'domcontentloaded' }); await cards().first().waitFor();
        if (['missing', 'invalid', 'broken'].includes(mode)) {
          await page.waitForFunction(() => [...document.querySelectorAll('a[aria-label="Open Drake, Hip-Hop"]')].every(card => !card.querySelector('img')));
          if (mode !== 'broken') assert.equal(await credit().count(), 0);
        } else {
          await page.waitForFunction(() => [...document.querySelectorAll('a[aria-label="Open Drake, Hip-Hop"] img')].every(img => img.complete && img.naturalWidth === 300));
          assert.ok(await cards().first().locator('img').count());
          assert.equal((await cards().first().locator('img').getAttribute('src')).includes(['generic', 'curated'].includes(mode) ? 'wsrv.nl' : 'replacementFixture'), true);
        }
        if (mode === 'curated') {
          assert.equal(await credit().count(), 0, 'curated artwork is not mislabeled Spotify');
          for (const card of await cards().all()) assert.ok((await card.locator('img').getAttribute('src')).includes(encodeURIComponent(row.photo)));
          if (member) {
            const recommendation = page.getByRole('button', { name: 'Open Drake. Based on your saved Hip-Hop taste.', exact: true });
            assert.ok((await recommendation.locator('img').getAttribute('src')).includes(encodeURIComponent(row.photo)));
          }
          await page.screenshot({ path: resolve(out, `${name}-curated-discover.png`) });
        }
      }
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ name, passed: true, profileAndDiscoverSameOriginal: true, popularAndGenre: true,
        personalizedRecommendation: member, invalidMissingBrokenReplacementGeneric: true, remoteResolverCalls: apiRequests.filter(path => path === '/api/artists/resolve').length }));
    } catch (error) {
      await page.screenshot({ path: resolve(out, `${name}-failed.png`) });
      console.error(JSON.stringify({ name, errors, body: (await page.locator('body').innerText()).slice(-2500) })); throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
