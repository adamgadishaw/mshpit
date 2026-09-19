#!/usr/bin/env node
// Isolated current-export moderator journey. No real accounts, Instagram
// access, holds, verification decisions, database or production requests.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { localServer } from './verify-artist-account-browser.mjs';
import { fixtureApiResponse, navigationArtist, navigationUser } from './verify-navigation-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, '.tmp', 'artist-identity-moderation-browser');
const reason = 'Viewed the official longstanding artist account and matching live Story code.';
const officialLabel = "I confirmed this is the artist's established official account or website, not a look-alike";
const ownershipLabel = 'I confirmed this member controls or is authorized to represent the artist';
const releaseLabel = 'I independently resolved the identity conflict and authorize releasing this hold';

async function scenario(browser, origin, width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: 'block' });
  const user = { ...navigationUser, role: 'admin' };
  const challenge = { id: 'av_review_fixture', method: 'instagram_story', artistName: navigationArtist.name, instagramHandle: 'fixture.artist', code: 'MSHPIT-ABCD-EF01-2345-6789', status: 'submitted', expiresAt: Date.now() + 86_400_000 };
  const request = { id: 'ar_review_fixture', kind: 'verification', userId: 'artist-owner-fixture', artistName: navigationArtist.name, artistKey: navigationArtist.key, note: 'Official Instagram Story submitted by the artist.', status: 'pending', identityReview: { held: true, status: 'pending', reasons: ['similar_artist_identity'], matches: [] }, proof: { method: 'instagram_story', instagramHandle: 'fixture.artist', storyUrl: 'https://www.instagram.com/stories/fixture.artist/123456/', challenge, reviewStatus: 'pending' } };
  const state = { requests: [request], failApprove: true, failHold: true, writes: [], errors: [], reports: [], closing: false };
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  await page.addInitScript(member => { localStorage.setItem('pit_theme', 'stage'); localStorage.setItem('pit.session', JSON.stringify(member)); localStorage.setItem('pit.users', JSON.stringify([member])); }, user);
  page.on('pageerror', error => state.errors.push(error.message));
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    try {
      if (url.origin !== origin) return await route.abort();
      if (!url.pathname.startsWith('/api/')) return await route.continue();
      const method = req.method(), body = method === 'GET' ? null : req.postDataJSON();
      if (url.pathname === '/api/client-errors') { state.reports.push(body); return await json({ ok: true }); }
      if (url.pathname === '/api/me') return await json({ user });
      if (url.pathname === '/api/admin/artist-requests') return await json({ requests: state.requests });
      if (url.pathname === '/api/admin/members') return await json({ users: [user, { id: request.userId, name: 'Artist fixture', handle: 'artistfixture', role: 'artist' }], total: 2, banned: 0, verified: 0, regions: [] });
      if (url.pathname === '/api/admin/moderation') return await json({ reports: [], recentActions: [], summary: { open: 0, actioned: 0, dismissed: 0, totalRecent: 0, byType: {} } });
      if (url.pathname === '/api/admin/health' || url.pathname === '/api/health') return await json({ ok: true });
      if (url.pathname === '/api/admin/errors') return await json({ groups: [], counts: {}, total: 0 });
      if (url.pathname === '/api/admin/badges') return await json({ badges: [] });
      if (url.pathname === '/api/moderation/artist-death-watch') return await json({ candidates: [], counts: { pending: 0, dismissed: 0, memorialized: 0 }, settings: {} });
      if (url.pathname === '/api/admin/artist-identities') return await json({ artists: [{ ...navigationArtist, ownerId: request.userId, identityReview: { held: true, status: 'pending', reasons: [], matches: [] } }] });
      if (url.pathname === `/api/admin/artist-requests/${request.id}/approve`) {
        assert.equal(method, 'POST'); assert.equal(req.headers()['x-pit-expected-account'], user.id);
        assert.equal(body.method, 'instagram_story'); assert.equal(body.reason, reason);
        for (const key of ['officialAccountConfirmed', 'ownershipConfirmed', 'identityReviewConfirmed', 'liveCodeObserved']) assert.equal(body[key], true);
        assert.equal(body.observedCode, challenge.code); assert.ok(body.observedAt > 0 && body.observedAt < challenge.expiresAt);
        state.writes.push({ path: url.pathname, body });
        if (state.failApprove) return await json({ error: 'Review save failed; please retry.', code: 'PROVIDER_UNAVAILABLE' }, 503);
        state.requests = []; return await json({ ok: true });
      }
      if (url.pathname === `/api/admin/artists/${navigationArtist.key}/identity-review`) {
        assert.equal(method, 'POST'); assert.equal(req.headers()['x-pit-expected-account'], user.id); assert.equal(body.reason, reason);
        state.writes.push({ path: url.pathname, body });
        if (body.action === 'hold' && state.failHold) return await json({ error: 'The identity hold did not save. Please retry.', code: 'PROVIDER_UNAVAILABLE' }, 503);
        if (body.action === 'release') {
          for (const key of ['identityReviewConfirmed', 'officialAccountConfirmed', 'ownershipConfirmed']) assert.equal(body[key], true);
          assert.equal(body.reviewedUrl, 'https://www.instagram.com/fixture.artist/');
        } else assert.equal(body.action, 'hold');
        return await json({ ok: true, identityReview: { held: body.action === 'hold', status: body.action === 'hold' ? 'pending' : 'approved', reasons: [], matches: [] } });
      }
      return await json(fixtureApiResponse(url.pathname, { member: true, method, resolvedPath: url.searchParams.get('path') || undefined }));
    } catch (error) { if (!state.closing) { state.errors.push(error.message); await route.abort().catch(() => {}); } }
  });
  const shot = suffix => page.screenshot({ path: join(shots, `moderation-${width}-${suffix}.png`) });
  try {
    await page.goto(origin + '/you', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Moderation', exact: true }).click();
    await page.getByRole('tab', { name: /^Requests/ }).click();
    const grant = () => page.getByRole('button', { name: 'Grant artist check', exact: true });
    await grant().waitFor(); assert.equal(await grant().isDisabled(), true);
    await page.getByLabel(`Artist review reason for ${navigationArtist.name}`, { exact: true }).fill(reason);
    for (const label of [officialLabel, ownershipLabel, releaseLabel]) await page.getByRole('checkbox', { name: label, exact: true }).click();
    assert.equal(await grant().isDisabled(), true);
    await page.getByLabel(`Live Story code observed for ${navigationArtist.name}`, { exact: true }).fill(challenge.code);
    await page.getByRole('checkbox', { name: 'I directly viewed the live Story with this artist name and matching code before expiry', exact: true }).click();
    await shot('proof-review');
    await grant().click();
    await page.getByText(/That request was not approved\. Nothing changed/).waitFor();
    assert.equal(await page.getByLabel(`Artist review reason for ${navigationArtist.name}`, { exact: true }).inputValue(), reason);
    assert.equal(await page.getByLabel(`Live Story code observed for ${navigationArtist.name}`, { exact: true }).inputValue(), challenge.code);
    state.failApprove = false; await grant().click();
    await page.getByText('No pending requests.', { exact: true }).waitFor();
    assert.equal(state.writes.length, 2);
    await page.getByLabel('Artist identity safety search', { exact: true }).fill(navigationArtist.name);
    await page.getByRole('button', { name: 'Find artist page to review', exact: true }).click();
    await page.getByRole('button', { name: `Review identity of ${navigationArtist.name}`, exact: true }).click();
    await page.getByLabel(`Artist review reason for ${navigationArtist.name}`, { exact: true }).fill(reason);
    const hold = () => page.getByRole('button', { name: 'Hold this artist page', exact: true });
    const release = () => page.getByRole('button', { name: 'Release identity hold only', exact: true });
    await hold().click();
    await page.getByText(/A music or ticket provider is temporarily unavailable\. Your evidence stays below so you can retry/).waitFor();
    assert.equal(await page.getByLabel(`Artist review reason for ${navigationArtist.name}`, { exact: true }).inputValue(), reason);
    state.failHold = false; await hold().click();
    await page.getByText(/Identity hold applied\./).waitFor();
    assert.equal(await release().isDisabled(), true);
    for (const label of [officialLabel, ownershipLabel, releaseLabel]) await page.getByRole('checkbox', { name: label, exact: true }).click();
    assert.equal(await release().isDisabled(), true);
    await page.getByLabel(`Official evidence URL reviewed for ${navigationArtist.name}`, { exact: true }).fill('https://www.instagram.com/fixture.artist/');
    await shot('hold-release');
    await release().click();
    await page.getByText(/Identity hold released\. No artist check was granted/).waitFor();
    assert.equal(state.writes.length, 5);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(state.reports, []); assert.deepEqual(state.errors, []);
    console.log(JSON.stringify({ name: `artist-identity-moderation-${width}`, passed: true, simulatedWrites: state.writes.length }));
  } catch (error) { await shot('failed'); console.error(JSON.stringify({ error: error.message, errors: state.errors, reports: state.reports, body: (await page.locator('body').innerText()).slice(-7000) })); throw error; }
  finally { state.closing = true; await context.close(); }
}

export async function main() {
  const require = createRequire(import.meta.url);
  const { chromium } = require(process.env.PIT_PLAYWRIGHT_MODULE || 'playwright');
  mkdirSync(shots, { recursive: true }); const { server, origin } = await localServer(); let browser;
  try { browser = await chromium.launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
    for (const width of [375, 1280]) await scenario(browser, origin, width);
    console.log(JSON.stringify({ passed: 2, failed: 0, network: 'isolated fixtures only', screenshots: shots }));
  } finally { await browser?.close(); await new Promise(done => server.close(done)); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.message); process.exitCode = 1; });
