import { View, Text, StyleSheet } from "react-native";
import { colors, mono } from "../theme";

// The signature insight: "the band" (performance/setlist/energy) is scored
// separately from "the room" (sound/venue/crowd) so a bad-sounding room never
// drags down an artist's live reputation.
function Meter({ label, value, color }) {
  return (
    <View style={styles.meter}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.val, { color }]}>{value.toFixed(1)}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${(value / 5) * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

export default function RatingSplit({ band, room, compact = false }) {
  return (
    <View style={[styles.wrap, compact && { gap: 8 }]}>
      <Meter label="THE BAND" value={band} color={colors.amber} />
      <Meter label="THE ROOM" value={room} color={colors.cool} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", gap: 14 },
  meter: { flex: 1 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 },
  label: { color: colors.textFaint, fontSize: 10, letterSpacing: 1.2, fontWeight: "700" },
  val: { fontFamily: mono, fontSize: 13, fontWeight: "700" },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
});
