import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Image as ExpoImage } from "expo-image";
import { colors, displayFont, font, mono, radius, space } from "../../theme";
import Icon from "../../components/Icon";
import FestivalBackdrop from "./FestivalBackdrop";
import { festivalAccent, festivalCountdown, festivalDateRange, festivalLength, festivalPlace, goingLine, lineupIsNew } from "./festivalFormat.mjs";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// One festival edition as a poster tile: the ticket image or the festival's
// own colours, a calendar tile with the first day, how soon it starts, then
// the name, dates, place, the top of the lineup and who's going.
export default function FestivalCard({ edition, onOpen, size = "large" }) {
  const headliners = Array.isArray(edition.headliners) ? edition.headliners : [];
  const more = Math.max(0, (Number(edition.lineupCount) || 0) - headliners.length);
  const fresh = lineupIsNew(edition);
  const going = goingLine(edition);
  const countdown = festivalCountdown(edition);
  const length = festivalLength(edition);
  const month = MONTHS[Number(edition.startDate?.slice(5, 7)) - 1];
  const day = Number(edition.startDate?.slice(8, 10));
  return <Pressable onPress={() => onOpen?.(edition)}
    style={({ pressed, hovered }) => [styles.card, hovered && styles.hovered, pressed && styles.pressed]}
    accessibilityRole="link" accessibilityLabel={`${edition.name}, ${festivalDateRange(edition.startDate, edition.endDate)}, ${festivalPlace(edition)}`}>
    <View style={[styles.art, size === "small" && styles.artSmall]}>
      {edition.imageUrl ? <>
        <ExpoImage source={{ uri: edition.imageUrl }} style={StyleSheet.absoluteFill} contentFit="cover" transition={150} accessibilityIgnoresInvertColors />
        <View style={styles.shade} />
      </> : <FestivalBackdrop accent={festivalAccent(edition.festivalSlug || edition.name)} still />}
      <View style={styles.badges}>
        {countdown ? <View style={[styles.badge, countdown.live && styles.badgeLive]}><Text style={[styles.badgeText, countdown.live && styles.badgeLiveText]}>{countdown.label}</Text></View> : null}
        {fresh ? <View style={[styles.badge, styles.badgeHot]}><Text style={styles.badgeHotText}>Lineup out</Text></View> : null}
      </View>
      {month && day ? <View style={styles.calendar} accessible={false}>
        <Text style={styles.calendarMonth}>{month}</Text>
        <Text style={styles.calendarDay}>{day}</Text>
      </View> : null}
      {length ? <View style={styles.lengthTag}><Text style={styles.lengthText}>{length}</Text></View> : null}
    </View>
    <View style={styles.body}>
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
  card: {
    flex: 1, minWidth: 0, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden",
    ...Platform.select({ web: { transitionProperty: "transform, border-color", transitionDuration: "180ms", transitionTimingFunction: "ease-out" }, default: {} }),
  },
  hovered: { borderColor: colors.amber, transform: [{ translateY: -3 }] },
  pressed: { opacity: 0.85 },
  art: { height: 150, backgroundColor: "#0B0A10" },
  artSmall: { height: 116 },
  shade: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.3)" },
  badges: { position: "absolute", top: space(2), left: space(2), right: space(2), flexDirection: "row", flexWrap: "wrap", gap: space(1) },
  badge: { borderRadius: radius.pill, backgroundColor: "rgba(10,10,12,0.72)", paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { color: "#FFFFFF", fontFamily: font, fontSize: 11, fontWeight: "900" },
  badgeLive: { backgroundColor: "#FF3D6E" },
  badgeLiveText: { color: "#FFFFFF" },
  badgeHot: { backgroundColor: "#FFFFFF" },
  badgeHotText: { color: "#111114", fontFamily: font, fontSize: 11, fontWeight: "900" },
  calendar: { position: "absolute", left: space(2), bottom: space(2), minWidth: 46, alignItems: "center", borderRadius: radius.sm, backgroundColor: "rgba(255,255,255,0.94)", paddingHorizontal: 8, paddingVertical: 4 },
  calendarMonth: { color: "#E0374F", fontFamily: mono, fontSize: 10, fontWeight: "900", letterSpacing: 0.8, textTransform: "uppercase" },
  calendarDay: { color: "#111114", fontFamily: displayFont, fontSize: 20, fontWeight: "900", lineHeight: 22 },
  lengthTag: { position: "absolute", right: space(2), bottom: space(2), borderRadius: radius.pill, backgroundColor: "rgba(10,10,12,0.72)", paddingHorizontal: 9, paddingVertical: 4 },
  lengthText: { color: "#FFFFFF", fontFamily: font, fontSize: 11, fontWeight: "900" },
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
