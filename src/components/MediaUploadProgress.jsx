import { StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { mediaUploadProgressCopy } from "../domain/mediaTransferProgress.mjs";
export default function MediaUploadProgress({ progress }) {
  const label = mediaUploadProgressCopy(progress), fraction = Math.min(1, Math.max(0, Number(progress?.fraction) || 0));
  return <View style={styles.copy} accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100), text: label }}>
    <Text style={styles.text}>{label}</Text>
    <View style={styles.track}><View style={[styles.fill, { width: `${fraction * 100}%` }]} /></View>
  </View>;
}
const styles = StyleSheet.create({ copy: { flex: 1, gap: 6 }, text: { color: colors.textDim, fontSize: 12.5, lineHeight: 18 }, track: { height: 4, overflow: "hidden", borderRadius: 2, backgroundColor: colors.lineSoft }, fill: { height: "100%", borderRadius: 2, backgroundColor: colors.amber } });
