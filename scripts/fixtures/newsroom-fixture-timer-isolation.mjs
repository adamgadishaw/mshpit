// Scratch-only timer admission. Candidate files and request timers are unchanged.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { getCallSites } from 'node:util';
import timers from 'node:timers';

export const PINNED_TIMER_SOURCES = Object.freeze({
  'server/privacyJournal.js': '38e16c6eac2de0e4b667d5f021212ba26218d876cc1d8eeea70c4774b0d67d47',
  'server/features/searchGrowth/searchGrowthService.js': '4ddc0d7bdaddfd841f91538ebf555f67cf207a3951187c1846386849e47826a1',
  'server/venuePhotoEnrichment.js': 'c5840d05fa33b9de802047c44ab12ec8836cd5a7dc5de932a7433e683c5946b7',
  'server/periodicJobScheduler.js': '9b17240f4d91a4c970981d891ea6544b7a57856a54feafaf9ae6ff1d0ade2dd6',
});
const SCHEDULERS = Object.freeze([
  { module: 'server/privacyJournal.js', name: 'startPrivacyJournalShipper', timeout: 60_000, interval: 300_000 },
  { module: 'server/features/searchGrowth/searchGrowthService.js', name: 'startSearchGrowthScheduler', timeout: 180_000, interval: 3_600_000 },
  { module: 'server/venuePhotoEnrichment.js', name: 'startVenuePhotoScheduler', timeout: 180_000, interval: 900_000 },
]);
const SELF = resolve(fileURLToPath(import.meta.url));
let installed = false;

export function assertPinnedTimerSource(module, bytes) {
  assert.ok(Object.hasOwn(PINNED_TIMER_SOURCES, module), 'Unknown pinned timer source');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), PINNED_TIMER_SOURCES[module],
    'Fixture timer source pin mismatch: ' + module);
}
function samePath(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }
function localSource(name) {
  if (typeof name !== 'string' || !name) return null;
  try { return name.startsWith('file:') ? resolve(fileURLToPath(name)) : isAbsolute(name) ? resolve(name) : null; }
  catch { return null; }
}
function containedPath(root, path) {
  const part = relative(root, path).replaceAll('\\', '/');
  return part && part !== '..' && !part.startsWith('../') && !isAbsolute(part) ? part : null;
}
function safeFrame(frame, candidateRoot, scratchRoot) {
  const path = localSource(frame?.scriptName);
  let caller = 'unknown-code';
  if (path) caller = containedPath(candidateRoot, path) ||
    (containedPath(scratchRoot, path) ? 'scratch/' + containedPath(scratchRoot, path) : 'external-code/' + basename(path));
  else if (String(frame?.scriptName || '').startsWith('node:')) caller = String(frame.scriptName);
  return { caller, line: Number(frame?.lineNumber) || 0, column: Number(frame?.columnNumber) || 0 };
}
export function classifyTimerRegistration({ kind, delayMs, frames, candidateRoot, scratchRoot }) {
  const roots = { candidateRoot: resolve(candidateRoot), scratchRoot: resolve(scratchRoot) };
  const external = frames.filter(frame => {
    const path = localSource(frame.scriptName);
    return !path || !samePath(path, SELF);
  });
  const first = external[0];
  const record = { kind, delayMs, ...safeFrame(first, roots.candidateRoot, roots.scratchRoot) };
  for (const scheduler of SCHEDULERS) {
    const path = resolve(join(roots.candidateRoot, scheduler.module));
    const owner = external.find(frame => {
      const framePath = localSource(frame.scriptName);
      return framePath && samePath(framePath, path) &&
        [scheduler.name, 'Module.' + scheduler.name, 'Object.' + scheduler.name].includes(frame.functionName);
    });
    if (!owner) continue;
    // Only the two registration calls in the pinned shared periodic helper are
    // suppressed. runOnce/request timeouts in either module remain native.
    assert.equal(record.caller, 'server/periodicJobScheduler.js', 'Unexpected fixture scheduler timer caller');
    assert.equal(record.line, kind === 'timeout' ? 108 : 109, 'Unexpected fixture scheduler timer callsite');
    assert.equal(delayMs, scheduler[kind], 'Unexpected fixture scheduler timer delay');
    return { suppressed: true, ...record, scheduler: { module: scheduler.module, name: scheduler.name } };
  }
  return { suppressed: false, ...record };
}

