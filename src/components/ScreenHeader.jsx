import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, mono, radius } from "../theme";
import Icon from "./Icon";

// Prominent, consistent header for detail screens: a round back button and a
// bold title card. Optional `kicker` (small label above) and `right` slot.
export default function ScreenHeader({ title, kicker, onBack, right }) {
  return (
    <View style={styles.wrap}>
      <Pressable style={styles.back} onPress={onBack} hitSlop={10}>
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
  wrap: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  back: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: "center", justifyContent: "center" },
  titleBox: { flex: 1 },
  kicker: { color: colors.amber, fontSize: 10, letterSpacing: 1.5, fontWeight: "800", fontFamily: mono, marginBottom: 1 },
  title: { color: colors.text, fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  right: { minWidth: 40, alignItems: "flex-end" },
});
