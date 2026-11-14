import { View, StyleSheet, useWindowDimensions } from "react-native";
import Text from "./DynamicTypeText";
import { colors, mono } from "../theme";

// The signature insight: "the band" (performance/setlist/energy) is scored
// separately from "the room" (sound/venue/crowd) so a bad-sounding room never
// drags down an artist's live reputation.
function Meter({ label, value, color, stacked }) {
  const score = Number(value);
  const saved = Number.isFinite(score) && score > 0;
  return (
    <View style={[styles.meter, stacked && styles.meterStacked]}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.val, { color }]}>{saved ? score.toFixed(1) : "—"}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${saved ? (score / 5) * 100 : 0}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function RatingSplit({ band, room, compact = false }) {
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= 1.4;
  return (
    <View style={[styles.wrap, compact && { gap: 8 }]}>
      <Meter label="THE BAND" value={band} color={colors.amber} stacked={stacked} />
      <Meter label="THE ROOM" value={room} color={colors.cool} stacked={stacked} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  // Keep the basis stable through live changes; native Yoga reevaluates the
  // minimum on each layout and can return safely to two columns afterward.
  meter: { flex: 1, flexBasis: 0, minWidth: "45%" },
  meterStacked: { minWidth: "100%" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 },
  label: { flexGrow: 1, flexShrink: 1, minWidth: "75%", color: colors.textFaint, fontSize: 10, letterSpacing: 1.2, fontWeight: "700" },
  val: { flexShrink: 0, fontFamily: mono, fontSize: 13, fontWeight: "700" },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
});
