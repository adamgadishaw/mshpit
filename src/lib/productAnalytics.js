import { AppState, Platform } from "react-native";
import { api } from "./api";
import { load, remove, save } from "./persist";
import { ANALYTICS_BATCH_LIMIT, ANALYTICS_QUEUE_LIMIT, sanitizeAnalyticsEvent } from "../domain/analyticsPolicy.mjs";
import {
  LEGACY_PRODUCT_ANALYTICS_STORAGE_KEY,
  productAnalyticsStorageKey,
} from "../domain/accountLocalPrivacy.mjs";

// Retire the pre-account-scoping retry queue on first load. Its events have no
// trustworthy owner and therefore must never be adopted by the current cookie.
remove(LEGACY_PRODUCT_ANALYTICS_STORAGE_KEY);

const FLUSH_INTERVAL_MS = 8000;
const RETRY_MAX_MS = 60_000;
const platform = ["web", "ios", "android"].includes(Platform.OS) ? Platform.OS : "unknown";

let account = { id: null, enabled: false };
let queue = [];
let inFlight = null; // { ownerId, promise }
let timer = null;
let appStateSubscription = null;
let visibilityHandler = null;
let retryMs = FLUSH_INTERVAL_MS;
let sessionNonce = 0;
let persistTimer = null;
let pendingPersistOwnerId = null;

function readQueue(accountId) {
  const key = productAnalyticsStorageKey(accountId);
  const stored = key ? load(key, []) : [];
  if (!Array.isArray(stored)) return [];
  return stored.map((event) => sanitizeAnalyticsEvent(event, { requireId: true })).filter(Boolean).slice(-ANALYTICS_QUEUE_LIMIT);
}

function persistQueue({ immediate = false, ownerId = account.id, snapshot = queue } = {}) {
  const key = productAnalyticsStorageKey(ownerId);
  if (!key) return;
  if (persistTimer && pendingPersistOwnerId === ownerId) clearTimeout(persistTimer);
  const durableSnapshot = snapshot.slice(-ANALYTICS_QUEUE_LIMIT);
  const write = () => {
    if (pendingPersistOwnerId === ownerId) {
      persistTimer = null;
      pendingPersistOwnerId = null;
    }
    save(key, durableSnapshot);
  };
  if (immediate) write();
  else {
    pendingPersistOwnerId = ownerId;
    persistTimer = setTimeout(write, 1000);
  }
}

function eventId() {
  sessionNonce++;
  const random = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID().replaceAll("-", "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `evt_${random}_${sessionNonce.toString(36)}`.slice(0, 80);
}

function schedule(ms = retryMs) {
  if (timer) clearTimeout(timer);
  if (!account.enabled || !queue.length) return;
  timer = setTimeout(() => { timer = null; flushProductAnalytics(); }, ms);
}

export function configureProductAnalytics(user) {
  const next = {
    id: user?.id || null,
    enabled: !!user?.id && !!(user?.analyticsConsentAt || user?.consentAt) && !user?.analyticsOptOut,
  };
  const changedAccount = next.id !== account.id;
  if (changedAccount && account.id) {
    // Commit A's immutable snapshot before adopting B's identity. A debounced
    // timer must never read the mutable queue after the account changes.
    persistQueue({ immediate: true, ownerId: account.id, snapshot: queue });
  }
  account = next;
  if (changedAccount) queue = readQueue(next.id);
  if (!next.enabled) {
    queue = [];
    persistQueue({ immediate: true });
    if (timer) clearTimeout(timer);
    timer = null;
    return;
  }
  schedule(250);
}

export function trackProductEvent(name, props = {}, { expectedAccountId } = {}) {
  if (!account.enabled || (expectedAccountId && account.id !== expectedAccountId)) return null;
  const event = sanitizeAnalyticsEvent({ id: eventId(), name, props }, { requireId: true });
  if (!event) return null;
  queue.push(event);
  if (queue.length > ANALYTICS_QUEUE_LIMIT) queue = queue.slice(-ANALYTICS_QUEUE_LIMIT);
  persistQueue();
  if (queue.length >= ANALYTICS_BATCH_LIMIT) flushProductAnalytics();
  else schedule();
  return event.id;
}

export async function flushProductAnalytics() {
  if (!account.enabled || !account.id || !queue.length) return { stored: 0 };
  if (inFlight) {
    // A shared-device account switch must not attach B's queue to A's request.
    // The old request owns its promise; its finalizer schedules the current
    // account once the single-flight slot is released.
    if (inFlight.ownerId !== account.id) schedule(250);
    return inFlight.promise;
  }
  const ownerId = account.id;
  const batch = queue.slice(0, ANALYTICS_BATCH_LIMIT);
  const promise = api("/api/events/batch", {
    method: "POST",
    body: { events: batch },
    context: "Syncing private product metrics",
    silent: true,
    timeoutMs: 10_000,
  }).then((result) => {
    if (account.id !== ownerId) return result;
    const ids = new Set(batch.map((event) => event.id));
    queue = queue.filter((event) => !ids.has(event.id));
    retryMs = FLUSH_INTERVAL_MS;
    persistQueue({ immediate: true });
    schedule(250);
    return result;
  }).catch(() => {
    retryMs = Math.min(RETRY_MAX_MS, retryMs * 2);
    if (account.id === ownerId) schedule(retryMs);
    return { stored: 0, retrying: true };
  }).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
    if (account.enabled && queue.length) schedule(0);
  });
  inFlight = { ownerId, promise };
  return promise;
}

export function installProductAnalyticsLifecycle() {
  if (appStateSubscription || visibilityHandler) return () => {};
  if (Platform.OS === "web" && typeof document !== "undefined") {
    visibilityHandler = () => {
      if (document.hidden) {
        persistQueue({ immediate: true });
        return flushProductAnalytics();
      }
      trackProductEvent("app_open", { platform, entry: "resume" });
      schedule(0);
    };
    document.addEventListener("visibilitychange", visibilityHandler);
  } else {
    appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        trackProductEvent("app_open", { platform, entry: "resume" });
        schedule(0);
      } else if (state === "background" || state === "inactive") {
        persistQueue({ immediate: true });
        flushProductAnalytics();
      }
    });
  }
  return () => {
    appStateSubscription?.remove?.();
    appStateSubscription = null;
    if (visibilityHandler && typeof document !== "undefined") document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  };
}

export function productAnalyticsPlatform() {
  return platform;
}

// Account exit removes that identity's device-local retry batch so logout or
// deletion cannot leave private analytics events for the next device user.
export function purgeProductAnalyticsAccount(accountId) {
  const id = accountId || account.id;
  if (!id) return;
  if (persistTimer && pendingPersistOwnerId === id) {
    clearTimeout(persistTimer);
    persistTimer = null;
    pendingPersistOwnerId = null;
  }
  remove(productAnalyticsStorageKey(id));
  if (account.id === id) {
    queue = [];
    account = { id: null, enabled: false };
  }
}
