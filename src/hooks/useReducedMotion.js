import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";

let enabled = false;
let nativeSubscription = null;
let lookupGeneration = 0;
const listeners = new Set();

function publish(next) {
  const normalized = !!next;
  if (normalized === enabled) return;
  enabled = normalized;
  for (const listener of listeners) listener();
}

function startNativeSubscription() {
  const generation = ++lookupGeneration;
  Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
    .then((value) => {
      if (generation === lookupGeneration) publish(value);
    })
    .catch(() => { /* Reduce Motion is optional and safely defaults to false. */ });
  nativeSubscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", publish) || null;
}

function stopNativeSubscription() {
  lookupGeneration += 1;
  nativeSubscription?.remove?.();
  nativeSubscription = null;
}

function subscribe(listener) {
  listeners.add(listener);
  if (listeners.size === 1) startNativeSubscription();
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stopNativeSubscription();
  };
}

const snapshot = () => enabled;
const serverSnapshot = () => false;

// Feed cards share one native accessibility subscription. React still updates
// each mounted consumer, without installing a device listener for every card.
export default function useReducedMotion() {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
