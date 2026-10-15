import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// expo-video 57.0.5 resets only the icon after fullscreen. Media3 also owns
// the toggle state and accessibility label; reset all three through its API.
// The setter invokes the listener, so update state with navigation detached.
export function patchExpoVideoAndroid() {
  const base = new URL("../node_modules/expo-video/", import.meta.url);
  const version = JSON.parse(readFileSync(new URL("package.json", base), "utf8")).version;
  if (version !== "57.0.5") throw new Error("Review the Android fullscreen workaround for expo-video " + version);
  const sources = [
  [
    "VideoView.kt",
    "    val fullScreenButton: ImageButton = playerView.findViewById(androidx.media3.ui.R.id.exo_fullscreen)\n    fullScreenButton.setImageResource(androidx.media3.ui.R.drawable.exo_icon_fullscreen_enter)",
    "    playerView.setFullscreenButtonClickListener(null)\n    playerView.setFullscreenButtonState(false)\n    if (fullscreenOptions.enable && allowsFullscreen) {\n      playerView.setFullscreenButtonClickListener { enterFullscreen() }\n    }"
  ],
  [
    "FullscreenPlayerActivity.kt",
    "    playerView.setFullscreenButtonClickListener { finish() }\n\n    val fullScreenButton: ImageButton = playerView.findViewById(androidx.media3.ui.R.id.exo_fullscreen)\n    fullScreenButton.setImageResource(androidx.media3.ui.R.drawable.exo_icon_fullscreen_exit)",
    "    playerView.setFullscreenButtonState(true)\n    playerView.setFullscreenButtonClickListener { finish() }"
  ]
];
  for (const [name, before, after] of sources) {
    const path = fileURLToPath(new URL("android/src/main/java/expo/modules/video/" + name, base));
    const source = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    if (source.includes(after)) continue;
    if (!source.includes(before)) throw new Error("Fullscreen workaround source changed: " + name);
    writeFileSync(path, source.replace(before, after));
  }
}
