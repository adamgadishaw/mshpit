import { ActivityIndicator, View, Text, StyleSheet, Pressable } from "react-native";
import { colors, displayFont, focusRing, radius, shadow, space } from "../theme";
import Icon from "./Icon";

// One consistent modal/detail header with REAL buttons instead of stray text.
// - leading round button: chevron (onBack) or × (onClose)
// - centered title
// - optional trailing action pill (e.g. Save), or a matching spacer to keep the
//   title centered.
export default function SheetHeader({ title, onClose, onBack, action, leadDisabled = false, leadHint }) {
  const lead = onBack || onClose;
  const actionBlocked = !!action?.disabled || !!action?.loading;
  return (
    <View style={styles.wrap}>
      <Pressable
        style={({ pressed, focused }) => [styles.lead, leadDisabled && styles.leadOff, pressed && !leadDisabled && styles.controlPressed, focused && focusRing]}
        onPress={leadDisabled ? undefined : lead}
        disabled={leadDisabled}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={onBack ? "Back" : "Close"}
        accessibilityHint={leadHint}
        accessibilityState={{ disabled: leadDisabled }}
      >
        <Icon name={onBack ? "chevron-left" : "x"} size={20} color={colors.text} strokeWidth={2.4} />
      </Pressable>

      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>

      {action ? (
        <Pressable
          style={({ pressed, focused }) => [styles.action, actionBlocked && styles.actionOff, pressed && !actionBlocked && styles.actionPressed, focused && focusRing]}
          onPress={actionBlocked ? undefined : action.onPress}
          disabled={actionBlocked}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityHint={action.hint}
          accessibilityState={{ disabled: actionBlocked, busy: !!action.loading }}
        >
          {action.loading ? <ActivityIndicator size="small" color={colors.textFaint} /> : null}
          <Text style={[styles.actionTxt, actionBlocked && styles.actionTxtOff]}>{action.label}</Text>
        </Pressable>
      ) : (
        <View style={styles.spacer} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: space(4), paddingTop: space(1.5), paddingBottom: space(3), borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  lead: { width: 44, height: 44, borderRadius: radius.sm, borderCurve: "continuous", backgroundColor: colors.surfaceAlt, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.line, alignItems: "center", justifyContent: "center", ...shadow.control },
  leadOff: { opacity: 0.5 },
  controlPressed: { transform: [{ translateY: 2 }], boxShadow: "inset 0 1px 3px rgba(0,0,0,0.18)" },
  title: { flex: 1, color: colors.text, fontFamily: displayFont, fontSize: 17, fontWeight: "800", letterSpacing: -0.25, textAlign: "center" },
  spacer: { minWidth: 44 },
  action: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: colors.amberStrong, borderRadius: radius.pill, borderWidth: 1, borderBottomWidth: 3, borderColor: colors.amber, borderBottomColor: colors.accentEdge, paddingHorizontal: 16, paddingVertical: 9, ...shadow.control },
  actionPressed: { transform: [{ translateY: 2 }], boxShadow: "inset 0 1px 3px rgba(0,0,0,0.18)" },
  actionOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  actionTxt: { color: "#1A1206", fontFamily: displayFont, fontSize: 14, fontWeight: "800" },
  actionTxtOff: { color: colors.textFaint },
});
