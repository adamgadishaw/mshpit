import { useState } from "react";
import { Pressable, Text, StyleSheet, View } from "react-native";
import { colors, radius } from "../theme";
import Icon from "./Icon";

// Cleaner, slightly 3D buttons: a raised face with a darker bottom edge + soft
// glow that presses in on tap. variant: primary | secondary | danger.
export default function Button({ title, onPress, variant = "primary", icon, disabled, style, small }) {
  const [pressed, setPressed] = useState(false);
  const v = VARIANTS[variant];
  return (
    <Pressable
      onPress={disabled ? null : onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.base,
        small && styles.small,
        { backgroundColor: v.bg, borderBottomColor: v.edge, shadowColor: v.glow },
        pressed && styles.pressed,
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
  primary: { bg: colors.amberStrong, edge: "#B65E1F", fg: "#1A1206", glow: colors.amberStrong },
  secondary: { bg: colors.surfaceAlt, edge: colors.line, fg: colors.text, glow: "#000" },
  danger: { bg: colors.magenta, edge: "#9E2B57", fg: "#fff", glow: colors.magenta },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 15,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 3,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  small: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.sm, borderBottomWidth: 2 },
  pressed: { transform: [{ translateY: 2 }], borderBottomWidth: 1, shadowOpacity: 0.15 },
  disabled: { opacity: 0.4 },
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  txt: { fontSize: 15, fontWeight: "800", letterSpacing: 0.3 },
  txtSmall: { fontSize: 13 },
});
