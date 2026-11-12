import { useSyncExternalStore } from "react";
import { AccessibilityInfo } from "react-native";
import { createIOSAccessibilityPreference } from "./iosAccessibilityPreference.mjs";

const preference = createIOSAccessibilityPreference({
  read: () => AccessibilityInfo.isReduceMotionEnabled(),
  listen: listener => AccessibilityInfo.addEventListener("reduceMotionChanged", listener),
});

export default function useReducedMotion() {
  return useSyncExternalStore(preference.subscribe, preference.getSnapshot, preference.getServerSnapshot);
}
