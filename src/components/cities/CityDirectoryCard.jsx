import { StyleSheet, Text, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius, space } from "../../theme";
import Icon from "../Icon";
import { PublicPressableLink } from "../PublicWebLinks";
import { cityText } from "./cityPresentation.mjs";
import { CityTicketDivider, CityTicketTrim } from "./CityTicketChrome";

export default function CityDirectoryCard({ city, copy, onOpenCity, compact = false, style }) {
  const location = [city.region, city.country].filter(Boolean).join(", ");
  const t = (key, values) => cityText(copy, key, { city: city.city, ...values });
  return <PublicPressableLink href={city.path} onNavigate={onOpenCity ? () => onOpenCity(city) : undefined}
    accessibilityLabel={`${city.city}, ${location}. ${t("learnMore")}`} style={({ pressed, focused }) => [styles.card, compact && styles.compact, pressed && styles.pressed, focused && focusRing, style]}>
    <CityTicketTrim />
    <View style={styles.body}>
      <View style={styles.topline}><Text style={styles.location} numberOfLines={2}>{location}</Text><Icon name="ticket" color={colors.amber} size={20} /></View>
      <Text style={[styles.title, compact && styles.compactTitle]} numberOfLines={2}>{city.city}</Text>
      <View style={styles.learnRow}><Text style={styles.learn}>{t("learnMore")}</Text><Icon name="chevron-right" color={colors.amber} size={17} /></View>
    </View>
    <CityTicketDivider />
    <View style={styles.stub}>
      <View style={styles.count}><Icon name="calendar" size={16} color={colors.amber} /><Text style={styles.countText}>{t("upcomingCount", { count: city.upcomingCount || 0 })}</Text></View>
      {!compact ? <Text style={styles.venues}>{t("venueCount", { count: city.venueCount || 0 })}</Text> : null}
    </View>
  </PublicPressableLink>;
}
const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0, borderRadius: radius.md, borderCurve: "continuous", borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, overflow: "hidden" }, compact: { width: 232, flex: undefined },
  body: { padding: space(5), paddingBottom: space(3), gap: space(2) }, topline: { flexDirection: "row", gap: space(3), alignItems: "center" }, location: { color: colors.textFaint, fontFamily: mono, fontSize: 10, letterSpacing: 0.6, flex: 1 },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 30, fontWeight: "800", lineHeight: 34 }, compactTitle: { fontSize: 25, lineHeight: 30 }, learnRow: { flexDirection: "row", alignItems: "center", gap: space(2), minHeight: space(11) }, learn: { color: colors.amber, fontSize: 13, fontWeight: "800" },
  stub: { padding: space(4), flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(3), flexWrap: "wrap", backgroundColor: colors.surfaceAlt }, count: { flexDirection: "row", alignItems: "center", gap: space(2) }, countText: { color: colors.text, fontSize: 11, fontFamily: mono }, venues: { color: colors.textDim, fontSize: 11 }, pressed: { opacity: 0.78 },
});