export function installFixtureTimerIsolation({ candidateRoot, scratchRoot }) {
  assert.equal(installed, false, 'Fixture timer isolation is already installed');
  assert.equal(typeof getCallSites, 'function', 'Structured timer callsites are required');
  for (const module of Object.keys(PINNED_TIMER_SOURCES)) {
    assertPinnedTimerSource(module, readFileSync(join(candidateRoot, module)));
  }
  const originals = Object.fromEntries(['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'].map(key => [key, timers[key]]));
  const oldGlobals = Object.fromEntries(Object.keys(originals).map(key => [key, globalThis[key]]));
  const admitted = [], suppressed = [], inert = new WeakSet(), numericHandles = new Map();
  let nextHandle = -1;
  function inertHandle() {
    let referenced = true;
    const number = nextHandle--;
    const handle = {
      unref() { referenced = false; return handle; },
      ref() { referenced = true; return handle; },
      hasRef() { return referenced; },
      refresh() { return handle; },
      close() { numericHandles.delete(number); return handle; },
      [Symbol.toPrimitive]() { return number; },
      [Symbol.dispose]() { handle.close(); },
    };
    inert.add(handle); numericHandles.set(number, handle); return handle;
  }
  function schedule(kind, callback, delay, args) {
    // Preserve native validation, argument conversion and callback behavior.
    if (typeof callback !== 'function') return originals[kind === 'timeout' ? 'setTimeout' : 'setInterval'](callback, delay, ...args);
    // Do not invoke a caller-supplied valueOf twice: native timers own coercion.
    const delayMs = typeof delay === 'number' && Number.isFinite(delay) ? delay :
      typeof delay === 'string' && Number.isFinite(Number(delay)) ? Number(delay) : null;
    const record = classifyTimerRegistration({ kind, delayMs, frames: getCallSites(30, { sourceMap: false }), candidateRoot, scratchRoot });
    assert.ok(admitted.length + suppressed.length < 10_000, 'Fixture timer inventory budget exhausted');
    (record.suppressed ? suppressed : admitted).push(record);
    if (record.suppressed) return inertHandle();
    return originals[kind === 'timeout' ? 'setTimeout' : 'setInterval'](callback, delay, ...args);
  }
  const wrapped = {
    setTimeout(callback, delay, ...args) { return schedule('timeout', callback, delay, args); },
    setInterval(callback, delay, ...args) { return schedule('interval', callback, delay, args); },
    clearTimeout(handle) { if (inert.has(handle) || numericHandles.has(handle)) { numericHandles.delete(Number(handle)); return; } return originals.clearTimeout(handle); },
    clearInterval(handle) { if (inert.has(handle) || numericHandles.has(handle)) { numericHandles.delete(Number(handle)); return; } return originals.clearInterval(handle); },
  };
  // Preserve native promisify implementations; their real deadline behavior is
  // outside this narrow global/node:timers registration inventory.
  for (const name of ['setTimeout', 'setInterval']) {
    for (const symbol of Object.getOwnPropertySymbols(originals[name])) {
      Object.defineProperty(wrapped[name], symbol, Object.getOwnPropertyDescriptor(originals[name], symbol));
    }
  }
  for (const name of Object.keys(wrapped)) { timers[name] = wrapped[name]; globalThis[name] = wrapped[name]; }
  syncBuiltinESMExports(); installed = true;
  return Object.freeze({
    snapshot() { return { version: 1, inventoryScope: 'global and node:timers registrations; native internal/promises timers unchanged',
      pins: { ...PINNED_TIMER_SOURCES }, admittedCount: admitted.length, suppressedCount: suppressed.length,
      admitted: structuredClone(admitted), suppressed: structuredClone(suppressed) }; },
    restore() { for (const name of Object.keys(originals)) { timers[name] = originals[name]; globalThis[name] = oldGlobals[name]; }
      syncBuiltinESMExports(); installed = false; },
  });
}
