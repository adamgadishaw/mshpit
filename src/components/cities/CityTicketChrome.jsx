import { StyleSheet, View } from "react-native";
import { colors, space } from "../../theme";

export function CityTicketTrim() {
  return <View pointerEvents="none" accessible={false} style={styles.trim}>
    <View style={[styles.gel, styles.amber]} /><View style={[styles.gel, styles.magenta]} /><View style={[styles.gel, styles.cool]} />
  </View>;
}

export function CityTicketDivider({ cutoutColor = colors.bg }) {
  return <View pointerEvents="none" accessible={false} style={styles.divider}>
    <View style={[styles.cutout, styles.left, { backgroundColor: cutoutColor }]} />
    <View style={[styles.cutout, styles.right, { backgroundColor: cutoutColor }]} />
  </View>;
}

const styles = StyleSheet.create({
  trim: { height: space(1), flexDirection: "row", width: "100%" },
  gel: { flex: 1 }, amber: { backgroundColor: colors.amber, flex: 2 }, magenta: { backgroundColor: colors.magenta }, cool: { backgroundColor: colors.cool },
  divider: { borderTopWidth: 1, borderStyle: "dashed", borderColor: colors.line, width: "100%", height: 1 },
  cutout: { position: "absolute", width: space(4), height: space(4), borderRadius: space(2), top: -space(2), borderWidth: 1, borderColor: colors.line },
  left: { left: -space(2) }, right: { right: -space(2) },
});
