import { Component } from "react";
import { View, Text, StyleSheet, Pressable, Platform, ScrollView } from "react-native";
import { colors, mono, radius } from "../theme";
import { captureAppError } from "../lib/diagnostics";

// App-wide crash net. React unmounts a subtree when a render throws; without this
// the user gets a blank/white screen and a refresh just re-runs the same crash
// (especially if it came from bad persisted state). This catches the error and
// offers three escape hatches, retry, reload, and a hard reset that clears the
// local data most likely to be the culprit, so a crash is never a dead end.
export default class ErrorBoundary extends Component {
  state = { error: null, appError: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (__DEV__) console.error("[pit] uncaught render error:", error, info?.componentStack);
    const appError = captureAppError(error, {
      code: "PIT-APP-001",
      context: "Rendering the current screen",
      source: "react-boundary",
      toast: false,
    });
    this.setState({ appError });
  }

  retry = () => this.setState({ error: null, appError: null });

  reload = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") window.location.reload();
    else this.retry();
  };

  // Clear the local state most likely to have caused a load-time crash (theme +
  // hydrated store), keeping nothing that can re-trigger it. Session included so a
  // corrupt user object can't wedge the app, worst case the user logs back in.
  reset = () => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        ["pit_theme", "pit_theme_owner", "pit.session", "pit.users", "pit.feed", "pit.follows", "pit.entered"].forEach((k) => window.localStorage.removeItem(k));
      }
    } catch {}
    this.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.wrap}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.brand}>PIT</Text>
          <Text style={styles.title}>The night hit a snag</Text>
          <Text style={styles.sub}>
            Something crashed on our end. Your data is safe, try again, and if it keeps
            happening, reset the app to get moving.
          </Text>
          <Text style={styles.reference} selectable>
            {this.state.appError?.code || "PIT-APP-001"}{this.state.appError?.requestId ? ` / ${this.state.appError.requestId}` : ""}
          </Text>

          <Pressable style={styles.primary} onPress={this.retry}>
            <Text style={styles.primaryTxt}>Try again</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={this.reload}>
            <Text style={styles.ghostTxt}>Reload the app</Text>
          </Pressable>
          <Pressable style={styles.ghost} onPress={this.reset}>
            <Text style={styles.ghostTxt}>Reset app data</Text>
          </Pressable>

          {__DEV__ && this.state.error ? (
            <Text style={styles.detail} numberOfLines={6}>{String(this.state.error?.message || this.state.error)}</Text>
          ) : null}
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  content: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 12 },
  brand: { color: colors.amber, fontFamily: mono, fontSize: 24, fontWeight: "900", letterSpacing: 6, marginBottom: 8 },
  title: { color: colors.text, fontSize: 24, fontWeight: "900", textAlign: "center" },
  sub: { color: colors.textDim, fontSize: 15, lineHeight: 22, textAlign: "center", maxWidth: 420, marginBottom: 14 },
  reference: { color: colors.amber, fontFamily: mono, fontSize: 11, marginBottom: 8 },
  primary: { backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 34, paddingVertical: 15, marginTop: 4 },
  primaryTxt: { color: "#1A1206", fontSize: 16, fontWeight: "900" },
  ghost: { borderRadius: radius.pill, borderWidth: 1.5, borderColor: colors.line, paddingHorizontal: 26, paddingVertical: 13 },
  ghostTxt: { color: colors.text, fontSize: 15, fontWeight: "700" },
  detail: { color: colors.textFaint, fontFamily: mono, fontSize: 11, marginTop: 18, maxWidth: 460, textAlign: "center" },
});
