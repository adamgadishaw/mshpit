import { useState } from "react";
import { Platform, Pressable, Text, StyleSheet, View } from "react-native";
import { colors, displayFont, focusRing, radius, shadow } from "../theme";
import Icon from "./Icon";

// Cleaner, slightly 3D buttons: a raised face with a darker bottom edge + soft
// glow that presses in on tap. variant: primary | secondary | danger.
export default function Button({ title, onPress, variant = "primary", icon, disabled, style, small }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={disabled ? null : onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        { backgroundColor: v.bg, borderColor: v.border, borderBottomColor: v.edge },
        shadow.control,
        hovered && !pressed && !disabled && styles.hovered,
        focused && focusRing,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.inner}>
        {icon ? <Icon name={icon} size={small ? 15 : 17} color={v.fg} strokeWidth={2.4} /> : null}
        <Text style={[styles.txt, small && styles.txtSmall, { color: v.fg }]}>{title}</Text>
      </View>
    </Pressable>
  );
}

const VARIANTS = {
  primary: { bg: colors.amberStrong, edge: colors.accentEdge, border: colors.amber, fg: "#1A1206" },
  secondary: { bg: colors.surfaceAlt, edge: colors.line, border: colors.line, fg: colors.text },
  danger: { bg: colors.magenta, edge: "#8D284E", border: colors.danger, fg: "#fff" },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderCurve: "continuous",
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderBottomWidth: 4,
    minHeight: 50,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "120ms", transitionProperty: "filter, transform, box-shadow" } }),
  },
  small: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: radius.sm, borderBottomWidth: 3, minHeight: 40 },
  hovered: { transform: [{ translateY: -1 }], ...Platform.select({ web: { filter: "brightness(1.06)" } }) },
  pressed: { transform: [{ translateY: 3 }], boxShadow: "inset 0 1px 3px rgba(0,0,0,0.18), 0 1px 2px rgba(0,0,0,0.14)" },
  disabled: { opacity: 0.42, ...Platform.select({ web: { cursor: "not-allowed" } }) },
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  txt: { fontFamily: displayFont, fontSize: 15, fontWeight: "800", letterSpacing: 0.15, lineHeight: 20 },
  txtSmall: { fontSize: 13 },
});
