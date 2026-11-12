// Actual app-saved drafts across both composer entry points. Loopback fixtures only.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { localServer } from './verify-artist-account-browser.mjs';
import { fixtureApiResponse, navigationUser, navigationArtist } from './verify-navigation-browser.mjs';

const { chromium } = createRequire(import.meta.url)(process.env.PIT_PLAYWRIGHT_MODULE || 'playwright');
const output = resolve('.tmp/creator-draft-browser'); mkdirSync(output, { recursive: true });
const baseline = process.argv.includes('--reproduce');
const { server, origin } = await localServer();
const browser = await chromium.launch({ headless: true, executablePath: process.env.PIT_BROWSER_EXECUTABLE || undefined });
const results = [];
try {
  for (const width of [375, 1280]) for (const kind of ['ordinary', 'creator']) for (const entry of ['ordinary', 'creator']) {
    const name = `${kind}-via-${entry}-${width}`;
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    const actor = { ...navigationUser, role: 'artist', artistName: navigationArtist.name };
    const entity = { entityType: 'artist', entityKey: navigationArtist.name.toLowerCase(), name: navigationArtist.name };
    const text = `Saved ${kind} draft: the encore and the journey home. 🎶`;
    const title = 'Saved creator update';
    const state = { writes: [], errors: [], fail: true };
    page.on('pageerror', error => state.errors.push(error.message));
    await page.addInitScript(value => {
      localStorage.setItem('pit_theme', 'stage'); localStorage.setItem('pit.session', JSON.stringify(value)); localStorage.setItem('pit.users', JSON.stringify([value]));
    }, actor);
    await context.route('**/*', async route => {
      const req = route.request(), url = new URL(req.url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (url.pathname === '/api/me') return json({ user: actor });
      if (url.pathname === '/api/health') return json({ ok: true });
      if (url.pathname === '/api/me/creator-entities') return json({ entities: [entity] });
      if (url.pathname === '/api/artist-account') return json({ ok: true, user: actor, artist: navigationArtist, profile: { ownerId: actor.id, feedEnabled: true }, verification: { status: 'not_requested' }, identityReview: { held: false, status: 'clear' } });
      if (/^\/api\/artists\/[^/]+\/profile$/.test(url.pathname)) return json({ artist: navigationArtist, profile: { ownerId: actor.id, feedEnabled: true }, posts: [], legacyProfile: false });
      if (url.pathname.startsWith('/api/creators/')) return json({ posts: [] });
      if (url.pathname === '/api/posts' && req.method() === 'POST') {
        const body = req.postDataJSON(); state.writes.push(body);
        assert.equal(req.headers()['x-pit-expected-account'], actor.id);
        if (state.fail) return json({ error: 'Fixture failed save', code: 'VALIDATION_FAILED' }, 400);
        const post = { ...body, id: 'p_restored_fixture', userId: actor.id, user: actor, at: Date.now(), likes: 0, comments: 0 };
        return json({ post, id: post.id });
      }
      return json(fixtureApiResponse(url.pathname, { member: true, method: req.method(), resolvedPath: url.searchParams.get('path') || undefined }));
    });
    const enter = async mode => {
      await page.goto(origin + '/you', { waitUntil: 'domcontentloaded' });
      if (mode === 'creator') {
        await page.getByRole('button', { name: 'Manage profile', exact: true }).last().click();
        await page.getByRole('button', { name: 'Post to followers', exact: true }).first().click();
      } else await page.getByLabel('Make a post', { exact: true }).last().click();
    };
    const input = () => page.getByPlaceholder(kind === 'creator' ? 'Add details for your followers (optional)...' : 'Write about music, a show, or what you plan to see next...', { exact: true });
    const post = page.getByRole('button', { name: 'Post', exact: true }).first();
    try {
      await enter(kind);
      await input().waitFor(); assert.equal(await post.isDisabled(), true);
      if (kind === 'creator') await page.getByLabel('Title', { exact: true }).fill(title);
      await input().fill(text);
      await post.waitFor();
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('pit.drafts') || '[]').some(d => d.review.includes('the journey home')));
      const saved = await page.evaluate(expected => JSON.parse(localStorage.getItem('pit.drafts')).find(d => d.review === expected), text);
      assert.equal(saved.postType, 'status'); assert.equal(!!saved.creatorUpdate, kind === 'creator');
      assert.ok(saved.id); assert.ok(saved.submissionId);
      await enter(entry);
      await page.getByRole('button', { name: `Resume ${kind === 'creator' ? title : text}`, exact: true }).click();
      assert.equal(await input().inputValue(), text);
      if (kind === 'creator') await page.getByLabel('Title', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Title', { exact: true }).count(), kind === 'creator' ? 1 : 0);
      if (kind === 'creator') await page.waitForFunction(() => [...document.querySelectorAll('[role=button]')].some(b => b.textContent === 'Post' && b.getAttribute('aria-disabled') !== 'true'));
      await input().fill(text + ' Still intact.');
      if (baseline && kind === 'ordinary' && entry === 'creator') {
        assert.equal(await post.isDisabled(), true, 'Reproduce immutable entry-mode validation after ordinary draft restore');
        results.push({ name, reproduced: true, textPreserved: true });
      } else {
        assert.equal(await post.isEnabled(), true, 'Restored intent must control validation');
        await post.click(); await page.getByRole('alert').filter({ hasText: /still here/ }).waitFor();
        assert.equal(await input().inputValue(), text + ' Still intact.');
        assert.equal(state.writes.length, 1); assert.equal(state.writes[0].clientMutationId, saved.submissionId);
        state.fail = false; await post.click(); await input().waitFor({ state: 'hidden' });
        assert.equal(state.writes.length, 2);
        for (const body of state.writes) {
          assert.equal(body.kind, 'status'); assert.equal(body.review, text + ' Still intact.');
          assert.equal(!!body.creatorUpdate, kind === 'creator'); assert.equal(body.clientMutationId, saved.submissionId);
          if (kind === 'creator') assert.deepEqual(body.creatorUpdate, saved.creatorUpdate);
        }
        results.push({ name, passed: true, retainedSubmission: true });
      }
      assert.deepEqual(state.errors, []);
      await page.screenshot({ path: join(output, name + (baseline ? '-baseline' : '') + '.png') });
      console.log(JSON.stringify(results.at(-1)));
    } catch (error) {
      await page.screenshot({ path: join(output, name + '-failed.png') });
      writeFileSync(join(output, name + '-failure.json'), JSON.stringify({ error: error.message, state, body: await page.locator('body').innerText() }, null, 2));
      throw error;
    } finally { await context.close(); }
  }
  writeFileSync(join(output, baseline ? 'baseline-results.json' : 'results.json'), JSON.stringify(results, null, 2));
} finally { await browser.close(); await new Promise(done => server.close(done)); }
