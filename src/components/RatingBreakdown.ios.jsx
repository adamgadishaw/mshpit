import { View, StyleSheet } from "react-native";
import Text from "./DynamicTypeText";
import { colors, mono } from "../theme";
import { RATING_DIMS } from "../data";

const GROUP_COLOR = { "THE BAND": colors.amber, "THE ROOM": colors.cool, "THE NIGHT": colors.magenta };

function Factor({ label, value, color }) {
  return (
    <View style={styles.factor}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.val, { color }]}>{value ? value.toFixed(1) : "-"}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${(value / 5) * 100}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// The six-factor breakdown, grouped Band / Room / Night.
export default function RatingBreakdown({ dims = {} }) {
  const groups = ["THE BAND", "THE ROOM", "THE NIGHT"];
  return (
    <View style={{ gap: 14 }}>
      {groups.map((g) => (
        <View key={g}>
          <Text style={[styles.group, { color: GROUP_COLOR[g] }]}>{g}</Text>
          {RATING_DIMS.filter((d) => d.group === g).map((d) => (
            <Factor key={d.key} label={d.label} value={dims[d.key] || 0} color={GROUP_COLOR[g]} />
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { fontSize: 10, letterSpacing: 1.5, fontWeight: "800", marginBottom: 8 },
  factor: { marginBottom: 9 },
  // A scaled value keeps its complete intrinsic width. When the pair no
  // longer fits, the label takes its own line instead of pushing the score
  // offscreen. Percentage minimums also reflow on a retained native node.
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 },
  label: { flexGrow: 1, flexShrink: 1, minWidth: "75%", color: colors.textDim, fontSize: 13 },
  val: { flexShrink: 0, fontFamily: mono, fontSize: 13, fontWeight: "700" },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.line, overflow: "hidden" },
  fill: { height: 4, borderRadius: 2 },
});
