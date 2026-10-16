#!/usr/bin/env node
// Isolated loopback browser checks. Synthetic release graphs and real exported
// app cases are reported separately. No application server, database, real
// account, browser profile, external request or browser download is used.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fixtureApiResponse, navigationUser } from './verify-navigation-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const timeout = 20_000;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const digest = value => createHash('sha256').update(value).digest('hex');
const results = [];
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

function chromium() {
  if (process.env.PIT_PLAYWRIGHT_MODULE) return require(process.env.PIT_PLAYWRIGHT_MODULE).chromium;
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name).chromium; } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
  }
  throw new Error('Use an already installed Playwright via PIT_PLAYWRIGHT_MODULE; this harness never downloads dependencies.');
}

function syntheticRelease(parent, name) {
  const directory = join(parent, name);
  const put = (url, bytes) => { const path = join(directory, url); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); return url; };
  const module = (name, source) => put(`/_expo/static/js/web/${name}-${digest(source).slice(0, 32)}.js`, source);
  const imageBytes = Buffer.concat([png, Buffer.from(name)]);
  const image = put(`/assets/probe.${digest(imageBytes).slice(0, 32)}.png`, imageBytes);
  const nested = module('nested', `export const label = ${JSON.stringify(name + ': nested dependency')};`);
  const feature = module('feature', `import { label } from ${JSON.stringify(nested)}; export function mount() { document.getElementById('result').textContent=label; const image=new Image(); image.alt='Retained imported asset'; image.src=${JSON.stringify(image)}; document.body.append(image); }`);
  const entry = module('index', `document.getElementById('load').onclick=async()=>{try { (await import(${JSON.stringify(feature)})).mount(); } catch(error) { document.getElementById('result').textContent=error.message; }};`);
  put('/index.html', `<!doctype html><html><head><meta charset="utf-8"><title>Release ${name}</title></head><body><h1>Release ${name}</h1><button id="load">Load unseen feature</button><p id="result"></p><script type="module" src="${entry}"></script></body></html>`);
  return { directory, name, entry, feature, nested, image };
}

async function loopbackServer(serveFingerprintAsset, initialDirectory, initialArchive = null) {
  const state = { directory: initialDirectory, archive: initialArchive, requests: [], hits: [], fault: null };
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://fixture.invalid');
    state.requests.push({ path: url.pathname, method: request.method });
    if (!['GET', 'HEAD'].includes(request.method) || url.pathname.startsWith('/api/')) return void response.writeHead(405).end();
    if (state.fault?.(request, url, response)) return;
    try {
      const archive = state.archive && { lookup(path) { const found = state.archive.lookup(path); if (found) state.hits.push(path); return found; } };
      if (await serveFingerprintAsset(request, response, url.pathname, { distDir: state.directory, archive })) return;
      let path;
      try { path = resolve(state.directory, `.${decodeURIComponent(url.pathname)}`); } catch { return void response.writeHead(400).end(); }
      if (path !== state.directory && !path.startsWith(state.directory + sep)) return void response.writeHead(403).end();
      if (!existsSync(path) || !statSync(path).isFile()) {
        if (extname(url.pathname)) return void response.writeHead(404, { 'Cache-Control': 'no-store' }).end();
        path = join(state.directory, 'index.html');
      }
      const body = readFileSync(path);
      response.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch (error) { response.writeHead(500, { 'Cache-Control': 'no-store' }); response.end(String(error.message)); }
  });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  return { state, origin: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(done => { server.close(done); server.closeAllConnections(); }) };
}

