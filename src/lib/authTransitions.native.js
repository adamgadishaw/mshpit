import { load, save } from "./persist";
import { api } from "./api";
import { createAuthIntentPersistence } from "./authIntentPersistence.mjs";
import { AUTH_INTENT_KEY, createAuthTransitions } from "../domain/authTransitions.mjs";
import { withNativeAuthPreparation } from "../domain/nativeAuthPreparation.mjs";
import { confirmAuthIntent } from "./authIntentDurability";

const { read, write } = createAuthIntentPersistence({
  readStored: () => load(AUTH_INTENT_KEY, null), writeStored: value => save(AUTH_INTENT_KEY, value),
});
export const authTransitions = withNativeAuthPreparation(createAuthTransitions({ read, write, confirmIntent: confirmAuthIntent,
  revoke: () => api("/api/logout", { method: "POST", skipIdentityCheck: true, silent: true, context: "Finishing sign-out" }),
}));
export { AUTH_INTENT_KEY };
