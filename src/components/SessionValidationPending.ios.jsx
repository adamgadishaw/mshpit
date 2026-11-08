import { useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { colors } from "../theme";

const subscribe = () => () => {};
const getSnapshot = () => null;

// No network, timers, account details, or identity decisions live in this view.
export default function SessionValidationPending({ status }) {
  const state = useSyncExternalStore(status?.subscribe || subscribe, status?.getSnapshot || getSnapshot, getSnapshot);
  const unavailable = state?.phase === "unavailable" || state?.phase === "waiting";
  const waiting = state?.phase === "waiting";
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      {!unavailable ? <ActivityIndicator size="small" color={colors.amber} accessibilityLabel="Checking your sign-in status" /> : null}
      <Text style={styles.title} accessibilityRole="header">{unavailable ? "MSHPIT couldn’t finish loading" : "Checking your sign-in status…"}</Text>
      <Text style={styles.copy} accessibilityLiveRegion="polite">{unavailable
        ? waiting ? "A retry is scheduled. We’ll check your sign-in status again automatically." : "We couldn’t confirm your sign-in status. We’ll try again automatically."
        : "Please wait while we check your sign-in status."}</Text>
      {unavailable ? <Pressable onPress={state?.retry} disabled={!state?.retry}
        accessibilityRole="button" accessibilityLabel="Retry loading MSHPIT"
        accessibilityState={{ disabled: !state?.retry }} style={styles.retry}>
        <Text style={styles.retryText}>{waiting ? "Retry scheduled" : "Retry"}</Text>
      </Pressable> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  container: { flexGrow: 1, justifyContent: "center", alignItems: "center", padding: 28, gap: 14 },
  title: { color: colors.text, fontSize: 21, fontWeight: "700", textAlign: "center" },
  copy: { color: colors.textDim, fontSize: 16, lineHeight: 24, textAlign: "center", maxWidth: 340 },
  retry: { minWidth: 120, minHeight: 44, paddingHorizontal: 22, paddingVertical: 12, justifyContent: "center", alignItems: "center", borderWidth: 1, borderColor: colors.amber, borderRadius: 12 },
  retryText: { color: colors.amber, fontSize: 16, fontWeight: "600", textAlign: "center" },
});
