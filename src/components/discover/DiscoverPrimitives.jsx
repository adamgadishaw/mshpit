import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, font, mono, radius, shadow } from "../../theme";
import Icon from "../Icon";
import { compactDiscoverNumber } from "../../domain/discoverView.mjs";

export function SectionHeading({ eyebrow, title, detail, action }) {
  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionHeadingCopy}>
        {!!eyebrow && <Text style={styles.sectionEyebrow}>{eyebrow}</Text>}
        <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
        {!!detail && <Text style={styles.sectionDetail}>{detail}</Text>}
      </View>
      {action}
    </View>
  );
}

export function QuickAction({ icon, title, detail, tint, onPress, basis }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.quickAction, { flexBasis: basis }, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityHint={detail}
    >
      <View style={[styles.quickIcon, { backgroundColor: `${tint}18`, borderColor: `${tint}55` }]}>
        <Icon name={icon} size={20} color={tint} />
      </View>
      <View style={styles.quickCopy}>
        <Text style={styles.quickTitle}>{title}</Text>
        <Text style={styles.quickDetail} numberOfLines={2}>{detail}</Text>
      </View>
      <Icon name="chevron-right" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

export function MetricTile({ label, value, tint, compact }) {
  return (
    <View style={[styles.metricTile, compact && styles.metricTileCompact]} accessible accessibilityLabel={`${Number(value || 0).toLocaleString()} ${label}`}>
      <Text style={[styles.metricValue, { color: tint }]}>{compactDiscoverNumber(value)}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function OverviewState({ state, region, onRetry, onWorldwide }) {
  if (state === "loading") {
    return (
      <View style={styles.statePanel} accessibilityLiveRegion="polite" accessibilityLabel="Loading Discover">
        <ActivityIndicator color={colors.amber} size="small" />
        <Text style={styles.stateTitle}>Tuning the scene</Text>
        <Text style={styles.stateCopy}>Loading charts, genres, and regional signals together.</Text>
      </View>
    );
  }
  if (state === "error") {
    return (
      <View style={[styles.statePanel, styles.errorPanel]} accessibilityLiveRegion="assertive">
        <View style={styles.stateIcon}><Icon name="volume-x" size={24} color={colors.danger} /></View>
        <Text style={styles.stateTitle} selectable>Discover could not load</Text>
        <Text style={styles.stateCopy} selectable>Check your connection and try again. Your other Pit screens still work.</Text>
        <Pressable style={styles.primaryButton} onPress={onRetry} accessibilityRole="button" accessibilityLabel="Retry loading Discover">
          <Text style={styles.primaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (state === "empty") {
    return (
      <View style={styles.statePanel} accessibilityLiveRegion="polite">
        <View style={styles.stateIcon}><Icon name="globe" size={24} color={colors.cool} /></View>
        <Text style={styles.stateTitle}>No chart yet for {region}</Text>
        <Text style={styles.stateCopy}>This scene is still taking shape. Try the worldwide view for more artists and genres.</Text>
        {region !== "Worldwide" && (
          <Pressable style={styles.secondaryButton} onPress={onWorldwide} accessibilityRole="button" accessibilityLabel="Show worldwide Discover results">
            <Text style={styles.secondaryButtonText}>Show worldwide</Text>
          </Pressable>
        )}
      </View>
    );
  }
  return null;
}

export const primitiveStyles = StyleSheet.create({
  quickSection: { gap: 10 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  metrics: { flexDirection: "row", gap: 10 },
  metricsCompact: { flexWrap: "wrap" },
});

const styles = StyleSheet.create({
  sectionHeading: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  sectionHeadingCopy: { flex: 1, minWidth: 0 },
  sectionEyebrow: { color: colors.amber, fontFamily: mono, fontSize: 9.5, fontWeight: "900", letterSpacing: 1.4 },
  sectionTitle: { color: colors.text, fontFamily: displayFont, fontSize: 21, lineHeight: 26, fontWeight: "900", letterSpacing: -0.35, paddingTop: 2 },
  sectionDetail: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, paddingTop: 3 },
  quickAction: { flexGrow: 1, minWidth: 0, minHeight: 88, flexDirection: "row", alignItems: "center", gap: 10, padding: 13, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.lineSoft, backgroundColor: colors.surface, ...shadow.card },
  quickIcon: { width: 42, height: 42, borderRadius: 14, borderCurve: "continuous", borderWidth: 1, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  quickCopy: { flex: 1, minWidth: 0 },
  quickTitle: { color: colors.text, fontFamily: font, fontSize: 14, fontWeight: "900" },
  quickDetail: { color: colors.textDim, fontFamily: font, fontSize: 11.5, lineHeight: 16, paddingTop: 2 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
  metricTile: { flex: 1, minWidth: 120, alignItems: "center", justifyContent: "center", minHeight: 80, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.lineSoft },
  metricTileCompact: { flexBasis: "46%", minWidth: 0, minHeight: 68 },
  metricValue: { fontFamily: mono, fontSize: 21, fontWeight: "900", fontVariant: ["tabular-nums"] },
  metricLabel: { color: colors.textFaint, fontFamily: mono, fontSize: 9, fontWeight: "900", letterSpacing: 1.1, textTransform: "uppercase", paddingTop: 4 },
  statePanel: { minHeight: 230, borderRadius: radius.lg, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineSoft, padding: 28, alignItems: "center", justifyContent: "center", gap: 9, ...shadow.card },
  errorPanel: { borderColor: `${colors.danger}55` },
  stateIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.bgElev, alignItems: "center", justifyContent: "center", marginBottom: 3 },
  stateTitle: { color: colors.text, fontFamily: displayFont, fontSize: 18, fontWeight: "900", textAlign: "center" },
  stateCopy: { color: colors.textDim, fontFamily: font, fontSize: 12.5, lineHeight: 18, textAlign: "center", maxWidth: 420 },
  primaryButton: { minHeight: 44, marginTop: 7, paddingHorizontal: 20, borderRadius: radius.pill, backgroundColor: colors.amberStrong, alignItems: "center", justifyContent: "center" },
  primaryButtonText: { color: "#1A1206", fontFamily: font, fontSize: 13, fontWeight: "900" },
  secondaryButton: { minHeight: 44, marginTop: 7, paddingHorizontal: 20, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.amber, alignItems: "center", justifyContent: "center" },
  secondaryButtonText: { color: colors.amber, fontFamily: font, fontSize: 13, fontWeight: "900" },
});