async function isolatedContext(browser, origin, { member = false, savedDraft = null, width = 1280 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, isMobile: width < 620, hasTouch: width < 620, serviceWorkers: 'block', reducedMotion: 'reduce' });
  context.setDefaultTimeout(timeout); context.setDefaultNavigationTimeout(timeout);
  const record = { calls: [], reports: [], routeErrors: [], blockedExternal: [], documents: 0, pageErrors: [] };
  if (member) await context.addCookies([{ name: 'pit_session', value: 'synthetic-loopback-session', url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await context.addInitScript(({ origin, savedDraft }) => {
    if (location.origin !== origin || localStorage.getItem('release.fixture.seeded')) return;
    localStorage.setItem('release.fixture.seeded', '1');
    localStorage.setItem('pit_theme', 'stage');
    localStorage.setItem('release.fixture.canary', 'persisted canary');
    if (savedDraft) localStorage.setItem('pit.drafts', savedDraft);
  }, { origin, savedDraft });
  context.on('page', page => {
    page.setDefaultTimeout(timeout); page.setDefaultNavigationTimeout(timeout);
    page.on('pageerror', error => record.pageErrors.push(error.message));
  });
  context.on('request', request => { if (request.isNavigationRequest() && request.resourceType() === 'document' && request.url().startsWith(origin)) record.documents++; });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { record.blockedExternal.push(url.origin); return route.abort(); }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    try {
      record.calls.push({ path: url.pathname, method: request.method() });
      if (url.pathname === '/api/client-errors') { record.reports.push(request.postDataJSON()); return route.fulfill({ json: { ok: true } }); }
      const headers = await request.allHeaders();
      const signedIn = /(?:^|;\s*)pit_session=synthetic-loopback-session(?:;|$)/.test(headers.cookie || '');
      assert.equal(signedIn, member, 'Fixture authentication cookie changed.');
      let result;
      if (url.pathname === '/api/health') { assert.equal(request.method(), 'GET'); result = { ok: true, capabilities: { mediaPublishing: { photos: true, videos: false } } }; }
      else if (url.pathname === '/api/me/news-region') { assert.equal(request.method(), 'GET'); result = { newsRegion: { choice: 'everywhere', region: null, label: 'Everywhere', options: [] } }; }
      else result = fixtureApiResponse(url.pathname, { member: signedIn, method: request.method(), resolvedPath: url.searchParams.get('path') || new URL(request.headers().referer || origin).pathname });
      return route.fulfill({ json: result });
    } catch (error) { record.routeErrors.push(error.message); return route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } }); }
  });
  return { context, record };
}

async function checked(name, evidenceKind, action) {
  const started = Date.now();
  try { const evidence = await action(); const result = { name, evidenceKind, passed: true, elapsedMs: Date.now() - started, ...evidence }; results.push(result); console.log(JSON.stringify(result)); }
  catch (error) { const result = { name, evidenceKind, passed: false, elapsedMs: Date.now() - started, error: error.stack }; results.push(result); console.error(JSON.stringify(result)); }
}

async function storageReceipt(context, page) {
  return { cookie: (await context.cookies()).find(cookie => cookie.name === 'pit_session'), stored: await page.evaluate(() => ({ drafts: localStorage.getItem('pit.drafts'), canary: localStorage.getItem('release.fixture.canary'), theme: localStorage.getItem('pit_theme') })) };
}

async function screenshot(page, output, name) {
  if (!output) return null;
  const path = join(output, `${name}.png`); await page.screenshot({ path, fullPage: true }); return path;
}

