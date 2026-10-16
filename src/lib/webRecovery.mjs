// Recovery is deliberately synchronous: a dialog must never wait for a network
// request or resume an account-owned save after logout/account handoff.
const sources = new Set();
export function registerWebRecoveryDraft(flush, isCurrent) {
  const source = { flush, isCurrent };
  sources.add(source);
  return () => sources.delete(source);
}

// These are existing noncredential auth-intent receipts. Compare their raw
// durable values too: storage events can be queued behind a browser dialog.
export function captureWebAuthCheck(browser = globalThis.window) {
  const read = () => {
    const storage = browser.localStorage;
    const intent = storage.getItem('pit.auth.intent.v1');
    const epoch = storage.getItem('pit.auth.epoch.v1');
    const cookie = (browser.document?.cookie || '').split(/;\s*/).find(part => part.startsWith('pit_auth_intent_v1=')) || '';
    for (const raw of [intent, cookie ? decodeURIComponent(cookie.slice('pit_auth_intent_v1='.length)) : null]) {
      if (!raw) continue;
      const value = JSON.parse(raw);
      if (value?.phase !== 'signed-in' || typeof value.revision !== 'string') throw new Error('Account transition pending');
    }
    return JSON.stringify([intent, epoch, cookie]);
  };
  try {
    const captured = read();
    return () => { try { return read() === captured; } catch { return false; } };
  } catch { return () => false; }
}

export function verifyDurableJson(key, matches, browser = globalThis.window) {
  try { return !!matches(JSON.parse(browser.localStorage.getItem(key))); }
  catch { return false; }
}

function storageWorks(browser) {
  let storage, key;
  try {
    storage = browser.localStorage;
    key = 'pit.recovery.check.' + Math.random().toString(36).slice(2);
    storage.setItem(key, key);
    return storage.getItem(key) === key;
  } catch { return false; }
  finally { try { if (key) storage?.removeItem(key); } catch { /* own canary only */ } }
}

export function freshAppUrl(browser = globalThis.window) {
  try {
    const url = new URL('/', browser.location.href);
    return /^https?:$/.test(url.protocol) ? url.href : '/';
  } catch { return '/'; }
}

const blocked = (message) => ({ status: 'blocked', message });
export function requestWebRecovery({ browser = globalThis.window, reload = () => browser.location.reload(), unmounted = false } = {}) {
  if (!storageWorks(browser)) return blocked('This browser cannot confirm saved drafts. Keep this tab open, or open Mshpit in a new tab.');
  const authCurrent = captureWebAuthCheck(browser);
  if (!authCurrent()) return blocked('An account change is still being confirmed. Keep this tab open, or open a new tab.');
  const registered = unmounted ? [] : [...sources];
  const checks = [];
  let saved = 0;
  try {
    for (const source of registered) {
      if (!authCurrent() || !source.isCurrent()) return blocked('Your account changed. Keep this tab open and use a new tab to continue.');
      const result = source.flush();
      if (!source.isCurrent() || !result || !['saved', 'clean'].includes(result.status)
          || typeof result.verify !== 'function' || !result.verify()) {
        return blocked(result?.message || 'Some edits or selected files could not be saved. Finish or copy them before reloading, or open a new tab.');
      }
      if (result.status === 'saved') saved++;
      checks.push(() => sources.has(source) && source.isCurrent() && result.verify());
    }
    const warning = saved
      ? 'Supported drafts were saved and checked on this device. Other unsaved forms or selected files may still be lost. Reload this tab?'
      : 'Only drafts already saved on this device can be restored. Unsaved edits and selected files may be lost. Open a new tab to keep this tab intact. Reload this tab?';
    if (typeof browser.confirm !== 'function' || !browser.confirm(warning)) {
      return { status: 'staying', message: 'This tab is staying open. You can continue in a new tab without closing this one.' };
    }
    // Another tab can change storage while a native confirmation is open.
    // Re-read the exact persisted snapshot and identity fence before navigating.
    if (!authCurrent() || checks.some(check => !check()) || !storageWorks(browser)) return blocked('The saved draft or account changed. This tab is staying open; use a new tab to continue.');
    reload();
    return { status: 'reloading', message: 'Reload requested. If this screen stays here, open Mshpit in a new tab.' };
  } catch {
    return blocked('Draft preservation could not be confirmed. Keep this tab open, or open Mshpit in a new tab.');
  }
}
