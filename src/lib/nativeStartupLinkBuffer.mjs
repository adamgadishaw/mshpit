// Theme authorization can finish before either native URL consumer mounts.
// Keep only the newest startup event in memory until both consumers take it.
// Each consumer installs its live listener before asking for its initial URL.
export function createNativeStartupLinks(linking) {
  const consumers = new Map([['account', false], ['news', false]]);
  const owners = new Map();
  let active = true, warmSeen = false, latest = null;
  const capture = linking.addEventListener('url', event => {
    if (!active) return;
    warmSeen = true;
    latest = typeof event?.url === 'string' && event.url.length <= 4096 ? event.url : null;
  });
  return {
    forConsumer(name, owner = {}) {
      if (!consumers.has(name)) throw new Error('Unknown native startup URL consumer');
      owners.set(name, owner);
      let retired = false;
      // Account ingress creates a new controller on effect replay. News keeps
      // its ingress ref and pending read across replay, but a new Root retires
      // that old owner's read before it can claim the replacement's handoff.
      const abandoned = () => owners.get(name) !== owner || (name === 'account' && retired);
      const finish = () => {
        consumers.set(name, true);
        if ([...consumers.values()].every(Boolean)) {
          active = false;
          capture.remove();
          latest = null;
        }
      };
      return {
        addEventListener(type, listener) {
          const subscription = linking.addEventListener(type, listener);
          return { remove() { retired = true; subscription.remove(); } };
        },
        getInitialURL() {
          // A remounted boundary cannot replay a retired launch capability.
          if (abandoned() || consumers.get(name)) return Promise.resolve(null);
          const result = warmSeen ? Promise.resolve(latest) : linking.getInitialURL();
          return Promise.resolve(result).then(url => {
            if (abandoned() || consumers.get(name)) return null;
            // A newer URL may arrive while the platform launch read is pending
            // or during an effect's cleanup/setup gap.
            const selected = warmSeen ? latest : url;
            finish();
            return selected;
          }, error => {
            if (abandoned() || consumers.get(name)) return null;
            finish();
            throw error;
          });
        },
      };
    },
  };
}
