import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
let enabled = true, generation = 0, subscription;
const listeners = new Set();
const publish = value => { enabled = !!value; for (const notify of listeners) notify(); };
const subscribe = notify => {
  listeners.add(notify);
  if (listeners.size === 1) {
    const current = ++generation;
    Promise.resolve(AccessibilityInfo.isScreenReaderEnabled()).then(value => {
      if (current === generation) publish(value);
    }).catch(() => { if (current === generation) publish(true); });
    subscription = AccessibilityInfo.addEventListener("screenReaderChanged", publish);
  }
  return () => {
    listeners.delete(notify);
    if (!listeners.size) { generation++; subscription?.remove(); subscription = null; enabled = true; }
  };
};
export default function useScreenReaderEnabled() {
  return useSyncExternalStore(subscribe, () => enabled, () => true);
}
