import { View, Text, StyleSheet, Pressable } from "react-native";
import { colors, font } from "../theme";
import Icon from "./Icon";
export default function ScreenHeader({ title, kicker, onBack, right, backLabel = "Go back", backHint }) {
  return <View style={styles.wrap}>
    <Pressable style={styles.back} onPress={onBack} accessibilityRole="button" accessibilityLabel={backLabel} accessibilityHint={backHint}><Icon name="chevron-left" size={27} color={colors.amber} strokeWidth={2} /></Pressable>
    <View style={styles.titleBox}>{kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}<Text style={styles.title} numberOfLines={2} accessibilityRole="header">{title}</Text></View>
    <View style={styles.right}>{right}</View>
  </View>;
}
const styles = StyleSheet.create({ wrap: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.bg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.lineSoft }, back: { minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }, titleBox: { flex: 1, minWidth: 0 }, title: { color: colors.text, fontFamily: font, fontSize: 17, lineHeight: 22, fontWeight: "600", textAlign: "center" }, kicker: { color: colors.textDim, fontSize: 11, textAlign: "center", marginBottom: 1 }, right: { minWidth: 44, alignItems: "flex-end" } });
