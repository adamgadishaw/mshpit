import { Platform } from "react-native";

// Mobile-web safe areas. Two real problems on phones (esp. iOS Safari):
//   1. Content hid behind the notch / home indicator — because the page never
//      opted into safe-area insets (`viewport-fit=cover`) and reserved nothing.
//   2. The bottom tab bar hid behind Safari's toolbar — because the app was
//      sized to the *layout* viewport (`height:100%`), which is TALLER than what's
//      actually visible when the browser chrome is showing.
//
// Fix, applied at runtime so it also covers the deployed build:
//   - add `viewport-fit=cover` so `env(safe-area-inset-*)` becomes non-zero
//   - size #root to the *dynamic* viewport (`100dvh`) so it fits within the
//     address/tool bars, with the old `-webkit-fill-available` fallback
//   - pad #root by the safe-area insets so nothing sits under the notch/indicator
// No-op on native.
if (Platform.OS === "web" && typeof document !== "undefined") {
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp && !/viewport-fit/i.test(vp.getAttribute("content") || "")) {
    vp.setAttribute("content", `${vp.getAttribute("content")}, viewport-fit=cover`);
  }

  if (!document.getElementById("pit-safe-area")) {
    const el = document.createElement("style");
    el.id = "pit-safe-area";
    el.textContent = `
      html, body { height: 100%; margin: 0; background: #07090F; }
      #root {
        height: 100vh;                     /* fallback for old browsers */
        height: 100dvh;                    /* fit within Safari's toolbars */
        min-height: -webkit-fill-available; /* iOS < 15.4 fallback */
        padding-top: env(safe-area-inset-top);
        padding-bottom: env(safe-area-inset-bottom);
        padding-left: env(safe-area-inset-left);
        padding-right: env(safe-area-inset-right);
        box-sizing: border-box;
      }
    `;
    document.head.appendChild(el);
  }
}
