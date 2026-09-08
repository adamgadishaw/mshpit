import { Platform } from "react-native";
import { load, save } from "./persist";
import { api } from "./api";
import { createAuthIntentPersistence } from "./authIntentPersistence.mjs";
import { AUTH_INTENT_KEY, createAuthTransitions } from "../domain/authTransitions.mjs";

// No credential, account ID, or personal information is stored here. A small
// first-party cookie backs up the intent when localStorage is unavailable.
const COOKIE = "pit_auth_intent_v1";
const { read, write } = createAuthIntentPersistence({
  readStored: () => load(AUTH_INTENT_KEY, null),
  writeStored: (value) => save(AUTH_INTENT_KEY, value),
  readCookie: () => {
    if (Platform.OS !== "web" || typeof document === "undefined") return null;
    const raw = document.cookie.split(/;\s*/).find((part) => part.startsWith(`${COOKIE}=`));
    return raw ? JSON.parse(decodeURIComponent(raw.slice(COOKIE.length + 1))) : null;
  },
  writeCookie: (value) => {
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.cookie = `${COOKIE}=${encodeURIComponent(JSON.stringify(value))}; Path=/; SameSite=Strict; Max-Age=31536000${globalThis.location?.protocol === "https:" ? "; Secure" : ""}`;
    }
  },
});

export const authTransitions = createAuthTransitions({
  read,
  write,
  revoke: () => api("/api/logout", { method: "POST", skipIdentityCheck: true, silent: true, context: "Finishing sign-out" }),
  exclusive: (work) => Platform.OS === "web" && globalThis.navigator?.locks?.request
    ? globalThis.navigator.locks.request("pit-session-cookie-write", work)
    : work(),
});
export { AUTH_INTENT_KEY };
