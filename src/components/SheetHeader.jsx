import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, displayFont, focusRing, radius, shadow, space } from "../theme";
import Icon from "./Icon";

// One consistent modal/detail header with REAL buttons instead of stray text.
// - leading round button: chevron (onBack) or × (onClose)
// - centered title
// - optional trailing action pill (e.g. Save), or a matching spacer to keep the
//   title centered.
export default function SheetHeader({ title, onClose, onBack, action }) {
  const lead = onBack || onClose;
  return (
    <View style={styles.wrap}>
      <Pressable
        style={({ pressed, focused }) => [styles.lead, pressed && styles.controlPressed, focused && focusRing]}
        onPress={lead}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={onBack ? "Back" : "Close"}
      >
        <Icon name={onBack ? "chevron-left" : "x"} size={20} color={colors.text} strokeWidth={2.4} />
      </Pressable>

      <Text style={styles.title} numberOfLines={1}>{title}</Text>

      {action ? (
        <Pressable
          style={({ pressed, focused }) => [styles.action, action.disabled && styles.actionOff, pressed && !action.disabled && styles.actionPressed, focused && focusRing]}
          onPress={action.disabled ? undefined : action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: !!action.disabled }}
        >
          <Text style={[styles.actionTxt, action.disabled && styles.actionTxtOff]}>{action.label}</Text>
        </Pressable>
      ) : (
        <View style={styles.spacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space(4), paddingTop: space(1.5), paddingBottom: space(3), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  lead: { width: 42, height: 42, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.line, alignItems: "center", justifyContent: "center", ...shadow.control },
  controlPressed: { transform: [{ translateY: 2 }], boxShadow: "inset 0 1px 3px rgba(0,0,0,0.18)" },
  title: { flex: 1, color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "800", letterSpacing: -0.25, textAlign: "center" },
  spacer: { minWidth: 42 },
  action: { backgroundColor: colors.amberStrong, borderRadius: radius.pill, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.amber, borderBottomColor: colors.accentEdge, paddingHorizontal: 16, paddingVertical: 9, ...shadow.control },
  actionPressed: { transform: [{ translateY: 2 }], boxShadow: "inset 0 1px 3px rgba(0,0,0,0.18)" },
  actionOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  actionTxt: { color: "#1A1206", fontFamily: displayFont, fontSize: 14, fontWeight: "800" },
  actionTxtOff: { color: colors.textFaint },
});
