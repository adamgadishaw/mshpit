import { Platform } from "react-native";
// Explicit local live-data review; web and release builds are unchanged.
export const nativeReadOnlyReview = typeof __DEV__ !== "undefined" && __DEV__
  && Platform.OS !== "web" && process.env.EXPO_PUBLIC_NATIVE_READ_ONLY_REVIEW === "1";
export function reviewAllowsRequest(path, verb) {
  return !nativeReadOnlyReview || verb === "GET" || verb === "HEAD"
    || (verb === "POST" && (path === "/api/login" || path === "/api/logout"));
}
