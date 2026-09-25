import { useState } from "react";
import { View, Text, StyleSheet, Pressable, Platform } from "react-native";
import { colors, displayFont, focusRing, font, isKeyboardFocus, radius, space } from "../theme";
import Icon from "./Icon";

// Prominent, consistent header for detail screens: a round back button and a
// bold title card. Optional `kicker` (small label above) and `right` slot.
export default function ScreenHeader({ title, kicker, onBack, right, backLabel = "Go back", backHint }) {
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  return (
    <View style={styles.wrap}>
      <Pressable style={({ pressed, hovered }) => [styles.back, hovered && styles.backHovered, pressed && styles.backPressed, keyboardFocus && focusRing]}
        onFocus={(event) => setKeyboardFocus(isKeyboardFocus(event))} onBlur={() => setKeyboardFocus(false)}
        onPress={onBack} hitSlop={10} accessibilityRole="button" accessibilityLabel={backLabel} accessibilityHint={backHint}>
        <Icon name="chevron-left" size={22} color={colors.text} strokeWidth={2.4} />
      </Pressable>
      <View style={styles.titleBox}>
        {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
      </View>
      <View style={styles.right}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space(4), paddingTop: space(1), paddingBottom: space(3), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  back: { width: 44, height: 44, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center",
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "140ms", transitionProperty: "background-color, transform" } }) },
  backHovered: { backgroundColor: colors.surfaceAlt },
  backPressed: { transform: [{ scale: 0.96 }] },
  titleBox: { flex: 1 },
  kicker: { color: colors.textDim, fontFamily: font, fontSize: 12, fontWeight: "700", marginBottom: 1 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 20, fontWeight: "800", letterSpacing: -0.35 },
  right: { minWidth: 40, alignItems: "flex-end" },
});
