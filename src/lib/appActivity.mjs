// Pure activity policy shared by the React hook and its regression tests.
// Web lifecycle is authoritative on document visibility; native lifecycle is
// authoritative on React Native's AppState. An unknown initial state remains
// active so server rendering and very early native startup do not deadlock.
export function appActivityIsActive({
  platform,
  appState = null,
  visibilityState = null,
} = {}) {
  if (platform === "web") {
    return visibilityState == null || visibilityState === "visible";
  }
  return appState == null || appState === "active";
}
