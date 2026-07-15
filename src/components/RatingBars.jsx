import { View, Text, StyleSheet } from "react-native";
import { colors, mono, radius } from "../theme";
import { RATING_DIMS } from "../data";

const GROUP_COLOR = { "THE BAND": colors.amber, "THE ROOM": colors.blue, "THE NIGHT": colors.magenta };

// The "why" behind a star score: one horizontal bar per rating dimension,
// band/room/night color-coded to match the split the whole app is built on.
// Renders only dimensions the reviewer actually rated; falls back to the
// band/room pair for older posts that never carried a detailed breakdown.
export default function RatingBars({ dims, band, room, compact = false }) {
  const detailed = RATING_DIMS
    .map((d) => ({ ...d, value: Number(dims?.[d.key]) || 0 }))
    .filter((d) => d.value > 0);
  const rows = detailed.length ? detailed : [
    { key: "band", label: "The band", group: "THE BAND", value: Number(band) || 0 },
    { key: "room", label: "The room", group: "THE ROOM", value: Number(room) || 0 },
  ].filter((d) => d.value > 0);
  if (!rows.length) return null;

  return (
    <View style={compact ? styles.wrapCompact : styles.wrap}>
      {rows.map((d) => (
        <View key={d.key} style={styles.row} accessibilityLabel={`${d.label}: ${d.value.toFixed(1)} out of 5`}>
          <Text style={styles.label} numberOfLines={1}>{d.label}</Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(3, Math.min(100, (d.value / 5) * 100))}%`, backgroundColor: GROUP_COLOR[d.group] || colors.amber }]} />
          </View>
          <Text style={styles.num}>{d.value.toFixed(1)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 7, marginTop: 4 },
  wrapCompact: { gap: 5, marginTop: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  label: { color: colors.textDim, fontSize: 11.5, width: 108 },
  track: { flex: 1, height: 7, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: "hidden" },
  fill: { height: 7, borderRadius: 4 },
  num: { color: colors.text, fontFamily: mono, fontSize: 11, fontWeight: "700", width: 26, textAlign: "right" },
});
