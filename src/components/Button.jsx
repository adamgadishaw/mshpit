import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, StyleSheet, View } from "react-native";
import { colors, displayFont, focusRing, isKeyboardFocus, radius } from "../theme";
import Icon from "./Icon";
import { CredentialSubmit } from "./credential-form";

// Flat, crisp buttons: a solid face with a hairline top light, a quiet hover
// and a small press-in on tap. variant: primary | secondary | danger.
export default function Button({
  title,
  onPress,
  variant = "primary",
  icon,
  disabled,
  loading = false,
  accessibilityLabel = title,
  accessibilityHint,
  style,
  small,
  submit = false,
}) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const v = VARIANTS[variant];
  const blocked = !!disabled || loading;
  const Control = submit ? CredentialSubmit : Pressable;
  return (
    <Control
      onPress={blocked ? null : onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      onFocus={(event) => setFocused(isKeyboardFocus(event))}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      style={({ pressed }) => [
        styles.base,
        small && styles.small,
        { backgroundColor: v.bg, borderColor: v.border },
        v.lift,
        hovered && !pressed && !blocked && styles.hovered,
        focused && focusRing,
        pressed && !blocked && styles.pressed,
        blocked && styles.disabled,
        style,
      ]}
    >
      <View style={styles.inner}>
        {loading ? <ActivityIndicator size="small" color={v.fg} /> : icon ? <Icon name={icon} size={small ? 15 : 17} color={v.fg} strokeWidth={2.4} /> : null}
        <Text style={[styles.txt, small && styles.txtSmall, { color: v.fg }]}>{title}</Text>
      </View>
    </Control>
  );
}

const lift = (top) => Platform.select({ web: { boxShadow: `inset 0 1px 0 ${top}, 0 1px 2px rgba(0,0,0,0.28)` }, default: {} });
const VARIANTS = {
  primary: { bg: colors.amberStrong, border: colors.amberStrong, fg: "#1A1206", lift: lift("rgba(255,255,255,0.28)") },
  secondary: { bg: colors.surface, border: colors.line, fg: colors.text, lift: lift("rgba(255,255,255,0.05)") },
  danger: { bg: colors.magenta, border: colors.magenta, fg: "#fff", lift: lift("rgba(255,255,255,0.22)") },
};

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.sm + 2,
    borderCurve: "continuous",
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    minHeight: 48,
    ...Platform.select({ web: { cursor: "pointer", transitionDuration: "140ms", transitionProperty: "filter, transform, background-color, border-color" } }),
  },
  small: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.sm, minHeight: 44 },
  hovered: Platform.select({ web: { filter: "brightness(1.08)" }, default: {} }),
  pressed: { transform: [{ scale: 0.98 }], ...Platform.select({ web: { filter: "brightness(0.94)" }, default: { opacity: 0.9 } }) },
  disabled: { opacity: 0.42, ...Platform.select({ web: { cursor: "not-allowed" } }) },
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  txt: { fontFamily: displayFont, fontSize: 15, fontWeight: "700", letterSpacing: 0.1, lineHeight: 20 },
  txtSmall: { fontSize: 13.5 },
});
