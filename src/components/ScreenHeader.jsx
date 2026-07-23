import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, displayFont, focusRing, mono, radius, shadow, space } from "../theme";
import Icon from "./Icon";

// Prominent, consistent header for detail screens: a round back button and a
// bold title card. Optional `kicker` (small label above) and `right` slot.
export default function ScreenHeader({ title, kicker, onBack, right }) {
  return (
    <View style={styles.wrap}>
      <Pressable style={({ pressed, focused }) => [styles.back, pressed && styles.backPressed, focused && focusRing]} onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel="Go back">
        <Icon name="chevron-left" size={22} color={colors.text} strokeWidth={2.4} />
      </Pressable>
      <View style={styles.titleBox}>
        {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
      </View>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space(4), paddingTop: space(1), paddingBottom: space(3), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  back: { width: 42, height: 42, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.line, alignItems: "center", justifyContent: "center", ...shadow.control },
  backPressed: { transform: [{ translateY: 2 }], boxShadow: "inset 0 1px 3px rgba(0,0,0,0.18)" },
  titleBox: { flex: 1 },
  kicker: { color: colors.amber, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", fontFamily: mono, marginBottom: 1 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 20, fontWeight: "800", letterSpacing: -0.35 },
  right: { minWidth: 40, alignItems: "flex-end" },
});
