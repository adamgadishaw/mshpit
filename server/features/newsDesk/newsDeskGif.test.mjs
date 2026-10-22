import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after } from 'node:test';
import sharp from 'sharp';
import { inspectImageBytes } from '../../imageInspection.js';
import { MEDIA_PHOTO_SOURCE_MAX_BYTES } from '../../../src/domain/mediaUploadPolicy.mjs';
import { newsStoryPostDocument } from '../seo/publicDocumentProjection.js';
import { renderPublicDocumentMain, renderPublicDocumentHead } from '../seo/publicDocumentRenderer.js';

// Disposable database and RAM objects only; no real accounts or storage services.
const directory = mkdtempSync(join(tmpdir(), 'pit-news-gif-'));
Object.assign(process.env, { PIT_DATA_DIR: directory, PIT_ALLOW_EMPTY_DB_BOOTSTRAP: 'true', NODE_ENV: 'test',
  NEWSROOM_BROWSER_SESSIONS_ENABLED: 'true', MEDIA_ENDPOINT: 'https://objects.example.test/s3',
  MEDIA_BUCKET: 'gif-public', MEDIA_SOURCE_BUCKET: 'gif-private', MEDIA_REGION: 'auto',
  MEDIA_ACCESS_KEY_ID: 'synthetic', MEDIA_SECRET_ACCESS_KEY: 'synthetic',
  MEDIA_PUBLIC_BASE_URL: 'https://media.example.test', NEWS_DESK_ACCOUNT_ID: 'gif_publisher' });
const { db, q } = await import('../../db.js');
const { createSession, createNewsroomSession } = await import('../../auth.js');
const { readAuthorizedRequest } = await import('../../requestAuthorization.js');
const { createMediaAsset, finalizeMediaAsset, ownedMediaAsset } = await import('../../mediaAssets.js');
const { ApiError } = await import('../../errors.js');
const { createNewsDeskEditor } = await import('./newsDeskEditor.js');
const { newsDeskEditorRoutes } = await import('./newsDeskEditorRoutes.js');
const { createNewsDeskReader } = await import('./newsDeskService.js');
const { newsroomSessionRoutes } = await import('../newsroomSessions/newsroomSessionRoutes.js');
after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

function user(id, role = 'admin') {
  q.insertUser.run(id, `${id}@example.test`, id, id, 'unused-test-hash', role, '', null, null, 'GI', '#123456', Date.now());
  db.prepare("UPDATE users SET email_verified_at=?,age_band='18_plus',onboarding_version=1 WHERE id=?").run(Date.now(), id);
  return q.userById.get(id);
}
user('gif_publisher', 'moderator');
// Same tiny, alternating black/white GIF fixture used by imageProcessor.test.mjs.
// This is a codec test vector, not a replacement for the owner's approved artwork.
function gif(frames = 2) {
  return Buffer.concat([Buffer.from('47494638396101000100800000000000ffffff', 'hex'),
    ...Array.from({ length: frames }, (_, i) => Buffer.from(`21f904000a0000002c0000000001000100000201${i % 2 ? '44' : '4c'}00`, 'hex')),
    Buffer.from([0x3b])]);
}
function storage() {
  const objects = new Map();
  const fetchImpl = async (url, options = {}) => {
    assert.equal(new URL(url).origin, 'https://objects.example.test');
    const key = decodeURIComponent(new URL(url).pathname.slice('/s3/'.length));
    const method = options.method || 'GET';
    if (method === 'PUT') {
      if (objects.has(key)) return new Response(null, { status: 412 });
      const bytes = Buffer.from(options.body), type = new Headers(options.headers).get('content-type');
      const etag = '"' + createHash('sha256').update(bytes).digest('hex') + '"';
      objects.set(key, { bytes, type, etag });
      return new Response(null, { status: 200, headers: { etag } });
    }
    const object = objects.get(key);
    if (!object) return new Response(null, { status: 404 });
    const headers = { 'content-length': String(object.bytes.length), 'content-type': object.type, etag: object.etag };
    if (method === 'HEAD') return new Response(null, { status: 200, headers });
    assert.equal(method, 'GET');
    if (new Headers(options.headers).get('if-match') !== object.etag) return new Response(null, { status: 412 });
    return new Response(object.bytes, { status: 200, headers });
  };
  return { objects, fetchImpl };
}
let sequence = 0;
function fixture(mode) {
  const owner = user('gif_' + mode + '_' + (++sequence)), session = mode === 'remembered' ? createNewsroomSession(owner.id) : createSession(owner.id);
  const ram = storage();
  const editor = createNewsDeskEditor({ database: db, summarize: null, fetchArticle: async () => { throw Error('No external fetch'); } });
  const media = {
    'POST /api/media/assets': ctx => createMediaAsset(db, { ownerId: ctx.assertCurrentSession().id, body: ctx.body }),
    'POST /api/media/assets/:id/finalize': ctx => finalizeMediaAsset(db, { ownerId: ctx.assertCurrentSession().id,
      assetId: ctx.params.id, body: ctx.body, fetchImpl: ram.fetchImpl }),
    'GET /api/media/assets/:id': ctx => ({ asset: ownedMediaAsset(db, { ownerId: ctx.assertCurrentSession().id, assetId: ctx.params.id }) }),
  };
  const remembered = newsroomSessionRoutes({ database: db, editor, ApiError, requireEditor: ctx => ctx.assertCurrentSession(),
    verifyPassword: async () => false, atomicWrite: fn => { db.exec('BEGIN IMMEDIATE'); try { const value = fn(); db.exec('COMMIT'); return value; } catch (e) { db.exec('ROLLBACK'); throw e; } },
    rateLimit() {}, mediaRoutes: () => media });
  const normal = newsDeskEditorRoutes({ database: db, editor, ApiError, requireAdmin: ctx => ctx.assertCurrentSession(), rateLimit() {} });
  const routes = mode === 'remembered' ? remembered : { ...media, ...normal };
  const prefix = mode === 'remembered' ? '/api/newsroom-session' : '/api/moderation/news-desk/editor';
  async function call(route, body = {}, id) {
    const [method, pattern] = route.split(' '), pathname = pattern.replace(':id', id || '');
    const ctx = await readAuthorizedRequest({ token: session.token, method, pathname,
      sessionScope: mode === 'remembered' ? 'newsroom' : 'full', readBody: async () => body });
    return routes[route]({ ...ctx, body, token: session.token, params: { id }, ip: 'synthetic-gif', setHeader() {} });
  }
  const mediaPath = mode === 'remembered' ? prefix + '/media' : '/api/media/assets';
  const draftPath = prefix + '/drafts' + (mode === 'remembered' ? '' : '/self-written');
  return { owner, editor, ram, call, mediaPath, draftPath, prefix };
}

