import { staleAuthentication } from "./authTransitions.mjs";

// Preparation precedes the existing credential queue. It never writes cookies
// or replaces that queue. Logout/newer attempts fence every awaited preparation.
export function withNativeAuthPreparation(base) {
  let hooks = null, intent = 0;
  return {
    ...base,
    attachPreparation(next) { hooks = next; return () => { if (hooks === next) hooks = null; }; },
    signOut() { intent++; hooks?.reset(); return base.signOut(); },
    async run(options) {
      const mine = ++intent, revision = base.revision(), owner = hooks;
      const current = () => mine === intent && base.revision() === revision && !options.signal?.aborted;
      if (!current()) return staleAuthentication();
      try {
        const result = await owner?.prepare();
        if (!current()) return staleAuthentication();
        if (result?.ok === false) throw result.error;
        return await base.run(options);
      } finally {
        if (mine === intent) owner?.cancelPreparation();
      }
    },
  };
}
