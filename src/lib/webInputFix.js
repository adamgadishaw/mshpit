import { Platform } from "react-native";

// react-native-web renders TextInput as a real <input>/<textarea>, which the
// browser decorates with its default focus *outline*, the harsh square box the
// app's inputs were showing on focus. We replace it app-wide with a subtle,
// on-theme amber treatment: no outline, and a soft amber border + faint glow on
// focus so every field reads the same way (Search, Edit Profile, Auth, chat…).
// No-op on iOS/Android (no `document`).
if (Platform.OS === "web" && typeof document !== "undefined" && !document.getElementById("pit-input-fix")) {
  const el = document.createElement("style");
  el.id = "pit-input-fix";
  el.textContent = `
    input, textarea, select { outline: none !important; }
    input:focus, textarea:focus, select:focus {
      outline: none !important;
      border-color: rgba(242,166,90,0.85) !important;
      box-shadow: 0 0 0 3px rgba(242,166,90,0.15) !important;
      transition: border-color .12s ease, box-shadow .12s ease;
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