for (const mode of ['normal', 'remembered']) test(`${mode} Newsroom preserves animated GIF through upload, copy, publication projection and metadata`, async () => {
  const f = fixture(mode), source = gif();
  const input = { clientAssetId: 'gif-roundtrip-source', contentType: 'image/gif', fileSize: source.length, name: 'animation.gif',
    ...(mode === 'normal' ? { purpose: 'post' } : {}) };
  const created = await f.call('POST ' + f.mediaPath, input);
  const replay = await f.call('POST ' + f.mediaPath, input);
  assert.equal(replay.asset.id, created.asset.id, 'same upload intent reuses its asset');
  await assert.rejects(f.call('POST ' + f.mediaPath, { ...input, fileSize: source.length + 1 }), error => error.status === 409,
    'changing the bytes declaration cannot reuse an upload intent');
  assert.equal(created.upload.storageScope, 'private');
  assert.equal(created.upload.publicUrl, null);
  assert.equal((await f.ram.fetchImpl(created.upload.uploadUrl, { method: 'PUT', headers: created.upload.requiredHeaders, body: source })).status, 200);
  const finalize = { orientation: 0, altText: 'Alternating codec test image', ...(mode === 'normal' ? { deliveryMode: 'server' } : {}) };
  const result = await f.call('POST ' + f.mediaPath + '/:id/finalize', finalize, created.asset.id);
  assert.equal(result.asset.status, 'ready');
  const stored = db.prepare('SELECT object_key,mime_type FROM media_variants WHERE asset_id=? AND status=\'verified\'').get(created.asset.id);
  assert.equal(stored.mime_type, 'image/webp');
  const rendition = f.ram.objects.get('gif-public/' + stored.object_key);
  assert.equal(rendition.type, 'image/webp');
  const inspection = inspectImageBytes(rendition.bytes, { expectedType: 'image/webp', sanitized: true });
  assert.equal(inspection.frames, 2); assert.equal(inspection.metadataPresent, false);
  const metadata = await sharp(rendition.bytes, { animated: true }).metadata();
  assert.deepEqual(metadata.delay, [100, 100]);
  const pixels = await sharp(rendition.bytes, { animated: true }).ensureAlpha().raw().toBuffer();
  assert.notDeepEqual(pixels.subarray(0, 4), pixels.subarray(4, 8), 'different frames survive decoding');
  const refreshed = await f.call('GET ' + f.mediaPath + '/:id', {}, created.asset.id);
  assert.equal(refreshed.asset.url, result.asset.url);
  const article = { headline: `Synthetic ${mode} music release`, summary: 'A local test of an animated release image.',
    body: 'This synthetic music release report exists only in a disposable local test database.', category: 'release',
    sources: [{ kind: 'article', name: 'Official music announcement', url: 'https://example.com/music-release' }],
    photo: { assetId: created.asset.id, source: { name: 'Codec fixture', url: 'https://example.com/image-rights', credit: 'Synthetic test only' } } };
  const original = (await f.call('POST ' + f.draftPath, { ...article, idempotencyKey: 'gif-original-intent' })).draft;
  let draft = original;
  for (let copy = 1; copy <= 2; copy++) {
    const read = mode === 'remembered'
      ? (await f.call('GET ' + f.prefix + '/drafts/:id', {}, draft.id)).draft
      : (await f.editor.overview()).drafts.recent.find(item => item.id === draft.id);
    assert.equal(read.photo.url, result.asset.url);
    assert.deepEqual(read.photo.source, original.photo.source);
    draft = (await f.call('POST ' + f.draftPath, { ...article, body: read.body + ' Copy ' + copy,
      sources: read.sources.filter(item => item.kind === 'article'), photo: { assetId: read.photo.assetId, source: read.photo.source },
      idempotencyKey: 'gif-copy-intent-' + copy })).draft;
    assert.equal(draft.sources.length, 2, 'photo provenance never becomes an article citation');
    assert.equal(draft.photo.assetId, created.asset.id);
  }
  assert.equal(db.prepare('SELECT status FROM news_drafts WHERE id=?').get(original.id).status, 'draft');
  // Publication is strictly against this disposable local DB and RAM object store.
  const published = await f.call('POST ' + f.prefix + '/drafts/:id/publish', { expectedRevision: draft.revision }, draft.id);
  const story = createNewsDeskReader(db).forPost(published.postId);
  assert.equal(story.media[0].url, result.asset.url);
  assert.equal(story.media[0].mimeType, 'image/webp');
  const document = newsStoryPostDocument({ story, card: { comments: 0 }, comments: [], path: '/post/' + published.postId,
    origin: 'https://www.example.test', paths: {} });
  assert.equal(document.image, result.asset.url);
  assert.equal(document.imageMimeType, 'image/webp');
  assert.ok(renderPublicDocumentMain(document).includes(result.asset.url));
  assert.match(renderPublicDocumentHead(document), /property="og:image:type" content="image\/webp"/u);
  assert.deepEqual(document.jsonLd[0].citation, ['https://example.com/music-release']);
  await assert.rejects(f.call('POST ' + f.prefix + '/drafts/:id/publish', { expectedRevision: original.revision }, original.id),
    error => error.status === 409 || error.code === 'CONFLICT', 'already-associated media cannot be reused for a second article');
});

