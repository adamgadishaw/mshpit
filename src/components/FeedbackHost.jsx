import { useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, mono, radius } from "../theme";
import { subscribeFeedback } from "../lib/diagnostics";
import Icon from "./Icon";

const severityColor = (severity) => {
  if (severity === "fatal" || severity === "error") return colors.danger;
  if (severity === "warning") return colors.gold;
  return colors.cool;
};

export default function FeedbackHost({ onOpenDiagnostics }) {
  const [entry, setEntry] = useState(null);

  useEffect(() => subscribeFeedback(setEntry), []);
  useEffect(() => {
    if (!entry) return undefined;
    const timer = setTimeout(() => setEntry(null), 7000);
    return () => clearTimeout(timer);
  }, [entry]);

  if (!entry) return null;
  const accent = severityColor(entry.severity);

  return (
    <View style={[styles.host, styles.hostPointerEvents]}>
      <View style={[styles.card, { borderColor: accent }]} accessibilityRole="alert">
        <View style={[styles.signal, { backgroundColor: accent }]} />
        <View style={styles.icon}>
          <Icon name="music" size={18} color={accent} strokeWidth={2.2} />
        </View>
        <View style={styles.copy}>
          <View style={styles.heading}>
            <Text style={styles.title} numberOfLines={1}>{entry.title}</Text>
            <Text style={[styles.code, { color: accent }]}>{entry.code}</Text>
          </View>
          <Text style={styles.message}>{entry.message}</Text>
          <Pressable
            onPress={() => { setEntry(null); onOpenDiagnostics?.(); }}
            accessibilityRole="button"
            accessibilityLabel={`View diagnostics for ${entry.code}`}
            hitSlop={6}
          >
            <Text style={[styles.details, { color: accent }]}>View failure details</Text>
          </Pressable>
        </View>
        <Pressable style={styles.close} onPress={() => setEntry(null)} accessibilityRole="button" accessibilityLabel="Dismiss error message" hitSlop={8}>
          <Icon name="x" size={16} color={colors.textDim} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: Platform.OS === "web" ? 70 : 12,
    left: 14,
    right: 14,
    zIndex: 500,
    alignItems: "flex-end",
    ...(Platform.OS === "web" ? { position: "fixed" } : null),
  },
  card: {
    width: "100%",
    maxWidth: 430,
    minHeight: 96,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: 14,
    paddingLeft: 17,
    ...(Platform.OS === "web"
      ? { boxShadow: "0 8px 18px rgba(0,0,0,0.28)" }
      : { shadowColor: "#000", shadowOpacity: 0.28, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12 }),
  },
  hostPointerEvents: { pointerEvents: "box-none" },
  signal: { position: "absolute", left: 0, top: 0, bottom: 0, width: 4 },
  icon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 4 },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: colors.text, fontSize: 14.5, fontWeight: "900" },
  code: { fontFamily: mono, fontSize: 10.5, fontWeight: "800" },
  message: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 },
  details: { fontSize: 12, fontWeight: "800", marginTop: 2 },
  close: { width: 26, height: 26, alignItems: "center", justifyContent: "center", marginTop: -5, marginRight: -5 },
});
