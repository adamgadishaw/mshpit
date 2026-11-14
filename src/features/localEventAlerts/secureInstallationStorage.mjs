const STORAGE_KEY = "mshpit.local-notification-installation.v1";
const valid = value => value && typeof value.installationId === "string" && /^[a-zA-Z0-9_-]{20,100}$/.test(value.installationId)
  && typeof value.secret === "string" && /^[a-zA-Z0-9_-]{43,100}$/.test(value.secret);

// Dependencies are Expo SecureStore and a native CSPRNG supplied by the native
// composition root. There is no insecure web/AsyncStorage fallback. The sole
// persisted record belongs to this installation (secret plus last acknowledged
// account binding), never to account export/backup. It has no Expo token.
// One serialized read/write chain; no private in-memory record cache survives
// calls. Failures are surfaced and do not silently replace existing identity.
export function createSecureInstallationStorage({ secureStore, createIdentity }) {
  let pending = Promise.resolve();
  const serialize = task => {
    const result = pending.then(task);
    pending = result.then(() => {}, error => { void error; });
    return result;
  };
  const read = async (create = true) => {
    const raw = await secureStore.getItemAsync(STORAGE_KEY);
    if (raw != null) {
      const value = JSON.parse(raw);
      if (!valid(value)) throw new TypeError("Device notification identity is invalid.");
      return value;
    }
    if (!create) return null;
    const value = await createIdentity();
    if (!valid(value)) throw new TypeError("Secure device identity could not be created.");
    const record = { installationId: value.installationId, secret: value.secret, binding: null };
    await secureStore.setItemAsync(STORAGE_KEY, JSON.stringify(record));
    return record;
  };
  return {
    readExisting: () => serialize(() => read(false)),
    getOrCreate: () => serialize(read),
    saveBinding: (binding, context) => serialize(async () => {
      context?.assertCurrent();
      const record = await read(); context?.assertCurrent();
      if (binding && (binding.installationId !== record.installationId || typeof binding.accountId !== "string" || !Number.isSafeInteger(binding.generation) || binding.generation < 1)) throw new TypeError("Invalid device binding.");
      await secureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ ...record, binding }));
      context?.assertCurrent();
    }),
  };
}
