import { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, font } from "../theme";
import Icon from "./Icon";
export default function ScreenHeader({ title, kicker, onBack, right, backLabel = "Go back", backHint }) {
  const [rightWidth, setRightWidth] = useState(44);
  return <View style={styles.wrap}>
    <View style={[styles.leading, { width: rightWidth }]}>
      <Pressable style={({ pressed }) => [styles.back, pressed && styles.pressed]} onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel} accessibilityHint={backHint}><Icon name="chevron-left" size={27} color={colors.amber} strokeWidth={2} /></Pressable>
    </View>
    <View style={styles.titleBox}>{kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}<Text style={styles.title} numberOfLines={2} accessibilityRole="header">{title}</Text></View>
    {/* Measure the natural action width so a busy label can grow and shrink. */}
    <View style={styles.right} onLayout={event => setRightWidth(Math.max(44, event.nativeEvent.layout.width))}>{right}</View>
  </View>;
}
const styles = StyleSheet.create({
  wrap: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft },
  leading: { flexShrink: 0, alignItems: "flex-start" },
  back: { width: 44, minHeight: 44, justifyContent: "center", alignItems: "center" },
  pressed: { opacity: 0.65 },
  titleBox: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontFamily: font, fontSize: 17, lineHeight: 22, fontWeight: "600", textAlign: "center" },
  kicker: { color: colors.textDim, fontSize: 11, textAlign: "center", marginBottom: 1 },
  right: { flexShrink: 0, minWidth: 44, maxWidth: "35%", alignItems: "flex-end" },
});
