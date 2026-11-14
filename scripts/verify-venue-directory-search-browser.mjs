// Real exported app; all API responses are synthetic and loopback-only. No
// provider calls, device location, real accounts or production writes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { localServer } from './verify-discover-venues-browser.mjs';
import { fixtureApiResponse, navigationUser } from './verify-navigation-browser.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || 'playwright');
const out = resolve('.tmp/venue-directory-search-browser'); mkdirSync(out, { recursive: true });
const { server, origin } = await localServer();
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
const year = new Date().getUTCFullYear() + 1;
const event = (id, venue, city, region, country) => ({ id, artist: 'Fixture Artist', venue, source: 'ticketmaster', providerVenueId: id,
  place: [city, region, country].filter(Boolean).join(', '), venueCity: city, venueRegion: region, venueCountry: country,
  date: `${year}-09-20`, releaseAt: 0, providerActive: true });
const dates = [event('fixture-toronto-north', 'Fixture North Room', 'Toronto', 'Ontario', 'Canada'),
  event('fixture-london-ca', 'Fixture Shared Room', 'London', 'Ontario', 'Canada'),
  event('fixture-london-uk', 'Fixture Shared Room', 'London', 'England', 'United Kingdom')];
try {
  for (const width of [320, 375, 1280]) for (const member of [false, true]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: 'block' });
    const pending = new Map(), errors = [], releaseOrder = [], snapshotPaths = [];
    let reads = 0, released = false;
    await context.addInitScript(() => {
      window.__venueLocationRequests = 0;
      for (const method of ['getCurrentPosition', 'watchPosition']) Object.defineProperty(navigator.geolocation, method, {
        value() { window.__venueLocationRequests++; throw new Error('Venue text search must not request location'); }, configurable: true,
      });
    });
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      try {
        if (url.pathname === '/api/client-errors') { errors.push('Client error report'); return json({ ok: true }); }
        assert.equal(req.method(), 'GET', 'Venue search is read-only');
        if (url.pathname === '/api/me') return json({ user: member ? { ...navigationUser, home: { ...navigationUser.home, country: 'Canada' } } : null });
        if (url.pathname === '/api/tourdates') {
          reads++;
          if (released) return json({ tourDates: dates });
          const key = url.searchParams.has('country') ? 'home' : 'global';
          pending.set(key, async () => { releaseOrder.push(key); await json({ tourDates: dates }); });
          return;
        }
        if (url.pathname === '/api/venue-snapshot') {
          const path = url.searchParams.get('path'); snapshotPaths.push(path);
          const row = dates.find(item => path === `/venue/ticketmaster-${item.providerVenueId}`);
          assert.ok(row, 'Opened venue must retain its exact provider identity');
          return json({ path, venue: { name: row.venue, place: row.place, source: row.source, providerVenueId: row.providerVenueId }, events: [], hasMore: false, nextCursor: null, after: null });
        }
        if (url.pathname === '/api/venue-community') return json({ path: url.searchParams.get('path'), ownership: 'community', isOperator: false,
          creatorEntity: null, claim: null, myReview: null, rating: { count: 0, average: null }, stats: { reviewCount: 0, ratingCount: 0, averageRating: null }, reviews: [], nextCursor: null });
        if (/^\/api\/venues\/.*\/photos$/.test(url.pathname)) return json({ photos: [], fanPhotos: [], state: 'ready' });
        if (/^\/api\/venues\/.*\/reviews$/.test(url.pathname)) return json({ reviews: [], stats: { reviewCount: 0, ratingCount: 0, averageRating: null }, nextCursor: null });
        return json(fixtureApiResponse(url.pathname, { member, method: req.method(), resolvedPath: url.searchParams.get('path') || undefined }));
      } catch (error) { errors.push(error.message); return json({ error: 'Missing fixture', code: 'INTERNAL_ERROR' }, 500); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    const field = page.getByRole('textbox', { name: 'Search venues or cities', exact: true });
    const button = name => page.getByRole('button', { name, exact: typeof name === 'string' });
    const name = `${member ? 'member' : 'guest'}-${width}`;
    try {
      await page.goto(origin + '/venues', { waitUntil: 'domcontentloaded' });
      await field.click(); const input = await field.elementHandle();
      await page.keyboard.type('London', { delay: 65 });
      assert.equal(await field.inputValue(), 'London'); assert.equal(await input.evaluate(el => el.isConnected && el === document.activeElement), true);
      await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('Tor', { delay: 55 });
      // Release the second country read first, while typing continues. Neither
      // response owns the input or an old query's result projection.
      assert.ok(pending.has('global'));
      if (member) { assert.ok(pending.has('home')); await pending.get('home')(); }
      await page.keyboard.type('onto', { delay: 65 });
      released = true; await pending.get('global')();
      await button(/^Fixture North Room, Toronto/).waitFor();
      assert.equal(await field.inputValue(), 'Toronto');
      assert.equal(await input.evaluate(el => el.isConnected && el === document.activeElement && el.selectionStart === 7), true);
      assert.equal(await button(/^Fixture Shared Room, London/).count(), 0);
      await page.keyboard.press('Enter'); await page.keyboard.type('x');
      assert.equal(await field.inputValue(), 'Torontox');
      await page.keyboard.press('Backspace'); await button(/^Browse venues in Toronto, Ontario, Canada,/).waitFor();
      await page.screenshot({ path: resolve(out, `${name}-city-results.png`) });
      const requestCount = reads;
      await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('Fixture North', { delay: 40 });
      await button(/^Fixture North Room, Toronto/).waitFor();
      assert.equal(await button(/^Browse venues in /).count(), 0);
      assert.equal(reads, requestCount, 'Keystrokes use the current index, not remote queries');
      await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('zzzz-no-city-9283', { delay: 30 });
      await page.getByText('No venues or cities found', { exact: true }).waitFor();
      assert.equal(await input.evaluate(el => el.isConnected && el === document.activeElement), true);
      await page.screenshot({ path: resolve(out, `${name}-empty.png`) });
      await button('Clear venue search').click(); assert.equal(await field.inputValue(), '');
      await field.click(); await page.keyboard.type('London', { delay: 40 });
      await button(/^Browse venues in London, Ontario, Canada,/).click();
      assert.equal(await field.inputValue(), '');
      await button(/^Fixture Shared Room, London/).click();
      await page.waitForURL('**/venue/ticketmaster-fixture-london-ca');
      await page.getByText('Community-run page', { exact: true }).waitFor();
      assert.ok(snapshotPaths.includes('/venue/ticketmaster-fixture-london-ca'));
      assert.ok(!snapshotPaths.includes('/venue/ticketmaster-fixture-london-uk'));
      await page.goBack(); await field.click(); await page.keyboard.type('London England', { delay: 40 });
      await button(/^Browse venues in London, England, United Kingdom,/).click();
      await button(/^Fixture Shared Room, London/).click();
      await page.waitForURL('**/venue/ticketmaster-fixture-london-uk');
      await page.getByText('Community-run page', { exact: true }).waitFor();
      assert.ok(snapshotPaths.includes('/venue/ticketmaster-fixture-london-uk'));
      assert.equal(await page.evaluate(() => window.__venueLocationRequests), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      console.log(JSON.stringify({ name, passed: true, continuousTyping: true, sameInputAfterHydration: true, releaseOrder, zeroResults: true,
        noQueryRequests: true, canonicalCities: snapshotPaths, locationRequests: 0 }));
    } catch (error) {
      await page.screenshot({ path: resolve(out, `${name}-failed.png`) });
      console.error(JSON.stringify({ name, errors, body: (await page.locator('body').innerText()).slice(-5000) })); throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
