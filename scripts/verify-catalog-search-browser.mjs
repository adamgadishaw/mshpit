// Exported website + actual catalogue route + throwaway SQLite. All other APIs
// are explicit synthetic fixtures; neither browser nor server may reach providers.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fixtureApiResponse, navigationUser, localBuildServer, loadChromium } from './verify-navigation-browser.mjs';
const directory = mkdtempSync(join(tmpdir(), 'pit-catalog-browser-'));
process.env.PIT_DATA_DIR = directory;
const {
  db
} = await import('../server/db.js');
const {
  routes
} = await import('../server/api.js');
const target = {
  id: 'tm_1a8Zk48Je1ZZe8k',
  artist: 'Bon Jovi',
  venue: 'Rogers Stadium',
  place: 'Toronto, Canada',
  date: '2027-08-04',
  source: 'ticketmaster'
};
const insert = db.prepare('INSERT INTO tour_dates(id,artist,venue,place,date,source,updated_at,venue_city,venue_country_code,venue_country,venue_provider_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
for (let i = 0; i < 28; i++) insert.run(i === 27 ? target.id : `catalog-browser-${String(i).padStart(2, '0')}`, target.artist, target.venue, target.place, i === 27 ? target.date : '2027-07-01', target.source, Date.now(), 'Toronto', 'CA', 'Canada', 'rogers-stadium-fixture');
const coverageDate = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
for (const [id,artist] of [['catalog-title-tour','Fixture Artist'],['catalog-billing','Fixture Artist'],['catalog-unicode','Beyoncé']]) {
  insert.run(id,artist,'Fixture Hall','Toronto',coverageDate,'ticketmaster',Date.now(),'Toronto','CA','Canada','fixture-hall');
}
db.prepare("UPDATE tour_dates SET event_name='Fixture Artist - Moonlight Tour',tour_name='Moonlight Tour' WHERE id='catalog-title-tour'").run();
db.prepare("UPDATE tour_dates SET music_evidence='ticketmaster:classification:music',billed_artists=? WHERE id='catalog-billing'").run(JSON.stringify(['Fixture Artist','Support Lantern']));
db.prepare("UPDATE tour_dates SET venue_region='Québec' WHERE id='catalog-unicode'").run();
const output = resolve(process.env.PIT_CATALOG_BROWSER_OUTPUT || '../catalog-browser-receipt');
mkdirSync(output, {
  recursive: true
});
const {
  server,
  origin
} = await localBuildServer();
let browser;
const results = [];
try {
  browser = await loadChromium().launch({
    headless: true,
    executablePath: process.env.PIT_BROWSER_EXECUTABLE
  });
  for (const width of [390, 1280]) for (const member of [false, true]) {
    const name = `catalog-${member ? 'member' : 'guest'}-${width}`;
    const context = await browser.newContext({
      viewport: {
        width,
        height: 844
      },
      isMobile: width < 620,
      hasTouch: width < 620,
      serviceWorkers: 'block'
    });
    const state = {
      member,
      calls: [],
      errors: [],
      consoleErrors: [],
      reports: [],
      photoFailures: 0,
      held: [],
      hold: null,
      fail: false,
      failMore: false,
      duplicate: false
    };
    await context.addInitScript(({
      origin,
      user
    }) => {
      if (location.origin !== origin) return;
      localStorage.setItem('pit_theme', 'stage');
      if (user) {
        localStorage.setItem('pit.session', JSON.stringify(user));
        localStorage.setItem('pit.users', JSON.stringify([user]));
      }
    }, {
      origin,
      user: member ? navigationUser : null
    });
    await context.route('**/*', async route => {
      const req = route.request(),
        url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      state.calls.push({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams)
      });
      try {
        let body;
        if (url.pathname === '/api/search/events') {
          assert.equal(req.method(), 'GET');
          assert.equal(url.searchParams.get('limit'), '24');
          if (state.hold && url.searchParams.get('q') === state.hold.toLowerCase()) await new Promise(done => state.held.push(done));
          if (state.fail || state.failMore && url.searchParams.has('after')) return await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Synthetic catalogue unavailable'
            })
          });
          body = routes['GET /api/search/events']({
            query: Object.fromEntries(url.searchParams),
            user: state.member ? navigationUser : null,
            ip: name
          });
          if (state.duplicate && url.searchParams.has('after')) body.events.unshift({
            ...body.events[0]
          });
        } else if (url.pathname === '/api/tourdates') {
          assert.equal(url.searchParams.get('days'), '30', 'Search must keep the startup horizon unchanged');
          body = routes['GET /api/tourdates']({
            query: Object.fromEntries(url.searchParams),
            user: null
          });
          assert.ok(!body.tourDates.some(row => row.id === target.id));
        } else if (url.pathname === '/api/artists') body = {
          artists: url.searchParams.get('q') ? [{
            name: 'Bon Jovi',
            key: 'bon jovi',
            publicSlug: 'bon-jovi'
          }] : []
        };else if (url.pathname === '/api/analytics/guest-search') {
          assert.deepEqual(Object.keys(req.postDataJSON()).sort(), ['kind', 'outcome', 'resultBucket']);
          body = {
            ok: true
          };
        } else if (url.pathname === '/api/people') {
          assert.ok(state.member);
          body = {
            people: []
          };
        } else if (url.pathname === '/api/me') body = {
          user: state.member ? navigationUser : null
        };else if (url.pathname === '/api/resolve' && url.searchParams.get('path') === `/event/${target.id}`) body = {
          entity: {
            ...target,
            kind: 'event',
            path: `/event/${target.id}`,
            publicEventSnapshot: true
          }
        };else if (url.pathname === '/api/venues/rogers%20stadium/photos') {
          state.photoFailures++;
          return await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Synthetic optional venue photos unavailable',
              code: 'PROVIDER_UNAVAILABLE'
            })
          });
        } else if (url.pathname === '/api/artists/reviews') body = {
          reviews: []
        };else if (url.pathname === '/api/artists/seen') body = {
          seen: []
        };else if (/^\/api\/artists\/bon(?:%20|-)jovi\/(?:profile|live-summary|memorial)$/.test(url.pathname)) body = url.pathname.endsWith('/profile') ? {
          artist: {
            name: 'Bon Jovi',
            key: 'bon jovi'
          },
          profile: null,
          posts: []
        } : url.pathname.endsWith('/memorial') ? {
          memorial: null
        } : {
          artist: {
            name: 'Bon Jovi',
            key: 'bon jovi'
          },
          reputation: {},
          schedule: {
            items: [],
            total: 0,
            hasMore: false
          }
        };else {
          if (url.pathname === '/api/client-errors') state.reports.push(req.postDataJSON());
          body = fixtureApiResponse(url.pathname, {
            member: state.member,
            method: req.method(),
            resolvedPath: url.searchParams.get('path') || undefined
          });
        }
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(body)
        });
      } catch (error) {
        if (!/closed|disposed|handled|aborted|canceled|cancelled/i.test(error.message)) state.errors.push(error.message);
        await route.abort().catch(() => {});
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    page.on('pageerror', e => state.errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error' && !((m.location().url.startsWith(origin + '/api/search/events?') || m.location().url.startsWith(origin + '/api/venues/rogers%20stadium/photos')) && /Failed to load resource:.*503/.test(m.text()))) state.consoleErrors.push(m.text());
    });
    const field = () => page.getByLabel('Search Mshpit', {
      exact: true
    });
    const ready = async () => {
      await page.waitForTimeout(300);
      await page.getByRole('progressbar', {
        name: 'Searching Mshpit',
        exact: true
      }).waitFor({
        state: 'hidden'
      });
    };
    const search = async q => {
      await field().fill(q);
      await ready();
    };
    const shows = () => page.getByRole('tab', {
      name: /^Shows(?:,|$)/
    });
    const more = () => page.getByRole('button', {
      name: 'Load more shows',
      exact: true
    });
    const row = () => page.getByRole('button', {
      name: /^Open show for Bon Jovi at Rogers Stadium/
    });
    const requestCount = () => state.calls.filter(c => c.path === '/api/search/events').length;
    const held = async () => {
      const deadline = Date.now() + 5000;
      while (!state.held.length) {
        assert.ok(Date.now() < deadline, 'Expected pending catalogue request');
        await page.waitForTimeout(20);
      }
    };
    const release = () => {
      state.hold = null;
      state.held.splice(0).forEach(done => done());
    };
    const step = async (label, fn) => {
      await fn();
      console.log(JSON.stringify({
        name,
        step: label,
        passed: true
      }));
    };
    let failure;
    try {
      await page.goto(origin + '/search');
      await field().waitFor();
      await ready();
      assert.equal(requestCount(), 0, 'No empty-query archive fetch');
      await step('future query, bounded first page and honest continuation', async () => {
        await search('Bon Jovi');
        await shows().click();
        assert.equal(await row().count(), 24);
        await more().waitFor();
        assert.equal(requestCount(), 1, 'Typing must not crawl the entire archive');
        assert.equal(state.calls.find(call => call.path === '/api/search/events').query.q, 'bon jovi');
        await field().fill('  BON JOVI  ');
        await ready();
        await field().fill('Bon Jovi');
        await ready();
        assert.equal(requestCount(), 1, 'Case/edge whitespace edits retain the same query generation');
        assert.equal(await page.getByRole('button', {
          name: /^Open show for Bon Jovi.*2027.*08.*04/
        }).count(), 0);
        await page.getByText(/More shows may be available\./).first().waitFor();
      });
      await step('pending continuation cannot overwrite a newer query', async () => {
        state.hold = 'Bon Jovi';
        await more().click(); await held();
        await search('Rogers'); release(); await ready();
        assert.equal(await field().inputValue(), 'Rogers');
        assert.equal(await row().count(), 24);
        await search('Bon Jovi'); assert.equal(await row().count(), 24);
      });
      await step('later-page outage retains rows and explicit retry deduplicates stable IDs', async () => {
        state.failMore = true;
        await more().click();
        await page.getByText('More shows could not load. Your current matches are still here.', {
          exact: true
        }).waitFor();
        assert.equal(await row().count(), 24);
        state.failMore = false;
        state.duplicate = true;
        await more().click();
        await page.waitForFunction(() => document.querySelectorAll('[aria-label^="Open show for Bon Jovi at Rogers Stadium"]').length === 28);
        assert.equal(await row().count(), 28);
        assert.equal(await more().count(), 0);
      });
      await step('future result navigation and Back restore second-page depth', async () => {
        const targetRow = page.getByRole('button', {
          name: /^Open show for Bon Jovi.*2027.*08.*04/
        });
        await targetRow.waitFor();
        await targetRow.click();
        await page.waitForURL(`**/event/${target.id}`);
        await page.getByRole('button', {
          name: "Open Rogers Stadium's venue page",
          exact: true
        }).first().waitFor();
        const count = requestCount(),
          historyLength = await page.evaluate(() => history.length);
        await page.goBack();
        await field().waitFor();
        await ready();
        assert.equal(await field().inputValue(), 'Bon Jovi');
        assert.equal(await row().count(), 28);
        assert.equal(requestCount(), count + 2, 'Return refetches only the two remembered pages');
        assert.equal(await page.evaluate(() => history.length), historyLength);
      });
      await step('venue query finds far-future venue and shows beyond startup', async () => {
        await search('Rogers Stadium');
        await page.getByRole('tab', {
          name: /^Venues(?:,|$)/
        }).click();
        await page.getByRole('button', {
          name: /^Open venue Rogers Stadium/
        }).first().waitFor();
        await shows().click();
        assert.equal(await row().count(), 24);
      });
      await step('optional venue-photo failure remains isolated', async () => {
        assert.ok(state.photoFailures > 0);
        assert.equal(await row().count(), 24);
      });
      await step('cancelled slow query cannot replace newer venue results', async () => {
        state.hold = 'Bon Jovi';
        await field().fill('Bon Jovi');
        await held();
        await search('Rogers');
        release();
        await ready();
        assert.equal(await field().inputValue(), 'Rogers');
        assert.equal(await row().count(), 24);
      });
      await step('unavailable catalogue is partial failure and retry recovers', async () => {
        state.fail = true;
        await search('Bon Jovi Toronto');
        await page.getByRole('button', {
          name: 'Retry search',
          exact: true
        }).waitFor();
        assert.equal(await row().count(), 0);
        assert.equal(await page.getByText(/No shows for/).count(), 0);
        state.fail = false;
        await page.getByRole('button', {
          name: 'Retry search',
          exact: true
        }).click();
        await ready();
        assert.equal(await row().count(), 24);
      });
      await step('public title, tour, billing, region and accent coverage is retained', async () => {
        for (const [query, artist] of [['Moonlight','Fixture Artist'],['Lantern','Fixture Artist'],['quebec','Beyoncé'],['BEYONCE\u0301','Beyoncé']]) {
          await search(query); await shows().click();
          await page.getByRole('button',{name:new RegExp('^Open show for '+artist+' at Fixture Hall')}).waitFor();
          assert.equal(await row().count(),0,'A field query must not display unrelated Bon Jovi shows');
        }
      });
      if (member) await step('logout during catalogue request discards old scope', async () => {
        state.hold = 'Bon Jovi';
        await field().fill('Bon Jovi');
        await held();
        state.member = false;
        await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {
          key: 'pit.auth.epoch.v1',
          newValue: JSON.stringify({
            at: Date.now()
          })
        })));
        await page.getByRole('link', {
          name: 'Browse concerts',
          exact: true
        }).waitFor();
        release();
        await page.getByRole('link', {
          name: 'Browse concerts',
          exact: true
        }).click();
        await page.getByRole('tab', {
          name: 'Search',
          exact: true
        }).click();
        await field().waitFor();
        assert.equal(await field().inputValue(), '');
      });
      await search('Bon Jovi');
      await shows().click();
      await page.screenshot({
        path: resolve(output, name + '.png')
      });
      assert.deepEqual(state.errors, []);
      assert.deepEqual(state.consoleErrors, []);
      assert.deepEqual(state.reports, []);
    } catch (error) {
      failure = error.message;
      await page.screenshot({
        path: resolve(output, name + '-failure.png')
      }).catch(() => {});
      writeFileSync(resolve(output, name + '-failure.txt'), await page.locator('body').innerText().catch(() => ''));
    } finally {
      release();
      await context.close();
    }
    results.push({
      name,
      passed: !failure,
      ...(failure ? {
        failure,
        errors: state.errors
      } : {}),
      requests: requestCount()
    });
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
  db.close();
  rmSync(directory, {
    recursive: true,
    force: true
  });
}
writeFileSync(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
