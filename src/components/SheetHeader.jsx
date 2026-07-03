import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, radius } from "../theme";
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
        style={styles.lead}
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
          style={[styles.action, action.disabled && styles.actionOff]}
          onPress={action.disabled ? undefined : action.onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
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
  wrap: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  lead: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  title: { flex: 1, color: colors.text, fontSize: 17, fontWeight: "800", letterSpacing: -0.2, textAlign: "center" },
  spacer: { minWidth: 40 },
  action: { backgroundColor: colors.amberStrong, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 9 },
  actionOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  actionTxt: { color: "#1A1206", fontSize: 14, fontWeight: "800" },
  actionTxtOff: { color: colors.textFaint },
});
