function safeHttpsShareUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 4_096) return null;
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Open the blank window while the user's tap is still active, detach it from
 * Mshpit, and only then send it to the HTTPS social composer.
 */
export function openHttpsSharePopup(url, { openWindow = globalThis.window?.open?.bind(globalThis.window) } = {}) {
  const target = safeHttpsShareUrl(url);
  if (!target) throw new Error("UNSAFE_SHARE_URL");
  if (typeof openWindow !== "function") throw new Error("WINDOW_UNAVAILABLE");

  const popup = openWindow("", "_blank");
  if (!popup) throw new Error("POPUP_BLOCKED");
  try {
    popup.opener = null;
    if (typeof popup.location?.replace !== "function") throw new Error("POPUP_NAVIGATION_UNAVAILABLE");
    popup.location.replace(target);
  } catch (error) {
    try {
      popup.close?.();
    } catch {
      // architecture: allow-empty-catch -- closing a partially opened popup is best-effort cleanup.
    }
    throw error;
  }
  return { mode: "external" };
}
