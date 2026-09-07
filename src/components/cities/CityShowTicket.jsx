import { StyleSheet, Text, View } from "react-native";
import { colors, displayFont, focusRing, mono, radius, space } from "../../theme";
import { PublicPressableLink } from "../PublicWebLinks";
import Icon from "../Icon";
import CityImage from "./CityImage";
import { cityDateStamp, cityShowTime, cityText } from "./cityPresentation.mjs";

export default function CityShowTicket({ show, copy, onOpen, showImage = false }) {
  const stamp = cityDateStamp(show.date);
  const title = show.artist || show.eventName;
  return <PublicPressableLink href={show.path} onNavigate={onOpen} accessibilityLabel={`${title}. ${show.venue}. ${cityShowTime(show)}. ${cityText(copy, "openShow")}`}
    style={({ pressed, focused }) => [styles.ticket, pressed && styles.pressed, focused && focusRing]}>
    <View style={styles.dateStub}>
      {stamp ? <><Text style={styles.month}>{stamp.month}</Text><Text style={styles.day}>{stamp.day}</Text><Text style={styles.year}>{stamp.year}</Text></> : <Icon name="calendar" color={colors.amber} size={24} />}
    </View>
    <View style={styles.body}>
      <Text style={styles.title} numberOfLines={2}>{title}</Text>
      {show.eventName && show.eventName !== title ? <Text style={styles.tour} numberOfLines={1}>{show.eventName}</Text> : null}
      <Text style={styles.venue} numberOfLines={2}>{show.venue}</Text>
      <View style={styles.footer}><Text style={styles.time}>{stamp ? String(show.startLocalTime || "").slice(0, 5) : cityText(copy, "datePending")}</Text><Icon name="chevron-right" color={colors.amber} size={18} /></View>
    </View>
    {showImage && show.image ? <CityImage uri={show.image} style={styles.artwork} contain={false} previewWidth={160} accessibilityLabel={title} /> : null}
  </PublicPressableLink>;
}
const styles = StyleSheet.create({
  ticket: { minHeight: space(27), borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, borderCurve: "continuous", backgroundColor: colors.surface, flexDirection: "row", overflow: "hidden", minWidth: 0 },
  dateStub: { width: space(18), paddingVertical: space(4), gap: space(1), alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceAlt, borderRightWidth: 1, borderColor: colors.line, borderStyle: "dashed" },
  month: { color: colors.amber, fontSize: 10, fontFamily: mono, fontWeight: "800", letterSpacing: 1 }, day: { color: colors.text, fontSize: 30, fontWeight: "800", fontFamily: displayFont, fontVariant: ["tabular-nums"], lineHeight: 34 }, year: { color: colors.textFaint, fontSize: 9, fontFamily: mono },
  body: { flex: 1, minWidth: 0, padding: space(4), gap: space(1) }, title: { color: colors.text, fontFamily: displayFont, fontSize: 20, fontWeight: "800", lineHeight: 25 }, tour: { color: colors.amber, fontSize: 11, lineHeight: 16 }, venue: { color: colors.textDim, fontSize: 12, lineHeight: 18 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space(2), paddingTop: space(1) }, time: { color: colors.textFaint, fontSize: 11, fontFamily: mono }, artwork: { width: space(20), alignSelf: "stretch" }, pressed: { opacity: 0.78 },
});
