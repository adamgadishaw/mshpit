// SDK 56's SQLite key-value store keeps the account-scoped draft identity and
// drafts across process death while preserving this project's synchronous API.
// Large feed/user caches intentionally remain memory-only: synchronously writing
// those on every poll would trade data safety for exactly the phone jank this
// composer work is meant to remove.
import Storage from "expo-sqlite/kv-store";
import { createJsonPersistence } from "./persistenceAdapter.mjs";

const DURABLE_KEYS = new Set([
  "pit.session",
  "pit.drafts",
  "pit.entered",
  "pit.activeComposer",
  "pit.pendingComposerPicker",
  // Privacy-safe, account-scoped analytics retry batches contain only the
  // approved taxonomy and internal ids; keeping them durable makes intermittent
  // phone connectivity observable without retaining authored content.
  "pit.analytics.v2",
]);
const volatile = new Map();
const persistence = createJsonPersistence({
  getItem: (key) => (DURABLE_KEYS.has(key) || key.startsWith("pit.analytics.v2.") || key.startsWith("pit.youtubeRejected.v1.")) ? Storage.getItemSync(key) : (volatile.get(key) ?? null),
  setItem: (key, value) => {
    if (DURABLE_KEYS.has(key) || key.startsWith("pit.analytics.v2.") || key.startsWith("pit.youtubeRejected.v1.")) Storage.setItemSync(key, value);
    else volatile.set(key, value);
  },
});

export const load = persistence.load;
export const save = persistence.save;
export const setPersistErrorHandler = persistence.setErrorHandler;
