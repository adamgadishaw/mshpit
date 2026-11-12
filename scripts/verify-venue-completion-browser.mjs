// Exported app on loopback with explicitly synthetic API fixtures. Actual
// conversion, revocation, session and publication permissions are DB-tested.
// No production account, venue, upload or notification is changed here.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { localServer, discoverVenueFixture } from './verify-discover-venues-browser.mjs';
import { fixtureApiResponse, navigationUser } from './verify-navigation-browser.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || 'playwright');
const path = '/venue/ticketmaster-fixture-london-river';
const entity = { entityType: 'venue', entityKey: path, name: 'Fixture London River Room' };
const out = resolve('.tmp/venue-completion-browser'); mkdirSync(out, { recursive: true });
const { server, origin } = await localServer();
const browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
try {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    let actor = { ...navigationUser }, failFollow = true, failPosts = true, failSave = true;
    let preference = { following: false, notifyUpdates: true }, posts = [];
    const errors = [], writes = [], followWrites = [], historyPages = [];
    const community = { path, creatorEntity: entity, ownership: 'community', isOperator: false, claim: null, myReview: null, rating: { count: 0, average: null }, reviews: [], nextCursor: null };
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      try {
        if (url.pathname === '/api/me') return respond({ user: actor });
        if (url.pathname === '/api/health') return respond({ ok: true, capabilities: { mediaPublishing: { photos: true, videos: true, pipeline: 'private-derivative-v1', sourceTypes: ['video/mp4'] } } });
        if (url.pathname === '/api/resolve') return respond({ entity: { kind: 'venue', name: entity.name, path, source: 'ticketmaster', providerVenueId: 'fixture-london-river' } });
        if (url.pathname === '/api/venue-snapshot') return respond(discoverVenueFixture(url.pathname, { resolvedPath: path }));
        if (url.pathname === '/api/venue-community') return respond(community);
        if (url.pathname === '/api/venue-community/claims') {
          assert.equal(req.postDataJSON().accountConversionAcknowledged, true);
          assert.equal(actor.role, 'fan');
          community.claim = { id: 'vc_completion', status: 'pending', conversion_consent: 'venue-account-v1' };
          return respond(community);
        }
        if (url.pathname === '/api/me/venue-claims') {
          historyPages.push(url.searchParams.get('after'));
          return respond({ claims: [{ ...community.claim, venue_name: url.searchParams.has('after') ? 'Earlier venue request' : entity.name, venue_path: path }], nextCursor: url.searchParams.has('after') ? null : 'fixture-cursor' });
        }
        if (url.pathname === '/api/me/creator-entities') return respond({ entities: community.isOperator ? [entity] : [] });
        if (url.pathname.startsWith('/api/creators/venue/')) {
          assert.equal(decodeURIComponent(url.pathname.split('/')[4]), path);
          if (url.pathname.endsWith('/posts')) {
            if (failPosts) { failPosts = false; return respond({ error: 'Fixture load failure', code: 'INTERNAL_ERROR' }, 503); }
            return respond({ posts });
          }
          assert.ok(actor);
          if (req.method() === 'PUT') {
            assert.equal(req.headers()['x-pit-expected-account'], actor.id);
            const body = req.postDataJSON();
            if (url.pathname.endsWith('/follow')) {
              assert.equal(body.notifyUpdates, undefined, 'Follow must preserve the independently saved alert preference.');
              followWrites.push(body);
              if (failFollow) { failFollow = false; return respond({ error: 'Fixture follow failure', code: 'INTERNAL_ERROR' }, 503); }
              preference = { ...preference, following: body.following };
            } else preference = { ...preference, notifyUpdates: body.notifyUpdates };
          }
          return respond(preference);
        }
        if (url.pathname === '/api/posts' && req.method() === 'POST') {
          const body = req.postDataJSON(); writes.push(body);
          assert.equal(actor.role, 'venue'); assert.equal(body.creatorUpdate.entityType, 'venue'); assert.equal(body.creatorUpdate.entityKey, path);
          assert.equal(req.headers()['x-pit-expected-account'], actor.id);
          if (failSave) { failSave = false; return respond({ error: 'Fixture save failed. Your draft is safe.', code: 'VALIDATION_FAILED' }, 400); }
          const post = { ...body, id: 'p_venue_completion', userId: actor.id, user: actor, venue: entity.name,
            creatorUpdate: { ...body.creatorUpdate, entityName: entity.name }, media: [], photos: [], createdAt: Date.now(), timeAgo: 'now', likes: 0, comments: 0 };
          posts = [post]; return respond({ id: post.id, post });
        }
        if (url.pathname === '/api/posts/p_venue_completion') return respond({ post: posts[0] });
        if (url.pathname === '/api/posts/p_venue_completion/comments') return respond({ comments: [] });
        if (url.pathname.startsWith('/api/venues/') && url.pathname.endsWith('/photos')) return respond({ photos: [], fanPhotos: [], state: 'ready' });
        if (url.pathname.startsWith('/api/venues/') && url.pathname.endsWith('/reviews')) return respond({ reviews: [], nextCursor: null });
        if (url.pathname === '/api/client-errors') { errors.push('Client crash report'); return respond({ ok: true }); }
        return respond(fixtureApiResponse(url.pathname, { member: !!actor, method: req.method(), resolvedPath: url.searchParams.get('path') || undefined }));
      } catch (error) { errors.push(error.message); return respond({ error: 'Missing fixture', code: 'INTERNAL_ERROR' }, 500); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    const button = name => page.getByRole('button', { name, exact: true });
    try {
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await page.getByText(/Updates couldn.t be loaded\./).waitFor(); await button('Try again').click();
      await page.getByText('No updates from this page yet.', { exact: true }).waitFor();
      assert.equal(await button('Post to followers').count(), 0);
      await button('Follow venue updates').click(); await page.getByRole('alert').last().waitFor();
      await button('Follow venue updates').click(); await button('Unfollow venue updates').waitFor();
      await button('Turn off update alerts').click(); await button('Turn on update alerts').waitFor();
      await button('Unfollow venue updates').click(); await button('Follow venue updates').waitFor();
      assert.equal(preference.notifyUpdates, false);
      await button('Follow venue updates').click(); await button('Turn on update alerts').waitFor();
      await button('Claim this venue').click();
      await page.getByLabel('Official venue website', { exact: true }).fill('https://venue.example.test');
      await page.getByLabel('Your role at the venue', { exact: true }).fill('I run this venue. The official office can confirm my authority.');
      assert.equal(await button('Submit claim for review').isDisabled(), true);
      await button('I agree to the venue account change if approved').click(); await button('Submit claim for review').click();
      await page.getByText('Your claim is pending staff review.', { exact: false }).waitFor();
      assert.equal(await button('Post to followers').count(), 0);
      await button('Your venue requests').click(); await button('Next venue requests').click();
      await button('Earlier venue request').waitFor(); await button('First venue requests').click();
      await button('Next venue requests').waitFor(); assert.ok(historyPages.includes('fixture-cursor'));
      await page.screenshot({ path: resolve(out, `pending-${width}.png`), fullPage: true });
      // Separate DB tests prove session invalidation and reviewed conversion.
      // This reload represents the claimant signing in after that approval.
      actor = { ...actor, role: 'venue' }; community.ownership = 'verified'; community.isOperator = true; community.claim.status = 'approved';
      await page.reload(); await button('Post to followers').waitFor();
      await page.screenshot({ path: resolve(out, `operator-${width}.png`), fullPage: true });
      await button('Post to followers').click();
      await page.getByText(`Posting as ${entity.name}`, { exact: true }).waitFor();
      const title = page.getByLabel('Title', { exact: true }); await title.fill('Doors open at seven');
      await button('Post').first().click();
      await page.getByRole('alert').filter({ hasText: 'Your update is still here' }).waitFor();
      assert.equal(await title.inputValue(), 'Doors open at seven');
      await page.screenshot({ path: resolve(out, `composer-retry-${width}.png`) });
      await button('Post').first().click();
      await page.getByRole('heading', { name: 'Post to followers', exact: true }).waitFor({ state: 'hidden' });
      assert.equal(writes.length, 2); assert.equal(writes[0].clientMutationId, writes[1].clientMutationId);
      assert.deepEqual(writes[0].creatorUpdate, writes[1].creatorUpdate);
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await button('Open update: Doors open at seven').click();
      await page.waitForURL('**/post/p_venue_completion');
      await page.getByText('Doors open at seven', { exact: true }).first().waitFor();
      await page.goBack(); await button('Post to followers').waitFor();
      // Revoked, conflicting and guest accounts must lose/have no composer.
      actor = { ...actor, role: 'fan' }; community.ownership = 'community'; community.isOperator = false; community.claim.status = 'revoked';
      await page.reload(); await button('Claim this venue').waitFor(); assert.equal(await button('Post to followers').count(), 0);
      actor = { ...actor, role: 'artist', artistName: 'Fixture Artist' }; community.claim = null;
      await page.reload(); await page.getByText('Use a separate account dedicated to this venue.', { exact: false }).waitFor();
      assert.equal(await button('Claim this venue').count(), 0); assert.equal(await button('Post to followers').count(), 0);
      actor = null; await page.reload(); await button('Follow venue updates').waitFor();
      const count = followWrites.length; await button('Follow venue updates').click();
      await page.waitForURL('**/login'); assert.equal(followWrites.length, count);
      assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      console.log(JSON.stringify({ width, passed: true, accountStates: ['pending', 'approved', 'revoked', 'artist', 'guest'], followAttempts: followWrites.length, postAttempts: writes.length, historyPagination: true, postCommentsNavigation: true }));
    } catch (error) {
      await page.screenshot({ path: resolve(out, `failed-${width}.png`), fullPage: true });
      console.error(JSON.stringify({ width, errors, body: (await page.locator('body').innerText()).slice(-7000) })); throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); await new Promise(done => server.close(done)); }
