// Keep one bounded target-denial directory per Store instance and account
// epoch. Weak ownership avoids a new Store hook or cross-provider state.
const owners = new WeakMap();
const TARGET_LIMIT = 128;
export function claimIOSProfileRead(owner, targetId) {
  const epoch = owner.current;
  let state = owners.get(owner);
  if (!state || state.epoch !== epoch) {
    state = { epoch, targets: new Map() };
    owners.set(owner, state);
  }
  let target = state.targets.get(targetId);
  if (!target) {
    target = { revision: 0 };
    state.targets.set(targetId, target);
    while (state.targets.size > TARGET_LIMIT) state.targets.delete(state.targets.keys().next().value);
  }
  const revision = target.revision;
  const owned = () => owners.get(owner) === state && owner.current === epoch;
  return {
    current: () => owned() && state.targets.get(targetId) === target && target.revision === revision,
    quarantine() {
      // A genuine denial invalidates all reads that preceded it, including a
      // replacement claim after bounded eviction. It cannot affect a new account.
      if (!owned()) return;
      const live = state.targets.get(targetId);
      if (live) live.revision += 1;
    },
  };
}
