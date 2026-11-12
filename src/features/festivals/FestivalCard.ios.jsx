import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, font, radius, space } from "../../theme";
import FestivalArtwork from "./FestivalArtwork";
import { festivalCountdown, festivalDateRange, festivalPlace, goingLine } from "./festivalFormat.mjs";

export default function FestivalCard({ edition, onOpen, size = "large" }) {
  const countdown = festivalCountdown(edition);
  const headliners = Array.isArray(edition.headliners) ? edition.headliners : [];
  const going = goingLine(edition);
  return <View style={styles.card}>
    <FestivalArtwork edition={edition} compact={size === "small"} onOpen={() => onOpen?.(edition)} />
    <Pressable onPress={() => onOpen?.(edition)} style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      accessibilityRole="button" accessibilityLabel={`Open ${edition.name}, ${festivalDateRange(edition.startDate, edition.endDate)}, ${festivalPlace(edition)}`}>
      {countdown ? <Text style={styles.kicker}>{countdown.label}</Text> : null}
      <Text style={styles.name}>{edition.name}</Text>
      <Text style={styles.when}>{festivalDateRange(edition.startDate, edition.endDate)}</Text>
      {festivalPlace(edition) ? <Text style={styles.where}>{festivalPlace(edition)}</Text> : null}
      <Text style={styles.lineup}>{headliners.length ? headliners.join(" · ") : "Lineup not listed here yet"}</Text>
      {going ? <Text style={styles.where}>{going}</Text> : null}
      <Text style={styles.open}>View festival →</Text>
    </Pressable>
  </View>;
}
const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, padding: space(3), borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, gap: space(2) },
  body: { minHeight: 44, gap: 7, paddingVertical: 4 }, pressed: { opacity: .75 },
  kicker: { color: colors.amber, fontFamily: font, fontSize: 12, fontWeight: "700" },
  name: { color: colors.text, fontFamily: displayFont, fontSize: 23, fontWeight: "900", lineHeight: 29 },
  when: { color: colors.text, fontFamily: font, fontSize: 15, fontWeight: "700", lineHeight: 21 },
  where: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 19 },
  lineup: { color: colors.textDim, fontFamily: font, fontSize: 14, lineHeight: 21, marginTop: 4 },
  open: { color: colors.amber, fontFamily: font, fontSize: 14, fontWeight: "700", marginTop: 7 },
});
