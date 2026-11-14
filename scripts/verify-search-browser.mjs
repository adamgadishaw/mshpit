// Real exported website; isolated synthetic accounts and loopback API fixtures only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fixtureApiResponse, navigationUser, navigationArtist, artistPath, eventPath, localBuildServer, loadChromium } from './verify-navigation-browser.mjs';
const output = resolve(process.env.PIT_SEARCH_BROWSER_OUTPUT || '../search-receipt');
mkdirSync(output, {
  recursive: true
});
const event = {
  id: 'tm_navigation_fixture',
  artist: 'Fixture Artist',
  artistKey: 'fixture-artist',
  venue: 'Fixture Venue',
  city: 'Toronto',
  date: new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10),
  source: 'ticketmaster',
  providerActive: true
};
const rows = Array.from({
  length: 20
}, (_, i) => ({
  ...navigationArtist,
  name: i ? `Fixture Artist ${i}` : navigationArtist.name,
  key: i ? `fixture-artist-${i}` : navigationArtist.key
}));
rows.splice(10, 0, rows.shift());
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
    const name = `search-${member ? 'member' : 'guest'}-${width}`;
    if (process.env.PIT_SEARCH_BROWSER_CASE && !name.includes(process.env.PIT_SEARCH_BROWSER_CASE)) continue;
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
      delayed: [],
      fail: false,
      hold: false
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
        q: url.searchParams.get('q'),
        method: req.method()
      });
      if (url.pathname === '/api/client-errors') state.reports.push(req.postDataJSON());
      try {
        let body;
        if (url.pathname === '/api/me') body = {
          user: state.member ? state.account || navigationUser : null
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
        } else if (url.pathname === '/api/resolve' && url.searchParams.get('path')?.startsWith('/venue/')) body = {
          entity: {
            kind: 'venue',
            name: 'Fixture Venue',
            city: 'Toronto',
            path: url.searchParams.get('path')
          }
        };else if (url.pathname === '/api/artists/reviews') body = {
          reviews: []
        };else if (url.pathname === '/api/artists/seen') body = {
          seen: []
        };else if (url.pathname === '/api/tourdates') body = {
          tourDates: [event]
        };else if (url.pathname === '/api/search/events') body = { events: (url.searchParams.get('q') || '').includes('fixture') ? [event] : [], nextCursor: null };
        else if (url.pathname === '/api/artists') {
          const q = url.searchParams.get('q') || '';
          if (state.hold && q) await new Promise(done => state.delayed.push(done));
          if (state.fail && q) return await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({
              error: 'Fixture outage'
            })
          });
          body = {
            artists: q ? q.includes('fixture') ? rows : [{
              name: `${q} Result`,
              key: q.replaceAll(' ', '-'),
              publicSlug: q.replaceAll(' ', '-')
            }] : []
          };
        } else body = fixtureApiResponse(url.pathname.replaceAll('navigation-second', 'navigation-fixture-user'), {
          member: state.member,
          method: req.method(),
          resolvedPath: url.searchParams.get('path') || undefined
        });
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
    page.setDefaultTimeout(10000);
    page.on('pageerror', e => state.errors.push(e.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      if (message.location().url.startsWith(origin + '/api/artists?') && /Failed to load resource:.*503/.test(message.text())) return;
      state.consoleErrors.push(message.text());
    });
    let failure;
    const step = async (label, fn) => {
      await fn();
      console.log(JSON.stringify({
        name,
        step: label,
        passed: true
      }));
    };
    const waitDelayed = async () => {
      const deadline = Date.now() + 5000;
      while (!state.delayed.length) {
        assert.ok(Date.now() < deadline, 'Held request did not reach fixture');
        await page.waitForTimeout(25);
      }
    };
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
    const category = label => page.getByRole('tab', {
      name: new RegExp('^' + label + '(?:,|$)')
    });
    const artistRow = () => page.getByRole('button', {
      name: 'Open artist Fixture Artist',
      exact: true
    });
    const getScroll = () => artistRow().evaluate(el => {
      for (let n = el.parentElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 100 && getComputedStyle(n).overflowY === 'auto') return n.scrollTop;
      throw Error('Missing scroll owner');
    });
    const scrollTo = async y => {
      await artistRow().evaluate((el, y) => {
        for (let n = el.parentElement; n; n = n.parentElement) if (n.scrollHeight > n.clientHeight + 100 && getComputedStyle(n).overflowY === 'auto') {
          n.scrollTop = y;
          n.dispatchEvent(new Event('scroll'));
          return;
        }
        throw Error('Missing scroll owner');
      }, y);
      await page.waitForTimeout(140);
    };
    try {
      await page.goto(origin + '/search');
      await field().waitFor();
      await ready();
      if (process.env.PIT_SEARCH_BROWSER_MODE !== 'continuity') {
        await step('settled A-B-A', async () => {
          await search('radio');
          await field().fill('radiox');
          await page.waitForTimeout(40);
          await field().fill('radio');
          await ready();
          await page.getByRole('button', {
            name: 'Open artist radio Result',
            exact: true
          }).waitFor();
        });
        await step('active A-B-A and slow cancelled response', async () => {
          state.hold = true;
          await field().fill('drake');
          await page.getByRole('progressbar', {
            name: 'Searching Mshpit',
            exact: true
          }).waitFor();
          await waitDelayed();
          await field().fill('drakex');
          await page.waitForTimeout(40);
          await field().fill('drake');
          await page.waitForTimeout(350);
          assert.ok(state.delayed.length >= 2);
          state.hold = false;
          state.delayed.pop()();
          await ready();
          await page.getByRole('button', {
            name: 'Open artist drake Result',
            exact: true
          }).waitFor();
          state.delayed.splice(0).forEach(done => done());
          await page.waitForTimeout(150);
          assert.equal(await field().inputValue(), 'drake');
          await ready();
        });
        await step('clear/retype and normalized edits', async () => {
          await page.getByRole('button', {
            name: 'Clear search',
            exact: true
          }).click();
          await search('radio');
          const before = state.calls.filter(c => c.path === '/api/artists').length;
          await field().fill('  RADIO  ');
          await ready();
          await page.waitForTimeout(350);
          assert.equal(state.calls.filter(c => c.path === '/api/artists').length, before);
        });
        await step('out-of-order different query', async () => {
          state.hold = true;
          await field().fill('slow');
          while (!state.delayed.length) await page.waitForTimeout(25);
          state.hold = false;
          await search('newest');
          state.delayed.splice(0).forEach(done => done());
          await page.waitForTimeout(150);
          await page.getByRole('button', {
            name: 'Open artist newest Result',
            exact: true
          }).waitFor();
          assert.equal(await page.getByText('slow Result', {
            exact: true
          }).count(), 0);
        });
        await step('partial failure and explicit retry', async () => {
          state.fail = true;
          await search('fixture');
          await page.getByRole('button', {
            name: 'Retry search',
            exact: true
          }).waitFor();
          await category('Shows').click();
          await page.getByRole('button', {
            name: /^Open show for Fixture Artist at Fixture Venue/
          }).waitFor();
          state.fail = false;
          await page.getByRole('button', {
            name: 'Retry search',
            exact: true
          }).click();
          await ready();
          await category('Artists').click();
          await page.getByRole('button', {
            name: "Open artist Fixture Artist",
            exact: true
          }).waitFor();
        });
      } else {
        await search('fixture');
        await category('Artists').click();
      }
      await step('artist Back/Forward restores query, filter, scroll without history growth', async () => {
        await scrollTo(350);
        const y = await getScroll();
        assert.ok(y > 100);
        const len = await page.evaluate(() => history.length);
        await page.getByRole('button', {
          name: "Open artist Fixture Artist",
          exact: true
        }).click();
        await page.waitForURL('**' + artistPath);
        await page.getByRole('tab', {
          name: 'About artist page section',
          exact: true
        }).waitFor();
        await page.goBack();
        await field().waitFor();
        await ready();
        assert.equal(await field().inputValue(), 'fixture');
        assert.equal(await page.getByRole('button', {
          name: /^Open show for Fixture Artist/
        }).count(), 0);
        await page.waitForTimeout(180);
        assert.ok(Math.abs((await getScroll()) - y) < 5, `scroll ${await getScroll()} != ${y}`);
        await page.goForward();
        await page.waitForURL('**' + artistPath);
        await page.getByRole('button', {
          name: 'Leave Fixture Artist artist profile',
          exact: true
        }).first().click();
        await field().waitFor();
        await ready();
        assert.equal(await field().inputValue(), 'fixture');
        assert.equal(await page.evaluate(() => history.length), len + 1);
      });
      if (process.env.PIT_SEARCH_BROWSER_MODE !== 'continuity') {
        await step('show and venue return', async () => {
          await category('Shows').click();
          await page.getByRole('button', {
            name: /^Open show for Fixture Artist at Fixture Venue/
          }).click();
          await page.waitForURL('**' + eventPath);
          await page.getByRole('button', {
            name: "Open Fixture Venue's venue page",
            exact: true
          }).first().waitFor();
          await page.goBack();
          await field().waitFor();
          await ready();
          assert.equal(await field().inputValue(), 'fixture');
          assert.equal(await page.getByRole('button', {
            name: 'Open artist Fixture Artist',
            exact: true
          }).count(), 0);
          await page.getByRole('button', {
            name: 'Open venue Fixture Venue',
            exact: true
          }).click();
          await page.waitForURL(/\/venue\//);
          await page.goBack();
          await field().waitFor();
          await ready();
          assert.equal(await field().inputValue(), 'fixture');
          assert.equal(await page.getByRole('button', {
            name: 'Open artist Fixture Artist',
            exact: true
          }).count(), 0);
        });
        await category('All').click();
        if (width < 620) await step('mobile pull refresh bypasses settled cache and cancels on edit', async () => {
          const pull = () => page.locator('[data-pit-refresh-scroll-owner="true"]').evaluate(owner => {
            owner.scrollTop = 0;
            const send = (type, y, end = false) => {
              const touch = new Touch({
                identifier: 1,
                target: owner,
                clientX: 100,
                clientY: y
              });
              owner.dispatchEvent(new TouchEvent(type, {
                bubbles: true,
                cancelable: true,
                touches: end ? [] : [touch],
                changedTouches: [touch],
                targetTouches: end ? [] : [touch]
              }));
            };
            send('touchstart', 100);
            send('touchmove', 140);
            send('touchmove', 280);
            send('touchend', 280, true);
          });
          const before = state.calls.filter(c => c.path === '/api/artists').length;
          state.hold = true;
          await pull();
          await waitDelayed();
          await pull();
          await page.waitForTimeout(120);
          assert.equal(state.calls.filter(c => c.path === '/api/artists').length, before + 1, 'Repeated pull must not duplicate requests');
          state.hold = false;
          state.delayed.splice(0).forEach(done => done());
          await ready();
          await page.getByText('Refreshing search', {
            exact: true
          }).waitFor({
            state: 'hidden'
          });
          state.hold = true;
          await pull();
          await waitDelayed();
          await field().fill('refresh-edit');
          state.hold = false;
          state.delayed.splice(0).forEach(done => done());
          await ready();
          await page.getByRole('button', {
            name: 'Open artist refresh-edit Result',
            exact: true
          }).waitFor();
        });
        await step('unmount aborts and returning refetches', async () => {
          state.hold = true;
          await field().fill('unmount');
          while (!state.delayed.length) await page.waitForTimeout(25);
          await page.getByRole('tab', {
            name: 'Discover',
            exact: true
          }).click();
          state.hold = false;
          state.delayed.splice(0).forEach(done => done());
          await page.goBack();
          await field().waitFor();
          await ready();
          assert.equal(await field().inputValue(), 'unmount');
          await page.getByRole('button', {
            name: 'Open artist unmount Result',
            exact: true
          }).waitFor();
        });
        await step('account switch while search is active', async () => {
          if (!member) return;
          state.hold = true;
          await field().fill('first-account-private');
          await waitDelayed();
          state.account = {
            ...navigationUser,
            id: 'navigation-second',
            name: 'Second Fixture',
            handle: 'secondfixture'
          };
          await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', {
            key: 'pit.auth.epoch.v1',
            newValue: JSON.stringify({
              at: Date.now()
            })
          })));
          await page.waitForURL('**/feed');
          state.hold = false;
          state.delayed.splice(0).forEach(done => done());
          await page.getByRole('tab', {
            name: 'Search',
            exact: true
          }).click();
          await field().waitFor();
          await ready();
          assert.equal(await field().inputValue(), '');
        });
        await step('account boundary clears private return state', async () => {
          if (!member) return;
          await page.getByRole('tab', {
            name: 'Discover',
            exact: true
          }).click();
          await page.getByRole('tab', {
            name: 'Search',
            exact: true
          }).click();
          await field().waitFor();
          state.hold = true;
          await field().fill('private-context');
          await waitDelayed();
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
          state.hold = false;
          state.delayed.splice(0).forEach(done => done());
          await page.goBack();
          await page.goBack();
          await field().waitFor();
          await ready();
          assert.equal(await field().inputValue(), '');
        });
        await step('UI and continuity privacy', async () => {
          await search('fixture');
          assert.equal(await page.evaluate(() => location.search), '');
          const history = await page.evaluate(() => JSON.stringify(window.history.state));
          assert.ok(!history.includes('fixture'));
          await page.screenshot({
            path: resolve(output, name + '.png')
          });
          assert.deepEqual(state.errors, []);
          assert.deepEqual(state.consoleErrors, []);
          assert.deepEqual(state.reports, []);
        });
      }
    } catch (e) {
      failure = e.message;
      await page.screenshot({
        path: resolve(output, name + '-failure.png')
      }).catch(() => {});
      writeFileSync(resolve(output, name + '-failure.txt'), await page.locator('body').innerText().catch(() => ''));
    } finally {
      state.delayed.splice(0).forEach(done => done());
      await context.close();
    }
    results.push({
      name,
      passed: !failure,
      ...(failure ? {
        failure,
        errors: state.errors
      } : {}),
      artistRequests: state.calls.filter(c => c.path === '/api/artists').length
    });
    console.log(JSON.stringify(results.at(-1)));
  }
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
writeFileSync(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
if (results.some(r => !r.passed)) process.exitCode = 1;
