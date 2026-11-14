import { prepareThemeStartup } from "./themeStartup.mjs";
import { readThemeSelection } from "./themeRuntime";
import { api } from "./api";
import { authTransitions } from "./authTransitions";

export function prepareSavedTheme() {
  return prepareThemeStartup({
    readSelection: readThemeSelection,
    signedOut: () => authTransitions.blocked(),
    fetchAccount: async () => (await api("/api/me", { skipIdentityCheck: true, silent: true,
      timeoutMs: 8000, context: "Checking saved appearance" })).user,
  });
}
