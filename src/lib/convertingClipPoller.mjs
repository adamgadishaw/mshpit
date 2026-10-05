const IDLE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 256;

export function convertingClipPollDelay(elapsedMs) {
  return elapsedMs < 30_000 ? 2_000 : elapsedMs < 120_000 ? 5_000 : 15_000;
}

// One scheduler for author-visible clips. Duplicate cards share the asset read
// and its backoff age. Ready clips share a feed refresh per account; a clip that
// becomes ready after that refresh began waits for the next refresh snapshot.
export function createConvertingClipPoller({ check, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const entries = new Map(), refreshes = new Map();
  let timer = null, activeReads = 0;
  const keyFor = (accountId, assetId) => JSON.stringify([accountId, assetId]);
  const currentListeners = (entry) => [...entry.listeners].filter((listener) => listener.isCurrent());
  const delay = (entry) => convertingClipPollDelay(now() - entry.startedAt);
  const notify = (entry) => {
    for (const listener of currentListeners(entry)) listener.onState(entry.state);
  };

  function prune() {
    for (const [key, entry] of entries) {
      if (!entry.listeners.size && !entry.flight && now() - entry.lastUsedAt >= IDLE_TTL_MS) entries.delete(key);
    }
    if (entries.size < MAX_ENTRIES) return;
    for (const entry of [...entries.values()].filter((item) => !item.listeners.size && !item.flight).sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
      entries.delete(entry.key);
      if (entries.size < MAX_ENTRIES) break;
    }
  }

  function stopUnused(entry) {
    if (currentListeners(entry).length || !entry.flight) return;
    const flight = entry.flight;
    if (flight.members) {
      flight.members.delete(entry);
      if (!flight.members.size) flight.controller.abort();
      entry.flight = null;
    } else flight.controller.abort();
    entry.dueAt = now() + delay(entry);
  }

  function schedule() {
    if (timer !== null) clearTimer(timer);
    timer = null;
    let next = Infinity;
    for (const entry of entries.values()) {
      stopUnused(entry);
      if (entry.flight || entry.state !== "processing" || !currentListeners(entry).length) continue;
      if (entry.ready ? refreshes.has(entry.accountId) : activeReads >= 2) continue;
      next = Math.min(next, entry.dueAt);
    }
    if (Number.isFinite(next)) timer = setTimer(pump, Math.max(0, next - now()));
  }

  function read(entry) {
    const flight = { controller: new AbortController() };
    entry.flight = flight;
    activeReads++;
    void Promise.resolve().then(() => {
      if (flight.controller.signal.aborted || !currentListeners(entry).length) return "processing";
      return check(entry.assetId, { accountId: entry.accountId, signal: flight.controller.signal });
    }).catch(() => "processing").then((state) => {
      if (flight.controller.signal.aborted || !currentListeners(entry).length) return;
      if (state === "ready") entry.ready = true;
      else if (state === "failed") { entry.state = "failed"; notify(entry); }
    }).finally(() => {
      if (entry.flight === flight) entry.flight = null;
      activeReads--;
      entry.dueAt = now() + (entry.ready ? 0 : delay(entry));
      schedule();
    });
  }

  function refresh(accountId, members) {
    const flight = { controller: new AbortController(), members: new Set(members) };
    refreshes.set(accountId, flight);
    for (const entry of members) entry.flight = flight;
    void Promise.resolve().then(() => {
      if (flight.controller.signal.aborted) return false;
      const listener = [...flight.members].flatMap(currentListeners)[0];
      return listener?.onReady({ signal: flight.controller.signal });
    // architecture: allow-ambiguous-result -- Optional feed refresh: a miss keeps the notice and retries with backoff.
    }).catch(() => false).then((accepted) => {
      if (accepted !== true || flight.controller.signal.aborted) return;
      for (const entry of flight.members) {
        if (!currentListeners(entry).length) continue;
        entry.state = "ready";
        notify(entry);
      }
    }).finally(() => {
      for (const entry of flight.members) {
        if (entry.flight === flight) entry.flight = null;
        entry.dueAt = now() + delay(entry);
      }
      if (refreshes.get(accountId) === flight) refreshes.delete(accountId);
      schedule();
    });
  }

  function pump() {
    timer = null;
    const ready = new Map();
    for (const entry of entries.values()) {
      stopUnused(entry);
      if (entry.flight || entry.state !== "processing" || entry.dueAt > now() || !currentListeners(entry).length) continue;
      if (entry.ready) {
        if (!refreshes.has(entry.accountId)) {
          const group = ready.get(entry.accountId) || [];
          group.push(entry); ready.set(entry.accountId, group);
        }
      } else if (activeReads < 2) read(entry);
    }
    for (const [accountId, members] of ready) refresh(accountId, members);
    schedule();
  }

  return {
    subscribe({ accountId, assetId, state = "processing", isCurrent = () => true, onState, onReady }) {
      if (!accountId || !assetId) return () => {};
      prune();
      const key = keyFor(accountId, assetId);
      let entry = entries.get(key);
      if (!entry) {
        if (entries.size >= MAX_ENTRIES) return () => {};
        entry = { key, accountId, assetId, startedAt: now(), lastUsedAt: now(), dueAt: now(),
          state: state === "failed" ? "failed" : "processing", ready: false, flight: null, listeners: new Set() };
        entries.set(key, entry);
      } else if (state === "processing" && entry.state !== "processing") {
        // A fresh server projection can follow a retry in another tab/card.
        // Cached terminal state must not veto that authoritative projection.
        entry.state = "processing"; entry.ready = false; entry.dueAt = now();
        notify(entry);
      }
      const listener = { isCurrent, onState, onReady };
      entry.listeners.add(listener);
      entry.lastUsedAt = now();
      if (entry.state !== state && isCurrent()) onState(entry.state);
      schedule();
      return () => {
        entry.listeners.delete(listener);
        entry.lastUsedAt = now();
        stopUnused(entry);
        schedule();
      };
    },
    // Called only after an explicit successful retry. Hidden/visible changes
    // never reset a long-running clip's short initial polling window.
    retryAccepted(accountId, assetId) {
      const entry = entries.get(keyFor(accountId, assetId));
      if (!entry || entry.flight) return;
      entry.state = "processing"; entry.ready = false;
      entry.startedAt = now(); entry.dueAt = now();
      notify(entry);
      schedule();
    },
  };
}
