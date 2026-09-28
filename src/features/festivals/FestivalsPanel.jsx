import { useCallback, useEffect } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, displayFont, font, radius, space } from "../../theme";
import Button from "../../components/Button";
import FestivalCard from "./FestivalCard";
import { readFestivals } from "./festivalApi.mjs";
import { lineupIsNew } from "./festivalFormat.mjs";
import useFestivalResource from "./useFestivalResource";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// Discover's Festivals tab: upcoming festival editions, kept apart from
// regular shows. Fresh lineups lead, then every edition month by month.
export default function FestivalsPanel({ region = "Worldwide", onOpenFestival, registerRefresh }) {
  const country = region === "Worldwide" ? "" : region;
  const load = useCallback((signal) => readFestivals({ country, signal }), [country]);
  const resource = useFestivalResource(`festivals:${country}`, load);
  useEffect(() => {
    registerRefresh?.(resource.refresh);
    return () => registerRefresh?.(null);
  }, [registerRefresh, resource.refresh]);
  const upcoming = Array.isArray(resource.data?.upcoming) ? resource.data.upcoming : [];
  const fresh = upcoming.filter((edition) => lineupIsNew(edition)).slice(0, 6);
  const months = [];
  for (const edition of upcoming) {
    const key = edition.startDate.slice(0, 7);
    const last = months[months.length - 1];
    if (last?.key === key) last.editions.push(edition);
    else months.push({ key, title: `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`, editions: [edition] });
  }
  const open = (edition) => onOpenFestival?.(edition.festivalSlug, edition.id);
  return <View style={styles.root}>
    <View style={styles.intro}>
      <Text style={styles.title} accessibilityRole="header">Festivals</Text>
      <Text style={styles.detail}>{country
        ? `Multi-day festivals in ${region}: dates, lineups by day and who's going.`
        : "Multi-day festivals around the world: dates, lineups by day and who's going."}</Text>
    </View>
    {resource.error ? <View style={styles.message}>
      <Text style={styles.error} accessibilityRole="alert">Festivals could not load. Check your connection and try again.</Text>
      <Button small variant="secondary" title="Try again" onPress={resource.reload} />
    </View> : null}
    {!resource.data && !resource.error ? <View style={styles.message} accessibilityLiveRegion="polite">
      <ActivityIndicator color={colors.amber} /><Text style={styles.detail}>Loading festivals…</Text>
    </View> : null}
    {resource.data && !upcoming.length ? <View style={styles.message}>
      <Text style={styles.detail}>{country ? `No upcoming festivals listed in ${region} yet. New dates appear here as soon as tickets are listed.` : "No upcoming festivals listed yet. New dates appear here as soon as tickets are listed."}</Text>
    </View> : null}
    {fresh.length ? <View style={styles.section}>
      <Text style={styles.sectionTitle}>Lineups just announced</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {fresh.map((edition) => <View key={`fresh:${edition.id}`} style={styles.railItem}><FestivalCard edition={edition} onOpen={open} size="small" /></View>)}
      </ScrollView>
    </View> : null}
    {months.map((month) => <View key={month.key} style={styles.section}>
      <Text style={styles.sectionTitle}>{month.title}</Text>
      <View style={styles.grid}>{month.editions.map((edition) => <View key={edition.id} style={styles.gridItem}><FestivalCard edition={edition} onOpen={open} size="small" /></View>)}</View>
    </View>)}
  </View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, gap: space(5) },
  intro: { gap: space(1) },
  title: { color: colors.text, fontFamily: displayFont, fontSize: 24, fontWeight: "900" },
  detail: { color: colors.textDim, fontFamily: font, fontSize: 13, lineHeight: 19 },
  section: { gap: space(3) },
  sectionTitle: { color: colors.textDim, fontFamily: font, fontSize: 12, fontWeight: "900", letterSpacing: 1.2, textTransform: "uppercase" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space(3) },
  gridItem: { flexGrow: 1, flexBasis: 260, minWidth: 0, flexDirection: "row" },
  rail: { gap: space(3) },
  railItem: { width: 280, flexDirection: "row" },
  message: { alignItems: "center", gap: space(3), padding: space(5), borderWidth: 1, borderColor: colors.lineSoft, borderRadius: radius.md, backgroundColor: colors.surface },
  error: { color: colors.danger, fontFamily: font, fontSize: 13, textAlign: "center" },
});
