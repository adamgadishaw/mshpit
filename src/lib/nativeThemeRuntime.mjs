// A single SQLite value keeps theme and owner inseparable across process death.
export const NATIVE_THEME_KEY = "pit.native.theme.v1";
export function createNativeThemeRuntime(storage, reload, report = () => {}) {
  let reloadPending = false;
  return {
    readThemeSelection() {
      let value;
      try { value = storage.getItemSync(NATIVE_THEME_KEY); }
      catch { return { theme: null, ownerId: null, unavailable: true }; }
      try {
        const pair = JSON.parse(value || "null");
        return typeof pair?.theme === "string" && typeof pair?.ownerId === "string"
          ? { theme: pair.theme, ownerId: pair.ownerId } : { theme: null, ownerId: null };
      } catch { return { theme: null, ownerId: null }; }
    },
    persistThemeSelection(theme, ownerId) {
      try {
        const value = JSON.stringify({ theme, ownerId: ownerId || "guest" });
        if (storage.getItemSync(NATIVE_THEME_KEY) === value) return true;
        storage.setItemSync(NATIVE_THEME_KEY, value);
        return storage.getItemSync(NATIVE_THEME_KEY) === value;
      } catch (error) { report(error); return false; }
    },
    clearThemeSelection() { storage.removeItemSync(NATIVE_THEME_KEY); },
    reloadTheme() {
      if (reloadPending) return;
      reloadPending = true;
      // Resolve both thrown and rejected reload failures. A persisted choice
      // remains available for the next launch without a retry/reload loop.
      Promise.resolve().then(() => reload("Applying saved appearance")).catch(error => {
        reloadPending = false;
        report(error);
      });
    },
  };
}