for (const mode of ['normal', 'remembered']) test(`${mode} Newsroom fails closed on invalid GIF bytes and resource limits`, async () => {
  const f = fixture(mode);
  const sized = (width, height, frames) => { const bytes = gif(frames); bytes.writeUInt16LE(width, 6); bytes.writeUInt16LE(height, 8); return bytes; };
  const cases = [
    ['GIF name hiding SVG', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>hidden</script></svg>')],
    ['MIME mismatch', await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).png().toBuffer()],
    ['trailing payload', Buffer.concat([gif(), Buffer.from('<script>hidden</script>')])],
    ['truncated stream', gif().subarray(0, 38)],
    ['edge limit', sized(16385, 1, 2)],
    ['frame limit', gif(301)],
    ['decoded canvas budget', sized(600, 600, 140)],
  ];
  for (const [label, bytes] of cases) {
    const created = await f.call('POST ' + f.mediaPath, { clientAssetId: 'bad-gif-' + cases.findIndex(item => item[0] === label),
      contentType: 'image/gif', fileSize: bytes.length, name: 'invalid.gif', ...(mode === 'normal' ? { purpose: 'post' } : {}) });
    await f.ram.fetchImpl(created.upload.uploadUrl, { method: 'PUT', headers: created.upload.requiredHeaders, body: bytes });
    await assert.rejects(f.call('POST ' + f.mediaPath + '/:id/finalize', mode === 'normal' ? { deliveryMode: 'server' } : {}, created.asset.id),
      error => error.status >= 400 && error.status < 500, label);
    assert.notEqual(db.prepare('SELECT status FROM media_assets WHERE id=?').get(created.asset.id).status, 'ready', label);
    assert.equal([...f.ram.objects.keys()].some(key => key.startsWith('gif-public/')), false, label + ' must never produce a public object');
  }
  const limit = mode === 'remembered' ? 10 * 1024 * 1024 : MEDIA_PHOTO_SOURCE_MAX_BYTES;
  for (const fileSize of [0, limit + 1]) {
    await assert.rejects(f.call('POST ' + f.mediaPath, { clientAssetId: 'invalid-gif-size', contentType: 'image/gif', fileSize,
      name: 'invalid.gif', ...(mode === 'normal' ? { purpose: 'post' } : {}) }), error => error.status >= 400 && error.status < 500);
  }
  assert.equal([...f.ram.objects.keys()].some(key => key.startsWith('gif-public/')), false);
});
