// These new iOS-only consumers must not subscribe to preferences on other platforms.
export function useIOSScreenReaderEnabled() { return false; }
export function useIOSReducedMotion() { return false; }
