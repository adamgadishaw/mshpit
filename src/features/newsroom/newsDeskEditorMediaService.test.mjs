import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveMediaMimeType } from '../../domain/mediaMime.mjs';

// Execute the production service with platform transport/API seams, as other
// media lifecycle tests do, without loading the React Native runtime in Node.
const source = readFileSync(new URL('./newsDeskEditorMediaService.js', import.meta.url), 'utf8');
const factory = new Function('api', 'loadTransport', source
  .replace('import { api } from "../../lib/api";', '')
  .replace('await import("../../lib/mediaUpload")', 'await loadTransport()')
  .replaceAll('export async function', 'async function')
  + '\nreturn { uploadSelfWrittenPhoto, loadSelfWrittenPhoto };');

for (const type of ['image/gif', 'image/jpeg', 'image/png', 'image/webp']) {
  test(`normal Newsroom preserves original ${type} bytes and restores its verified rendition`, async () => {
    const original = { id: 'news-photo-codec', file: { type }, uri: 'blob:original', altText: 'Article image' };
    const signal = new AbortController().signal, calls = [];
    const prepared = { body: original.file, contentType: type, fileSize: 1000, name: 'article.' + type.split('/')[1] };
    const verified = { id: 'ma_newsroomcodecready', kind: 'image', status: 'ready', url: 'https://media.example.test/sanitized.webp' };
    const api = async (path, options) => {
      calls.push({ path, options }); assert.equal(options.expectedAccountId, 'owner'); assert.equal(options.signal, signal);
      if (path === '/api/media/assets') return { asset: { id: verified.id, status: 'upload_pending' }, upload: { method: 'PUT' } };
      return { asset: verified };
    };
    const transport = {
      prepareMediaUploadAsset: async (asset, options) => {
        assert.equal(asset, original); assert.equal(options.optimizeWeb, false, 'never flatten the GIF through a browser canvas');
        assert.equal(options.signal, signal); return prepared;
      },
      uploadPreparedMediaAsset: async (value, ticket, options) => {
        assert.equal(value, prepared); assert.equal(value.body, original.file); assert.equal(ticket.method, 'PUT'); assert.equal(options.signal, signal);
      },
    };
    const service = factory(api, async () => transport);
    const uploaded = await service.uploadSelfWrittenPhoto({ accountId: 'owner', asset: original, signal });
    assert.equal(calls[0].options.body.contentType, type);
    assert.equal(calls[1].options.body.deliveryMode, 'server', 'only the bounded server sanitizer produces display media');
    assert.equal(uploaded.uri, verified.url);
    const restored = await service.loadSelfWrittenPhoto({ accountId: 'owner', assetId: verified.id, signal });
    assert.equal(restored.uri, verified.url); assert.equal(restored.assetId, uploaded.assetId);
  });
}

test('GIF signatures win over mislabeled MIME hints and file names', () => {
  const bytes = Buffer.from('47494638396101000100800000', 'hex');
  assert.equal(resolveMediaMimeType({ bytes, declaredType: 'image/png', fileName: 'wrong.png' }), 'image/gif');
});
