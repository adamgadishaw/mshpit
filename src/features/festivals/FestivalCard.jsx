import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, displayFont, font, mono, radius, space } from "../../theme";
import Icon from "../../components/Icon";
import { festivalDateRange, festivalLength, festivalPlace, goingLine, lineupIsNew } from "./festivalFormat.mjs";

// One festival edition as a big poster tile: the ticket image, the name, the
// dates, where, the top of the lineup and how many members are going.
export default function FestivalCard({ edition, onOpen, size = "large" }) {
  const headliners = Array.isArray(edition.headliners) ? edition.headliners : [];
  const more = Math.max(0, (Number(edition.lineupCount) || 0) - headliners.length);
  const fresh = lineupIsNew(edition);
  const going = goingLine(edition);
  const badges = <>
    {fresh ? <View style={[styles.badge, styles.badgeHot]}><Text style={styles.badgeHotText}>LINEUP OUT</Text></View> : null}
    {festivalLength(edition) ? <View style={styles.badge}><Text style={styles.badgeText}>{festivalLength(edition).toUpperCase()}</Text></View> : null}
  </>;
  return <Pressable onPress={() => onOpen?.(edition)} style={({ pressed }) => [styles.card, size === "small" && styles.cardSmall, pressed && styles.pressed]}
    accessibilityRole="link" accessibilityLabel={`${edition.name}, ${festivalDateRange(edition.startDate, edition.endDate)}, ${festivalPlace(edition)}`}>
    {edition.imageUrl ? <View style={[styles.art, size === "small" && styles.artSmall]}>
      <ExpoImage source={{ uri: edition.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
      <View style={styles.shade} />
      <View style={styles.badges}>{badges}</View>
    </View> : <View style={styles.bar} />}
    <View style={styles.body}>
      {!edition.imageUrl && (fresh || festivalLength(edition)) ? <View style={styles.inlineBadges}>{badges}</View> : null}
      <Text style={styles.name} numberOfLines={2}>{edition.name}</Text>
      <Text style={styles.when}>{festivalDateRange(edition.startDate, edition.endDate)}</Text>
      {festivalPlace(edition) ? <Text style={styles.where} numberOfLines={1}>{festivalPlace(edition)}</Text> : null}
      {headliners.length ? <Text style={styles.lineup} numberOfLines={2}>{headliners.join(" · ")}{more ? <Text style={styles.more}>{`  +${more} more`}</Text> : null}</Text>
        : <Text style={styles.pending}>Lineup not announced yet</Text>}
      {going ? <View style={styles.goingRow}><Icon name="you" size={12} color={colors.amber} /><Text style={styles.going}>{going}</Text></View> : null}
    </View>
  </Pressable>;
}

const styles = StyleSheet.create({
  // Sizing belongs to the list around the card (grid or rail).
  card: { flex: 1, minWidth: 0, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" },
  cardSmall: {},
  pressed: { opacity: 0.85 },
  art: { height: 170, backgroundColor: colors.bgElev },
  artSmall: { height: 120 },
  bar: { height: 6, backgroundColor: colors.amber },
  inlineBadges: { flexDirection: "row", gap: space(1), marginBottom: 4 },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.18)" },
  badges: { position: "absolute", top: space(2), left: space(2), flexDirection: "row", gap: space(1) },
  badge: { borderRadius: radius.pill, backgroundColor: "rgba(10,10,12,0.78)", paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: colors.text, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  badgeHot: { backgroundColor: colors.amber },
  badgeHotText: { color: colors.bg, fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 0.8 },
  body: { padding: space(3), gap: 4 },
  name: { color: colors.text, fontFamily: displayFont, fontSize: 19, fontWeight: "900" },
  when: { color: colors.amber, fontFamily: font, fontSize: 13, fontWeight: "800" },
  where: { color: colors.textDim, fontFamily: font, fontSize: 12.5 },
  lineup: { color: colors.text, fontFamily: font, fontSize: 13, fontWeight: "700", lineHeight: 18, marginTop: 4 },
  more: { color: colors.textFaint, fontWeight: "700" },
  pending: { color: colors.textFaint, fontFamily: font, fontSize: 12.5, marginTop: 4 },
  goingRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
  going: { color: colors.textDim, fontFamily: font, fontSize: 12, fontWeight: "700" },
});
