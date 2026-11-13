import { StyleSheet, Text, View } from "react-native";
import { colors, mono } from "../theme";
import BrandMark from "./BrandMark";

// A quiet signature in normal flow, never a watermark over authored media or controls.
export default function PostBrand({ color = colors.textFaint }) {
  return <View testID="post-brand" pointerEvents="none" style={styles.row}>
    <BrandMark size={18} color={color} />
    <Text style={[styles.wordmark, { color }]}>MSHPIT</Text>
  </View>;
}

const styles = StyleSheet.create({
  row: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, maxWidth: "100%" },
  wordmark: { fontFamily: mono, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, flexShrink: 1 },
});
