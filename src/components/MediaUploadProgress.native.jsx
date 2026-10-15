import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors } from "../theme";
import { mediaUploadProgressCopy } from "../domain/mediaTransferProgress.mjs";

// Only byte transfers have a measured percentage. Server processing does not.
export default function MediaUploadProgress({ progress }) {
  const label = mediaUploadProgressCopy(progress);
  const fraction = Math.min(1, Math.max(0, Number(progress?.fraction) || 0));
  const measured = String(progress?.stage || "").startsWith("uploading-") && Number(progress?.totalBytes) > 0;
  return <View style={styles.copy} accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityState={{ busy: true }} accessibilityValue={measured ? { min: 0, max: 100, now: Math.round(fraction * 100), text: label } : { text: label }}>
    <View style={styles.row}>
      {!measured && <ActivityIndicator size="small" color={colors.amber} />}
      <Text style={styles.text}>{label}</Text>
    </View>
    {measured && <View style={styles.track}><View style={[styles.fill, { width: `${fraction * 100}%` }]} /></View>}
  </View>;
}
const styles = StyleSheet.create({ copy: { flex: 1, gap: 6 }, row: { flexDirection: "row", alignItems: "center", gap: 8 }, text: { flex: 1, color: colors.textDim, fontSize: 12.5, lineHeight: 18 }, track: { height: 4, overflow: "hidden", borderRadius: 2, backgroundColor: colors.lineSoft }, fill: { height: "100%", borderRadius: 2, backgroundColor: colors.amber } });
