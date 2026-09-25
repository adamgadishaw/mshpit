import { Pressable, StyleSheet, Text, View } from "react-native";

import Icon from "../Icon";
import { colors, displayFont, radius, space } from "../../theme";

// The show swipe, at the top of Discover's shows tab.
export default function CrewBanner({ onPress, compact = false }) {
  return (
    <Pressable style={({ pressed }) => [styles.banner, compact && styles.compact, pressed && styles.pressed]} onPress={onPress}
      accessibilityRole="button" accessibilityLabel="Show swipe. Flip through upcoming shows and build your concert calendar.">
      <View style={styles.faces} aria-hidden>
        <View style={[styles.face, { backgroundColor: colors.amberStrong }]}><Icon name="ticket" size={18} color="#1A1206" /></View>
        <View style={[styles.face, styles.faceOverlap, { backgroundColor: colors.surfaceAlt }]}><Icon name="calendar" size={16} color={colors.amber} /></View>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.kicker}>SHOW SWIPE</Text>
        <Text style={[styles.title, compact && styles.titleCompact]}>Find your next show</Text>
        <Text style={styles.detail}>Flip through upcoming concerts near you. Right for going, up for interested, left to skip.</Text>
      </View>
      <View style={styles.cta}><Text style={styles.ctaText}>Start swiping</Text><Icon name="chevron-right" size={15} color="#1A1206" /></View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space(4), padding: space(5), marginBottom: space(4),
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.accentEdge || colors.amber, backgroundColor: colors.surface,
  },
  compact: { padding: space(4), gap: space(3) },
  pressed: { opacity: 0.88 },
  faces: { flexDirection: "row" },
  face: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.surface },
  faceOverlap: { marginLeft: -12 },
  kicker: { color: colors.amber, fontSize: 11, fontWeight: "900", letterSpacing: 1.2 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 24, fontWeight: "900", marginTop: 2 },
  titleCompact: { fontSize: 20 },
  detail: { color: colors.textDim, fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  cta: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.amberStrong },
  ctaText: { color: "#1A1206", fontWeight: "900", fontSize: 14 },
});