async function publish(api, directory, archiveRoot, release, now) {
  const manifest = await api.buildWebAssetManifest(directory);
  const manifestPath = join(dirname(archiveRoot), `manifest-${digest(directory).slice(0, 12)}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest));
  const result = await api.prepareWebAssetArchive({ distDir: directory, manifestPath, archiveRoot, release: digest(release).slice(0, 40), now, freeBytes: 2 * 1024 ** 3 });
  assert.equal(result.ok, true, `Release ${release} failed retention preparation.`);
  return { ...result, manifest };
}

async function request(origin, path, method = 'GET') {
  const url = new URL(path, origin); assert.equal(url.origin, origin);
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  return { status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) };
}

async function syntheticRetention(browser, api, workspace) {
  const a = syntheticRelease(workspace, 'A'), b = syntheticRelease(workspace, 'B');
  const archiveRoot = join(workspace, 'synthetic-archive');
  const started = Date.now();
  const releaseA = await publish(api, a.directory, archiveRoot, 'synthetic-A', started);
  const server = await loopbackServer(api.serveFingerprintAsset, a.directory, await api.loadWebAssetArchiveResolver({ archiveRoot, now: started }));
  let context, record;
  try {
    ({ context, record } = await isolatedContext(browser, server.origin));
    const page = await context.newPage();
    await page.goto(server.origin); await page.getByRole('heading', { name: 'Release A', exact: true }).waitFor();
    assert.equal(server.state.requests.some(row => row.path === a.feature), false, 'The old tab must not preload its lazy feature.');
    const releaseB = await publish(api, b.directory, archiveRoot, 'synthetic-B', started + 1_000);
    server.state.directory = b.directory;
    server.state.archive = await api.loadWebAssetArchiveResolver({ archiveRoot, now: started + 1_000 });
    await page.getByRole('button', { name: 'Load unseen feature', exact: true }).click();
    await page.getByText('A: nested dependency', { exact: true }).waitFor();
    await page.waitForFunction(() => [...document.images].some(image => image.alt === 'Retained imported asset' && image.complete && image.naturalWidth === 1));
    for (const path of [a.feature, a.nested, a.image]) {
      assert.ok(server.state.hits.includes(path), `Old dependency was not served by the actual archive helper: ${path}`);
      const response = await request(server.origin, path);
      assert.equal(response.status, 200); assert.deepEqual(response.body, readFileSync(join(a.directory, path)));
      assert.match(response.headers['cache-control'], /immutable/);
      assert.match(response.headers['content-type'], path.endsWith('.js') ? /javascript/ : /image\/png/);
      const head = await request(server.origin, path, 'HEAD');
      assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.equal(Number(head.headers['content-length']), response.body.length);
    }
    const hitsBefore = server.state.hits.length;
    assert.deepEqual((await request(server.origin, b.entry)).body, readFileSync(join(b.directory, b.entry)));
    assert.equal(server.state.hits.length, hitsBefore, 'Current dist must be served before archive lookup.');
    assert.match((await request(server.origin, '/')).body.toString(), /Release B/);
    for (const path of [a.feature + '.map', a.feature + '%2eMAP', '/_expo/static/js/web/missing-' + 'f'.repeat(32) + '.js']) {
      const response = await request(server.origin, path);
      assert.equal(response.status, 404, `Private/missing asset unexpectedly served: ${path}`);
      assert.match(response.headers['cache-control'], /no-store/);
      assert.doesNotMatch(response.body.toString(), /<!doctype|<html/i, 'A missing asset must never become SPA HTML.');
    }
    await api.promoteWebAssetGraph({ archiveRoot, graphId: releaseB.graphId, now: started + 2_000 });
    server.state.archive = await api.loadWebAssetArchiveResolver({ archiveRoot, now: started + 8 * 86400_000 });
    const expired = await request(server.origin, a.feature);
    assert.equal(expired.status, 404); assert.match(expired.headers['cache-control'], /no-store/);
    assert.equal((await request(server.origin, b.entry)).status, 200, 'Expiry must not impair current assets.');
    await publish(api, a.directory, archiveRoot, 'synthetic-A-rollback', started + 8 * 86400_000 + 1_000);
    server.state.directory = a.directory;
    server.state.archive = await api.loadWebAssetArchiveResolver({ archiveRoot, now: started + 8 * 86400_000 + 1_000 });
    assert.match((await request(server.origin, '/')).body.toString(), /Release A/);
    assert.deepEqual((await request(server.origin, b.feature)).body, readFileSync(join(b.directory, b.feature)), 'The accepted B graph must survive rolling current HTML back to A.');
    assert.deepEqual(record.routeErrors, []); assert.deepEqual(record.pageErrors, []);
    return { graphs: [releaseA.graphId, releaseB.graphId], verified: ['unseen lazy module', 'nested module', 'imported PNG pixels', 'exact bytes', 'GET/HEAD', 'MIME/cache', 'current precedence', 'source-map denial', 'missing404', 'expiry404', 'rollback'], actualApp: false };
  } finally { try { await context?.close(); } finally { await server.close(); } }
}

async function actualOldRelease(browser, api, workspace, oldDist, currentDist, output) {
  const archiveRoot = join(workspace, 'actual-archive'), now = Date.now();
  const a = await publish(api, oldDist, archiveRoot, 'preserved-real-export-A', now);
  const server = await loopbackServer(api.serveFingerprintAsset, oldDist, await api.loadWebAssetArchiveResolver({ archiveRoot, now }));
  let context, record;
  try {
    ({ context, record } = await isolatedContext(browser, server.origin, { member: true }));
    const page = await context.newPage(); await page.goto(server.origin + '/discover');
    await page.getByRole('heading', { name: 'Discover', exact: true }).waitFor();
    const before = record.documents;
    const b = await publish(api, currentDist, archiveRoot, 'current-real-export-B', now + 1000);
    assert.notEqual(a.graphId, b.graphId, 'The optional actual A/B test requires distinct complete exports.');
    const oldNews = a.manifest.entries.find(entry => /\/NewsViews-[a-f0-9]+\.js$/.test(entry.url));
    assert.ok(oldNews && !b.manifest.entries.some(entry => entry.url === oldNews.url), 'This optional fixture pair must have distinct NewsViews assets to test old News retention.');
    server.state.directory = currentDist;
    server.state.archive = await api.loadWebAssetArchiveResolver({ archiveRoot, now: now + 1000 });
    await page.getByRole('button', { name: 'Menu', exact: true }).click();
    await page.getByRole('button', { name: 'News. New albums, singles and tour dates', exact: true }).click();
    await page.getByTestId('news-content-shell').waitFor();
    assert.equal(record.documents, before, 'Retained old-app navigation must not require a document reload.');
    assert.ok(server.state.hits.some(path => /\/NewsViews-[a-f0-9]+\.js$/.test(path)), 'The old app must actually fetch retained, previously unseen News code.');
    const image = await screenshot(page, output, 'actual-old-app-news-after-release-switch');
    const fresh = await context.newPage(); await fresh.goto(server.origin + '/discover');
    await fresh.getByRole('heading', { name: 'Discover', exact: true }).waitFor();
    assert.deepEqual(record.routeErrors, []); assert.deepEqual(record.pageErrors, []);
    return { graphs: [a.graphId, b.graphId], oldExport: oldDist, currentExport: currentDist, archiveHits: [...new Set(server.state.hits)], screenshot: image, actualApp: true, authentication: 'synthetic cookie-backed API fixture, not server authentication' };
  } finally { try { await context?.close(); } finally { await server.close(); } }
}

async function actualRecovery(browser, api, currentDist, output, mode, width = 1280) {
  const suffix = width < 620 ? `-${width}` : '';
  const server = await loopbackServer(api.serveFingerprintAsset, currentDist);
  let faultEnabled = true;
  server.state.fault = (request, url, response) => {
    if (!faultEnabled || !/\/SearchScreen-[a-f0-9]+\.js$/.test(url.pathname)) return false;
    response.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : '{"error":"synthetic expired release chunk"}'); return true;
  };
  let context, record;
  try {
    ({ context, record } = await isolatedContext(browser, server.origin, { member: true, width }));
    const page = await context.newPage(); await page.goto(server.origin + '/feed');
    await page.getByText("Your life's musical journey", { exact: true }).waitFor();
    const draftText = `Release recovery ${mode}${suffix} saved draft`;
    await page.getByLabel('Make a post', { exact: true }).click();
    const editor = page.getByPlaceholder('Write about music, a show, or what you plan to see next...', { exact: true });
    await editor.fill(draftText);
    await page.waitForFunction(({ text, ownerId }) => JSON.parse(localStorage.getItem('pit.drafts') || '[]').some(draft => draft.ownerId === ownerId && draft.review === text), { text: draftText, ownerId: navigationUser.id });
    await page.getByText('Save draft & close', { exact: true }).click();
    await editor.waitFor({ state: 'hidden' });
    const saved = await storageReceipt(context, page);
    assert.ok(saved.stored.drafts?.includes(draftText));
    await page.evaluate(() => { window.releaseRecoveryMemoryCanary = { text: 'unsaved heap-only canary', attachment: new Blob(['in-memory attachment'], { type: 'text/plain' }) }; });
    const initialDocuments = record.documents;
    await page.getByRole('tab', { name: 'Search', exact: true }).click();
    await page.getByRole('heading', { name: 'This screen needs a fresh start', exact: true }).waitFor();
    assert.equal(record.documents, initialDocuments, 'An exhausted import must not automatically reload the document.');
    const card = await screenshot(page, output, `actual-recovery-${mode}${suffix}-card`);
    if (mode === 'saved-draft-reload') {
      let confirmation;
      page.once('dialog', async dialog => { confirmation = dialog.message(); faultEnabled = false; await dialog.accept(); });
      await page.getByTestId('recovery-save-reload').click();
      await page.getByLabel('Search Mshpit', { exact: true }).waitFor();
      assert.equal(record.documents, initialDocuments + 1, 'Explicit recovery should replace exactly one document.');
      assert.match(confirmation || '', /draft|saved/i);
      assert.match(confirmation || '', /unsaved|edits|files/i, 'Recovery confirmation must disclose unsupported in-memory state.');
      assert.deepEqual(await storageReceipt(context, page), saved, 'Recovery must preserve login cookie and persisted draft/canary/theme bytes.');
      assert.ok(record.calls.filter(call => call.path === '/api/me').length >= 2, 'Reload must re-establish the fixture member through /api/me.');
      await page.getByRole('tab', { name: 'Feed', exact: true }).click();
      await page.getByLabel('Make a post', { exact: true }).click();
      await page.getByRole('button', { name: `Resume ${draftText}`, exact: true }).click();
      assert.equal(await editor.inputValue(), draftText, 'The real composer must resume the saved text after recovery.');
      const restored = await screenshot(page, output, `actual-recovery-restored-draft${suffix}`);
      assert.deepEqual(record.routeErrors, []);
      assert.deepEqual(record.pageErrors, [], 'The actual app must not have unrelated uncaught failures.');
      assert.deepEqual(record.reports, [], 'Recovery must not emit unrelated app crash reports.');
      return { screenshot: card, restoredScreenshot: restored, width, documentReloads: 1, draftResumed: true, cookiePreserved: true, note: 'Actual exported UI with an injected 404; not a distinct-release transition.' };
    }
    if (mode === 'storage-denied') {
      await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        window.releaseRestoreStorage = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function () { throw new DOMException('Fixture storage unavailable', 'QuotaExceededError'); };
      });
      let confirmations = 0; page.on('dialog', async dialog => { confirmations++; await dialog.dismiss(); });
      await page.getByTestId('recovery-save-reload').click();
      await page.getByTestId('recovery-status').waitFor();
      assert.match(await page.getByTestId('recovery-status').innerText(), /cannot confirm saved drafts/);
      assert.equal(confirmations, 0, 'Known failed preservation must block before asking permission to reload.');
      assert.equal(record.documents, initialDocuments);
      assert.deepEqual(await storageReceipt(context, page), saved);
      assert.equal(await page.evaluate(() => window.releaseRecoveryMemoryCanary.text), 'unsaved heap-only canary');
      await screenshot(page, output, 'actual-recovery-storage-denied');
      await page.evaluate(() => window.releaseRestoreStorage());
    } else {
      let confirmation;
      page.once('dialog', async dialog => { confirmation = dialog.message(); await dialog.dismiss(); });
      await page.getByTestId('recovery-save-reload').click();
      assert.match(confirmation || '', /unsaved|edits|files/i);
      assert.equal(record.documents, initialDocuments, 'Cancel must preserve the old document.');
      await page.getByTestId('recovery-stay').click();
      assert.equal(await page.evaluate(() => window.releaseRecoveryMemoryCanary.text), 'unsaved heap-only canary');
      assert.deepEqual(await storageReceipt(context, page), saved);
      const popupPromise = context.waitForEvent('page');
      await page.getByTestId('recovery-open-tab').click();
      const fresh = await popupPromise; await fresh.waitForLoadState('domcontentloaded');
      await fresh.getByRole('link', { name: 'Browse concerts', exact: true }).waitFor();
      assert.equal(new URL(fresh.url()).origin, server.origin);
      assert.equal(await fresh.evaluate(() => window.opener), null, 'Fresh tab must not inherit an opener capability.');
      assert.equal(await page.evaluate(() => window.releaseRecoveryMemoryCanary.text), 'unsaved heap-only canary');
      assert.equal(await fresh.evaluate(() => window.releaseRecoveryMemoryCanary), undefined, 'A new tab must not claim to restore heap-only work.');
      assert.deepEqual(await storageReceipt(context, fresh), saved);
      await fresh.goto(server.origin + '/feed');
      await fresh.getByText("Your life's musical journey", { exact: true }).waitFor();
      await screenshot(page, output, 'actual-recovery-old-tab-preserved');
    }
    assert.deepEqual(record.routeErrors, []);
    assert.deepEqual(record.pageErrors, [], 'The actual app must not have unrelated uncaught failures.');
    assert.deepEqual(record.reports, [], 'Recovery must not emit unrelated app crash reports.');
    return { screenshot: card, documentReloads: 0, oldHeapPreserved: true, persistedDraftPreserved: true, note: 'Real recovery UI with a synthetic heap-only canary; live File/composer registration is covered by component tests, not claimed here.' };
  } finally { try { await context?.close(); } finally { await server.close(); } }
}

export async function main() {
  const output = process.env.PIT_WEB_RELEASE_RECOVERY_OUTPUT ? resolve(process.env.PIT_WEB_RELEASE_RECOVERY_OUTPUT) : null;
  if (output) mkdirSync(output, { recursive: true });
  const workspace = mkdtempSync(join(tmpdir(), 'mshpit-web-release-recovery-'));
  // Only this invocation's freshly created, verified temp child is removable.
  // Receipts/screenshots live separately in the caller-selected output folder.
  assert.equal(dirname(resolve(workspace)), resolve(tmpdir()));
  assert.ok(basename(workspace).startsWith('mshpit-web-release-recovery-'));
  process.once('exit', () => { rmSync(workspace, { recursive: true, force: true }); });
  const currentDist = resolve(root, process.env.PIT_WEB_RELEASE_RECOVERY_DIST || 'dist');
  const oldDist = process.env.PIT_PREVIOUS_WEB_DIST ? resolve(process.env.PIT_PREVIOUS_WEB_DIST) : null;
  const api = { ...await import('../server/webAssetManifest.js'), ...await import('../server/webAssetArchive.js'), ...await import('../server/webAssetServing.js') };
  const currentGraph = existsSync(join(currentDist, 'index.html')) ? api.buildWebAssetManifest(currentDist).graphId : null;
  const browser = await chromium().launch({ headless: true, ...(process.env.PIT_BROWSER_EXECUTABLE ? { executablePath: process.env.PIT_BROWSER_EXECUTABLE } : {}) });
  const browserVersion = browser.version();
  try {
    if (!process.argv.includes('--app-only')) await checked('complete-graph-retention-A-to-B', 'synthetic-release-graphs-with-production-serving-helper', () => syntheticRetention(browser, api, workspace));
    if (!process.argv.includes('--retention-only')) {
      assert.ok(existsSync(join(currentDist, 'index.html')), 'Export the current web build before running actual-app cases.');
      for (const mode of ['saved-draft-reload', 'warn-stay-fresh-tab', 'storage-denied']) await checked(mode, 'actual-exported-app-with-loopback-fault-and-API-fixtures', () => actualRecovery(browser, api, currentDist, output, mode));
      await checked('mobile-saved-draft-reload', 'actual-exported-app-with-loopback-fault-and-API-fixtures', () => actualRecovery(browser, api, currentDist, output, 'saved-draft-reload', 390));
      if (oldDist) await checked('real-old-app-News-after-release-switch', 'two-distinct-actual-exports-with-production-serving-helper', () => actualOldRelease(browser, api, workspace, oldDist, currentDist, output));
    }
  } finally { await browser.close(); }
  const receipt = { testedAt: new Date().toISOString(), nodeVersion: process.version, browserVersion, total: results.length, passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length, results, workspace, currentDist, currentGraph, previousExportProvided: !!oldDist, network: 'loopback only; all API responses synthetic; external requests blocked', limitations: ['No real server authentication or production deployment.', 'Synthetic graph cases are not an actual Expo release.', 'UI recovery cases inject a chunk404 into the actual current export.', 'Optional two-export check is reported separately.', 'Fresh-tab/keep-tab case uses a heap canary, not an actual unpersisted user attachment.'] };
  if (output) writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
  if (receipt.failed) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.stack); process.exitCode = 1; });


