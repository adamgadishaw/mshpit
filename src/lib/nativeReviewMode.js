import { Platform } from "react-native";
// Explicit local live-data review; web and release builds are unchanged.
export const nativeReadOnlyReview = typeof __DEV__ !== "undefined" && __DEV__
  && Platform.OS !== "web" && process.env.EXPO_PUBLIC_NATIVE_READ_ONLY_REVIEW === "1";
// The server classifies this exact POST as a read-only visibility lookup.
// It returns invalid cached IDs; it does not create or modify feed content.
export function reviewAllowsRequest(path, verb) {
  return !nativeReadOnlyReview || verb === "GET" || verb === "HEAD"
    || (verb === "POST" && (path === "/api/login" || path === "/api/logout" || path === "/api/feed/revalidate"));
}
