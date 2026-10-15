import { useEffect, useState } from "react";
import { View, Text, Pressable } from "react-native";
import { colors } from "../../theme";

export default function PublicNavigationNotice({ notice, retryAt, onRetry, onCancel }) {
  const [, repaint] = useState(0);
  const coolingDown = !!notice.directoryUnavailable && retryAt > Date.now();
  useEffect(() => {
    if (!coolingDown) return undefined;
    const timer = setTimeout(() => repaint(value => value + 1), Math.max(1, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [coolingDown, retryAt]);
  return (
    <View accessibilityLiveRegion="polite" style={{ padding: 12, backgroundColor: colors.bgElev, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Text style={{ flex: 1, color: colors.text }}>{notice.loading ? "Opening page…" : notice.message || "This artist or profile could not be opened."}</Text>
      {!notice.loading && <Pressable accessibilityRole="button" disabled={coolingDown} accessibilityState={{ disabled: coolingDown }} onPress={onRetry} style={{ padding: 10 }}><Text style={{ color: colors.amber }}>{coolingDown ? "Try again later" : "Try again"}</Text></Pressable>}
      <Pressable accessibilityRole="button" onPress={onCancel} style={{ padding: 10 }}><Text style={{ color: colors.text }}>Cancel</Text></Pressable>
    </View>
  );
}
