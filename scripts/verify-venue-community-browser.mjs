// Real exported application. Loopback only, synthetic accounts and responses;
// no production service, uploaded image, credentials or device connection.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { localServer, discoverVenueFixture } from './verify-discover-venues-browser.mjs';
import { fixtureApiResponse, navigationUser } from './verify-navigation-browser.mjs';
import { staffFixture, upkeepAdmin } from './verify-catalog-maintenance-browser.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || 'playwright');
const path = '/venue/ticketmaster-fixture-london-river';
const out = resolve('.tmp/venue-community-browser'); mkdirSync(out, { recursive: true });
const { server, origin } = await localServer();
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
  for (const width of [375, 1280]) for (const mode of ['guest', 'member', 'legacy-precise']) {
    const member = mode !== 'guest', precise = mode === 'legacy-precise';
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const errors = [], mutations = [];
    let readFailure = true, saveFailure = true, claimFailure = true;
    const community = { path, ownership: 'community', isOperator: false, claim: null, myReview: null, rating: { count: 0, average: null }, reviews: [], nextCursor: null };
    if (precise) { community.myReview = { id: 'vr_historical', rating: 4.2, text: 'Historical authored note.' }; community.rating = { count: 1, average: 4.2 }; }
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const respond = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      try {
        if (url.pathname === '/api/resolve') return respond({ entity: { kind: 'venue', name: 'Fixture London River Room', path, source: 'ticketmaster', providerVenueId: 'fixture-london-river' } });
        if (url.pathname === '/api/venue-snapshot') return respond(discoverVenueFixture(url.pathname, { resolvedPath: path }));
        if (url.pathname === '/api/venue-community') {
          if (readFailure) { readFailure = false; return respond({ error: 'Fixture service failure', code: 'INTERNAL_ERROR' }, 503); }
          return respond(community);
        }
        if (url.pathname === '/api/venue-community/rating') {
          assert.ok(member); mutations.push('rating');
          if (saveFailure) { saveFailure = false; return respond({ error: 'Fixture service failure', code: 'INTERNAL_ERROR' }, 503); }
          const body = req.postDataJSON();
          if (req.method() === 'DELETE') { community.myReview = null; community.reviews = []; community.rating = { count: 0, average: null }; }
          else { community.myReview = { id: 'vr_fixture', rating: body.rating, text: body.text }; community.reviews = [{ ...community.myReview, name: navigationUser.name, userId: navigationUser.id }]; community.rating = { count: 1, average: body.rating }; }
          return respond(community);
        }
        if (url.pathname === '/api/venue-community/claims') {
          assert.ok(member); mutations.push('claim');
          if (claimFailure) { claimFailure = false; return respond({ error: 'Fixture service failure', code: 'INTERNAL_ERROR' }, 503); }
          assert.equal(req.postDataJSON().accountConversionAcknowledged, true);
          community.claim = { id: 'vc_fixture', status: 'pending', conversion_consent: 'venue-account-v1' }; return respond(community);
        }
        if (url.pathname === '/api/venue-community/claims/vc_fixture') { assert.ok(member); community.claim = { id: 'vc_fixture', status: 'cancelled' }; return respond({ ok: true }); }
        if (url.pathname.startsWith('/api/venues/') && url.pathname.endsWith('/photos')) return respond({ photos: [], fanPhotos: [], state: 'ready' });
        if (url.pathname.startsWith('/api/venues/') && url.pathname.endsWith('/reviews')) return respond({ reviews: [], nextCursor: null });
        if (url.pathname === '/api/client-errors') { errors.push('Client crash report'); return respond({ ok: true }); }
        return respond(fixtureApiResponse(url.pathname, { member, method: req.method(), resolvedPath: url.searchParams.get('path') || undefined }));
      } catch (error) { errors.push(error.message); return respond({ error: 'Missing fixture', code: 'INTERNAL_ERROR' }, 500); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    const name = `venue-community-${mode}-${width}`;
    try {
      await page.goto(origin + path, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Retry venue community', exact: true }).click();
      await page.getByText('Community-run page', { exact: true }).waitFor();
      if (!precise) await page.getByText('No venue ratings yet', { exact: true }).waitFor();
      if (member) {
        await page.getByRole('button', { name: 'Rate this venue', exact: true }).click();
        await page.getByLabel('Your venue rating', { exact: true }).press('End');
        await page.getByLabel('Your venue rating', { exact: true }).press('ArrowLeft');
        const draft = page.getByRole('textbox', { name: 'Your venue review', exact: true });
        await draft.fill('Clear sound with good views from the balcony.');
        await page.getByRole('button', { name: 'Save venue rating', exact: true }).click();
        await page.getByRole('alert').last().waitFor();
        assert.equal(await draft.inputValue(), 'Clear sound with good views from the balcony.');
        await page.getByRole('button', { name: 'Save venue rating', exact: true }).click();
        await page.getByText('Your venue rating is saved.', { exact: true }).waitFor();
        await page.getByText(precise ? '4.2' : '4.5', { exact: true }).first().waitFor();
        assert.equal(community.myReview.rating, precise ? 4.2 : 4.5, 'Unchanged legacy precision and half-stars survive note edits and failed-save retry');
        await page.getByRole('button', { name: 'Edit your venue rating', exact: true }).click();
        await page.getByLabel('Your venue rating', { exact: true }).press('End');
        await page.getByRole('button', { name: 'Save venue rating', exact: true }).click();
        await page.getByText('5.0 / 5 · 1 rating', { exact: true }).waitFor();
        await page.getByRole('button', { name: 'Claim this venue', exact: true }).click();
        const website = page.getByRole('textbox', { name: 'Official venue website', exact: true });
        await website.fill('https://venue.example.test');
        await page.getByRole('textbox', { name: 'Your role at the venue', exact: true }).fill('I manage the venue. Staff can reach the official office to confirm my role.');
        assert.equal(await page.getByRole('button', { name: 'Submit claim for review', exact: true }).isDisabled(), true);
        await page.getByRole('button', { name: 'I agree to the venue account change if approved', exact: true }).click();
        await page.getByRole('button', { name: 'Submit claim for review', exact: true }).click();
        await page.getByRole('alert').last().waitFor(); assert.equal(await website.inputValue(), 'https://venue.example.test');
        await page.getByRole('button', { name: 'Submit claim for review', exact: true }).click();
        await page.getByText('Your claim is pending staff review.', { exact: false }).waitFor();
        assert.equal(await page.getByText('Verified venue operator', { exact: true }).count(), 0);
        assert.equal(await page.getByRole('button', { name: /Create.*post|Publish.*update/ }).count(), 0);
        await page.screenshot({ path: resolve(out, `${name}-pending.png`), fullPage: true });
        await page.reload(); await page.getByText('Your claim is pending staff review.', { exact: false }).waitFor();
        await page.getByRole('button', { name: 'Withdraw venue claim', exact: true }).click();
        await page.getByText('Your claim was withdrawn.', { exact: true }).waitFor();
      } else {
        await page.getByRole('button', { name: 'Rate this venue', exact: true }).click();
        assert.equal(mutations.length, 0);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: true });
      console.log(JSON.stringify({ name, passed: true, mutations: mutations.length }));
    } catch (error) {
      await page.screenshot({ path: resolve(out, `${name}-failed.png`), fullPage: true });
      console.error(JSON.stringify({ name, errors, body: (await page.locator('body').innerText()).slice(-6000) })); throw error;
    } finally { await context.close(); }
  }
  // The staff screen uses the same exported application and account boundary.
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const errors = [], decisions = [];
    let status = 'pending', failReview = true;
    const claim = { id: 'vc_staff_fixture', user_id: 'venue-applicant-fixture', name: 'Venue Applicant', venue_path: path,
      venue_name: 'Fixture London River Room', website: 'https://venue.example.test', note: 'I manage this venue and can confirm my role through its official office.', conversion_consent: 'venue-account-v1', account_role: 'fan', current_owner_id: null, page_status: 'active' };
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const respond = (body, code = 200) => route.fulfill({ status: code, contentType: 'application/json', body: JSON.stringify(body) });
      try {
        if (url.pathname === '/api/me') return respond({ user: upkeepAdmin });
        if (url.pathname === '/api/admin/event-claims') return respond({ claims: [], nextCursor: null });
        if (url.pathname === '/api/admin/venue-claims') return respond({ claims: url.searchParams.get('status') === status ? [{ ...claim, status }] : [], nextCursor: null });
        if (url.pathname === '/api/admin/venue-claims/vc_staff_fixture/review') {
          assert.equal(req.headers()['x-pit-expected-account'], upkeepAdmin.id);
          const body = req.postDataJSON();
          if (failReview) { failReview = false; return respond({ error: 'Fixture unavailable', code: 'INTERNAL_ERROR' }, 503); }
          if (body.decision === 'approved') { assert.equal(body.authorityConfirmed, true); assert.equal(body.officialEvidenceConfirmed, true); assert.equal(body.conversionConfirmed, true); assert.equal(body.expectedOwnerId, null); assert.equal(body.method, 'official_contact'); assert.equal(body.reference, 'https://official.example.test/contact'); claim.current_owner_id = claim.user_id; claim.account_role = 'venue'; }
          if (body.decision === 'revoked') { assert.equal(body.revocationConfirmed, true); assert.equal(body.expectedOwnerId, claim.user_id); }
          decisions.push(body.decision); status = body.decision; return respond({ ok: true });
        }
        if (url.pathname === '/api/client-errors') { errors.push('Client crash report'); return respond({ ok: true }); }
        return respond(staffFixture(url, req.method()) || fixtureApiResponse(url.pathname, { member: true, method: req.method(), resolvedPath: url.searchParams.get('path') || '/feed' }));
      } catch (error) { errors.push(error.message); return respond({ error: 'Missing staff fixture', code: 'INTERNAL_ERROR' }, 500); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    const name = `venue-community-admin-${width}`;
    try {
      await page.goto(origin + '/feed', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Menu', exact: true }).click();
      await page.getByRole('button', { name: 'Moderation. Reports, members, and content', exact: true }).click();
      await page.getByRole('tab', { name: 'Requests', exact: true }).click();
      const approve = page.getByRole('button', { name: 'Approve verified venue operator', exact: true });
      await approve.waitFor(); assert.equal(await approve.isDisabled(), true);
      const note = page.getByRole('textbox', { name: 'Venue claim review reason', exact: true });
      await note.fill('Confirmed the applicant directly with the official venue office.');
      await page.getByRole('textbox', { name: 'Independent official evidence link', exact: true }).fill('https://official.example.test/contact');
      assert.equal(await approve.isDisabled(), true);
      await page.getByRole('button', { name: 'Confirm official evidence was checked', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm claimant authority was checked', exact: true }).click();
      await page.getByRole('button', { name: 'Confirm venue account conversion', exact: true }).click();
      await approve.click(); await page.getByRole('alert').last().waitFor();
      assert.equal(await note.inputValue(), 'Confirmed the applicant directly with the official venue office.');
      await approve.click(); await page.getByText('No pending claims on this page.', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Show approved venue claims', exact: true }).click();
      await page.getByRole('button', { name: 'Revoke venue operator access', exact: true }).waitFor();
      await page.screenshot({ path: resolve(out, `${name}-approved.png`), fullPage: true });
      await note.fill('Operator access ended after an independent check with the venue.');
      await page.getByRole('button', { name: 'Confirm removal of this venue access', exact: true }).click();
      await page.getByRole('button', { name: 'Revoke venue operator access', exact: true }).click();
      await page.getByText('No approved claims on this page.', { exact: true }).waitFor();
      assert.deepEqual(decisions, ['approved', 'revoked']); assert.deepEqual(errors, []);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      console.log(JSON.stringify({ name, passed: true, decisions }));
    } catch (error) {
      await page.screenshot({ path: resolve(out, `${name}-failed.png`), fullPage: true });
      console.error(JSON.stringify({ name, errors, body: (await page.locator('body').innerText()).slice(-6000) })); throw error;
    } finally { await context.close(); }
  }
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
