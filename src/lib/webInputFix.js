import { Platform } from "react-native";
import {
  WEB_INPUT_FOCUS_ATTRIBUTE,
  findWebInputFocusBoundary,
  isWebFocusVisible,
  isWebInputControl,
} from "./webInputFocus.mjs";

// react-native-web renders TextInput as a real <input>/<textarea>, which the
// browser decorates with its default focus *outline*. Many Mshpit fields put
// their visible border on a rounded parent View (icon + input + clear button),
// so highlighting the raw input creates a smaller rectangular box. Find the
// nearest actual painted field boundary and put keyboard focus on that instead.
// No-op on iOS/Android (no `document`).
if (Platform.OS === "web" && typeof document !== "undefined") {
  if (!document.getElementById("pit-input-fix")) {
    const el = document.createElement("style");
    el.id = "pit-input-fix";
    el.textContent = `
    input, textarea, select {
      outline: none !important;
      -webkit-tap-highlight-color: transparent;
    }
    input:focus, textarea:focus, select:focus {
      outline: none !important;
      box-shadow: none !important;
    }
    [${WEB_INPUT_FOCUS_ATTRIBUTE}="true"] {
      outline: 2px solid transparent !important;
      box-shadow: 0 0 0 3px rgba(242,166,90,0.42) !important;
      transition: box-shadow .12s ease;
    }
    @media (forced-colors: active) {
      [${WEB_INPUT_FOCUS_ATTRIBUTE}="true"] {
        outline-color: Highlight !important;
        box-shadow: none !important;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      [${WEB_INPUT_FOCUS_ATTRIBUTE}="true"] { transition: none; }
    }
    input::placeholder, textarea::placeholder { opacity: 1; }

    /* modern web polish: crisp type, quiet scrollbars, on-brand selection */
    html, body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    /* Antialiasing must be on EVERY node: react-native-web renders text in nested
       divs that do not inherit smoothing from body, which read as choppy up close. */
    html, body, * { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility; }
    ::selection { background: rgba(255,140,66,0.35); }
    * { scrollbar-width: thin; scrollbar-color: rgba(100,107,130,0.35) transparent; }
    *::-webkit-scrollbar { width: 8px; height: 8px; }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb { background: rgba(100,107,130,0.35); border-radius: 99px; }
    *::-webkit-scrollbar-thumb:hover { background: rgba(100,107,130,0.6); }
  `;
    document.head.appendChild(el);
  }

  const installKey = "__mshpitInputFocusBoundaryCleanup";
  globalThis[installKey]?.();
  let activeBoundary = null;

  const clearBoundary = () => {
    activeBoundary?.removeAttribute?.(WEB_INPUT_FOCUS_ATTRIBUTE);
    activeBoundary = null;
  };
  const showBoundary = (control) => {
    clearBoundary();
    if (!isWebInputControl(control) || !isWebFocusVisible(control)) return;
    activeBoundary = findWebInputFocusBoundary(control);
    activeBoundary?.setAttribute?.(WEB_INPUT_FOCUS_ATTRIBUTE, "true");
  };
  const onFocusIn = (event) => showBoundary(event.target);
  const onFocusOut = (event) => {
    if (event.target === document.activeElement) return;
    clearBoundary();
  };

  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  globalThis[installKey] = () => {
    clearBoundary();
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
  };
}
