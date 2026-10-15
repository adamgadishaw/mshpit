import { authLinkIntent } from './authLinkIntent.mjs';
import { PRODUCTION_API_ORIGIN } from './apiOrigin.mjs';

// An auth capability is admitted only from the exact email origin/root path.
// Custom schemes are deliberately excluded: another app can claim a scheme.
export function nativeAccountLinkIntent(value, origin = PRODUCTION_API_ORIGIN) {
  if (typeof value !== 'string' || value.length > 4096 || value !== value.trim() || /[\\\x00-\x20]/u.test(value)) return null;
  try {
    const expected = new URL(origin), url = new URL(value);
    if (expected.protocol !== 'https:' || expected.username || expected.password || expected.pathname !== '/' || expected.search || expected.hash || expected.port) return null;
    if (url.protocol !== 'https:' || url.origin !== expected.origin || url.username || url.password || url.port || url.pathname !== '/') return null;
    // Reject normalized alternate authority/path spellings too.
    if (!value.startsWith(expected.origin + '/') || !/^[?#]/u.test(value.slice(expected.origin.length + 1))) return null;
    return authLinkIntent(url);
  } catch { return null; }
}

// One in-memory inbox for both platform entry paths. Never persist/log a URL,
// token or intent, and never submit a capability just because it was delivered.
export function connectNativeAccountLinks({ linking, onIntent, onInvalidate, onUnavailable = () => {}, origin }) {
  let live = true, warm = false, ready = false, identity, pending = null, last = null, revision = 0, delivered = 0;
  const invalidate = (reason, accountId) => { onInvalidate({ reason, kind: pending?.kind, accountId }); };
  const publish = () => { if (live && ready && pending && delivered !== revision) { delivered = revision; onIntent({ ...pending, revision, accountId: identity }); } };
  const receive = (value, initial = false) => {
    if (!live || (initial && warm)) return;
    const next = nativeAccountLinkIntent(value, origin);
    if (!next) return;
    if (!initial) warm = true;
    if (last?.kind === next.kind && last?.token === next.token) return;
    invalidate("replace"); last = next; pending = next; revision += 1; publish();
  };
  const subscription = linking.addEventListener('url', ({ url }) => receive(url));
  Promise.resolve().then(() => linking.getInitialURL()).then(url => receive(url, true)).catch(() => { if (live) onUnavailable(); });
  return {
    setIdentity(nextReady, nextIdentity) {
      if (!live) return;
      if (!nextReady) { if (ready) invalidate("validation", identity); ready = false; return; }
      const owner = nextIdentity || null;
      if (identity !== undefined && owner !== identity) { invalidate("identity", owner); pending = null; }
      const becameReady = !ready && nextReady;
      identity = owner; ready = !!nextReady;
      if (becameReady) publish();
    },
    retire() { pending = null; },
    close() { if (!live) return; invalidate("close"); pending = null; },
    dispose() { live = false; pending = null; last = null; subscription.remove(); invalidate("dispose"); },
  };
}
