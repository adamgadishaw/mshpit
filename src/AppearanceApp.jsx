import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { prepareSavedTheme } from "./lib/appearanceStartup";

// Register the native root immediately, but do not evaluate static theme styles
// until any restricted saved appearance has been checked against live authority.
let application;
function loadApplication() {
  if (!application) application = prepareSavedTheme()
    // Delayed evaluation, not a second eagerly fetched startup chunk. Keeping
    // App in the entry graph also keeps the initial-JS budget honest.
    .then(() => require("../App")).catch(error => { application = null; throw error; });
  return application;
}

export default function AppearanceApp() {
  const [loaded, setLoaded] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    loadApplication().then(module => { if (active) setLoaded(() => module.default); })
      .catch(() => { if (active) { setFailed(true); globalThis.__MSHPIT_WEB_BOOT__?.complete?.(); } });
    return () => { active = false; };
  }, [attempt]);
  if (loaded) { const Application = loaded; return <Application />; }
  // Deliberately independent of theme.js: this is the pre-authorization shell.
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
    {failed ? <Pressable accessibilityRole="button" onPress={() => { setFailed(false); setAttempt(value => value + 1); }}>
      <Text>Try loading mshpit again</Text>
    </Pressable> : <ActivityIndicator accessibilityLabel="Loading mshpit" />}
  </View>;
}
